/**
 * The Claude connector's MCP server: JSON-RPC messages in, answers out. Hand-written like Axiom Command's, so
 * the two connectors behave the same: `initialize`, `ping`, `tools/list` and `tools/call`; a notification gets
 * no answer; a batch is answered in order. No server-sent stream and no sessions are needed.
 *
 * This file knows nothing about HTTP or Next: it takes the database, the founder the key belongs to and one
 * parsed message, so tests call it directly. The HTTP side (the key, the Origin rule, the rate limit) is
 * mcp-http.ts; the tools are mcp-tools.ts.
 *
 * Every tool call has a time limit (WORKERS-001: a call that waits forever on one copy of the Worker is how
 * a whole screen froze), answers with a plain sentence when it can't do what was asked, and writes one row to
 * the audit log: which tool, which founder, whether it worked. Never a list, CSV text or an address.
 */
import { sha256Hex, type Founder } from "@/lib/connector/connector-keys";
import { TOOLS, ToolError, argumentProblem, withTorontoTimes, type Tool, type ToolContext, type ToolSettings } from "@/lib/connector/mcp-tools";
import type { MailServerCheck } from "@/lib/outreach/outreach-mail-servers";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { withTimeout } from "@/lib/timeout";

/** MCP protocol versions this server speaks, newest first. */
export const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
export const TOOL_TIMEOUT_MS = 10_000;
/** The most messages one batch may hold. */
export const MAX_BATCH = 20;
export const SERVER_INFO = { name: "axiom-engine", title: "Axiom Revenue Engine", version: "1.0.0" };

export type AuditEvent = { action: string; targetType: string; targetId?: string | null; ipAddress?: string | null; metadata: Record<string, unknown> };
export type ServerContext = {
  db: ProspectDb; founder: Founder; settings: ToolSettings;
  /** Writes one audit row (src/lib/audit.ts). A write that fails is ignored: it never fails the call. */
  audit: (event: AuditEvent) => Promise<void>;
  ip?: string | null;
  /** Seams for tests: the clock, the time limit, the tool list, the mail-server lookup and the id maker. */
  now?: () => Date; timeoutMs?: number; tools?: Tool[];
  checkMail?: (domains: string[]) => Promise<MailServerCheck>; newId?: () => string;
};

type Id = string | number | null;
type Rpc = { jsonrpc?: unknown; id?: Id; method?: unknown; params?: { protocolVersion?: unknown; name?: unknown; arguments?: unknown } | null };
export type RpcAnswer = { jsonrpc: "2.0"; id: Id; result: unknown } | { jsonrpc: "2.0"; id: Id; error: { code: number; message: string } };

const reply = (id: Id, result: unknown): RpcAnswer => ({ jsonrpc: "2.0", id, result });
export const fail = (id: Id | undefined, code: number, message: string): RpcAnswer => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
// What a tool gives back: the same object as text (every client reads that) and as data.
const content = (data: unknown) => ({ content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data });
const refusal = (sentence: string) => ({ content: [{ type: "text", text: sentence }], isError: true });

export const instructions = (founder: Founder) => `Axiom Revenue Engine is the outreach email engine of Axiom's two founders, Riley and Aidan. It sends each campaign's emails from the founders' own inboxes, follows up, reads replies and bounces, and shows what happened. You are connected as ${founder}. `
  + `Start with engine_today: it says what needs ${founder} and how today is going. Then list_campaigns, get_campaign, list_batches and get_batch for campaigns and their batches; list_replies and get_reply for replies; find_contact and check_do_not_email to look someone up; inbox_health for the sending inboxes. `
  + `Every time is given twice: as stored, and in Toronto time in the field whose name ends in Toronto. Use the Toronto one when you speak. `
  + `You can pause a campaign (pause_campaign), check a list and then load it as a batch that waits for approval (check_list, then load_list), queue a batch's test emails to ${founder}'s own inbox (send_test), and mark a reply answered (mark_reply_answered). `
  + `Since Nov 16, 2026 both founders also let their own Claude run a campaign for them: approve a batch when ${founder} is one of the campaign's named approvers (approve_batch), start a paused campaign again (resume_campaign), hold rows back so they are never emailed (hold_contacts), and start a new, paused campaign on ${founder}'s own inbox (create_campaign). Approving and resuming make emails go to real people: read get_batch's samples and held rows first, and never approve words you would not put ${founder}'s name under. `
  + `You cannot stop a batch, change an existing campaign's limits, inboxes or schedule, add an inbox, change the words of an approved batch or the do-not-email list, or change anything about FCC. Those are done on the engine's screens with the right founder signed in. When asked for one of them, say so and name the screen instead of trying. `
  + `Change something only when the founder asked for it or has told you to run the campaign for them, then say in one line what you changed. Never invent numbers, replies or contacts: say only what the tools return. Answer in plain English.`;

class TimedOut extends Error {}

/** An id safe for the audit log: any address inside it is replaced by a short fingerprint. */
async function auditId(id: string) {
  let out = id;
  for (const address of new Set(id.match(/[^\s:<>]+@[^\s:<>]+/g) ?? [])) out = out.split(address).join(`#${(await sha256Hex(address.toLowerCase())).slice(0, 10)}`);
  return out.slice(0, 200);
}

async function callTool(m: Rpc & { id: Id }, t: ServerContext): Promise<RpcAnswer> {
  const tools = t.tools ?? TOOLS;
  const tool = tools.find((item) => item.name === m.params?.name);
  // A failed audit write never fails the call.
  const record = async (action: string, ok: boolean, saves: boolean, target: { kind: string; id: string } | null) => {
    try {
      await t.audit({
        action, targetType: "connector", targetId: target?.id ?? null, ipAddress: t.ip ?? null,
        metadata: { via: "Claude connector", founder: t.founder, ok, write: saves, ...(target ? { target: target.kind } : {}) },
      });
    } catch { /* the call's answer matters more than its log line */ }
  };
  if (!tool) {
    await record("connector.unknown_tool", false, false, null);
    return fail(m.id, -32602, `There is no tool called ${String(m.params?.name).slice(0, 80)}`);
  }
  const given = m.params?.arguments ?? {};
  const parsed = tool.args.safeParse(given);
  if (!parsed.success) {
    await record(`connector.${tool.name}`, false, tool.saves, null);
    return reply(m.id, refusal(argumentProblem(parsed.error, given, Object.keys(tool.inputSchema.properties))));
  }
  const found = tool.target?.(parsed.data as never) ?? null;
  const target = found ? { kind: found.kind, id: await auditId(found.id) } : null;
  const ms = t.timeoutMs ?? TOOL_TIMEOUT_MS;
  const label = `connector.${tool.name}`;
  const context: ToolContext = { db: t.db, founder: t.founder, now: (t.now ?? (() => new Date()))(), settings: t.settings, ...(t.checkMail ? { checkMail: t.checkMail } : {}), ...(t.newId ? { newId: t.newId } : {}) };
  try {
    const data = await withTimeout(tool.run(parsed.data as never, context), ms, label)
      .catch((error: unknown) => { throw error instanceof Error && error.message === `${label} took longer than ${ms / 1000} seconds` ? new TimedOut() : error; });
    await record(label, true, tool.saves, target);
    return reply(m.id, content(withTorontoTimes(data)));
  } catch (error) {
    await record(label, false, tool.saves, target);
    if (error instanceof ToolError) return reply(m.id, refusal(error.message));
    if (error instanceof TimedOut) {
      return reply(m.id, refusal(`That took longer than ${ms / 1000} seconds, so the engine stopped waiting. ${tool.saves ? "It may or may not have been saved: look before you try again." : "Try again in a minute."}`));
    }
    throw error;
  }
}

/** The answer to one message, or null when it needs none (a notification, or a reply to something we never asked). */
export async function answer(message: unknown, t: ServerContext): Promise<RpcAnswer | null> {
  if (!message || typeof message !== "object" || Array.isArray(message)) return fail(null, -32600, "Not a JSON-RPC request");
  const m = message as Rpc;
  if (typeof m.method !== "string") return null;
  if (m.id === undefined) return null;
  if (m.jsonrpc !== "2.0") return fail(m.id, -32600, "Not a JSON-RPC 2.0 request");
  switch (m.method) {
    case "initialize": {
      const asked = m.params?.protocolVersion;
      return reply(m.id, {
        protocolVersion: typeof asked === "string" && VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: instructions(t.founder),
      });
    }
    case "ping": return reply(m.id, {});
    case "tools/list": return reply(m.id, { tools: (t.tools ?? TOOLS).map((tool) => ({ name: tool.name, title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations })) });
    case "tools/call": return callTool(m as Rpc & { id: Id }, t);
    default: return fail(m.id, -32601, `Unknown method ${m.method.slice(0, 80)}`);
  }
}

const isToolCall = (message: unknown) => Boolean(message) && typeof message === "object" && (message as Rpc).method === "tools/call" && (message as Rpc).id !== undefined;

/**
 * Answers a request body: one message, or a batch (an array) answered in order. `body` is null when nothing
 * needs an answer (HTTP 202). One request runs at most one tool, so it stays far inside the database's
 * per-request limit; a second tool call in the same batch is told to come again by itself.
 */
export async function answerBody(body: unknown, t: ServerContext): Promise<{ body: RpcAnswer | RpcAnswer[] | null }> {
  const batch = Array.isArray(body);
  const messages: unknown[] = batch ? body : [body];
  if (messages.length > MAX_BATCH) return { body: fail(null, -32600, `Send at most ${MAX_BATCH} messages at a time`) };
  const out: RpcAnswer[] = [];
  let toolCalls = 0;
  for (const message of messages) {
    const id = message && typeof message === "object" ? (message as Rpc).id : null;
    try {
      if (isToolCall(message) && ++toolCalls > 1) { out.push(fail(id, -32600, "One tool call per request: send this one again by itself")); continue; }
      const result = await answer(message, t);
      if (result) out.push(result);
    } catch (error) {
      console.error(JSON.stringify({ event: "connector_error", message: error instanceof Error ? error.message.slice(0, 200) : "unknown" }));
      out.push(fail(id, -32603, "Something went wrong in the engine. Try again in a minute."));
    }
  }
  if (!out.length) return { body: null };
  return { body: batch ? out : out[0]! };
}
