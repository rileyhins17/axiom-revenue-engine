/**
 * The Claude connector over plain HTTP: JSON-RPC in a POST, the answer as JSON. Used by both addresses:
 *
 * - /api/mcp            the key comes in `Authorization: Bearer axe_...` (Claude Code);
 * - /api/mcp/k/<key>    the key is part of the address, "axel_..." (claude.ai custom connectors).
 *
 * It does its own key check, not the sign-in cookie. A web page on another site can't use it even holding a
 * key (the Origin rule); calls are limited per key, and calls without a valid key per IP address. Whatever
 * goes wrong, it answers with a JSON-RPC error: it never hangs and never throws.
 */
import { writeAuditEvent } from "@/lib/audit";
import { getClientIp, getDatabase } from "@/lib/cloudflare";
import { bearerKey, founderForKey, type KeyKind } from "@/lib/connector/connector-keys";
import { answerBody, fail, type ServerContext } from "@/lib/connector/mcp-server";
import { engineSetting } from "@/lib/engine-settings";
import { consumeRateLimit } from "@/lib/rate-limit";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { withTimeout } from "@/lib/timeout";

/** Claude's own servers (claude.ai custom connectors, routines) may send their own Origin. */
const CLAUDE_ORIGINS = new Set(["https://claude.ai", "https://claude.com"]);
export const KEY_CALLS_PER_MINUTE = 120;
/** Calls with no valid key, per IP address: guessing a key gets ten answers a minute. */
export const NO_KEY_CALLS_PER_MINUTE = 10;
const CHECK_TIMEOUT_MS = 10_000;
/** A list check carries a CSV of up to a million characters. */
const MAX_BODY_CHARS = 1_500_000;

export type McpEnv = Omit<ServerContext, "founder" | "ip"> & {
  /** The app's own addresses: a browser may call from these. */
  ownOrigins: string[];
  ip: string;
  rateLimit: (options: { identifier: string; limit: number; scope: string; windowSeconds: number }) => Promise<{ allowed: boolean }>;
};

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });
const originOf = (address: string) => { try { return new URL(address).origin; } catch { return null; } };

/** GET and every other method: this server only takes POST (no stream to open, no session to end). */
export function methodNotAllowed() {
  return json({ error: "Send MCP requests with POST." }, 405, { Allow: "POST" });
}

async function handle(request: Request, pathKey: string | null, env: McpEnv): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin && !env.ownOrigins.includes(origin) && !CLAUDE_ORIGINS.has(origin)) return json({ error: "Not allowed from another site." }, 403);

  // The key comes in the Authorization header, or (for the claude.ai link) in the address itself. Never both.
  const kind: KeyKind = pathKey === null ? "header" : "link";
  const key = pathKey === null ? bearerKey(request.headers.get("authorization")) : pathKey;
  const now = (env.now ?? (() => new Date()))();
  const founder = await withTimeout(founderForKey(env.db, key, kind, now), CHECK_TIMEOUT_MS, "connector.key");
  const tooMany = () => json(fail(null, -32002, "Too many calls in a minute. Wait a minute, then try again."), 429, { "Retry-After": "60" });
  if (!founder) {
    const guess = await withTimeout(env.rateLimit({ scope: "connector-no-key", identifier: env.ip, limit: NO_KEY_CALLS_PER_MINUTE, windowSeconds: 60 }), CHECK_TIMEOUT_MS, "connector.limit");
    if (!guess.allowed) return tooMany();
    return json(fail(null, -32001, "No valid connector key. Make one in the engine: Settings, Claude connector."), 401, kind === "header" ? { "WWW-Authenticate": 'Bearer realm="Axiom Revenue Engine"' } : {});
  }
  const calls = await withTimeout(env.rateLimit({ scope: "connector-key", identifier: `${founder}:${kind}`, limit: KEY_CALLS_PER_MINUTE, windowSeconds: 60 }), CHECK_TIMEOUT_MS, "connector.limit");
  if (!calls.allowed) return tooMany();

  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) return json(fail(null, -32600, "The request is too big."), 413);
  let body: unknown;
  try { body = JSON.parse(text); } catch { return json(fail(null, -32700, "The request is not JSON"), 400); }
  const answered = await answerBody(body, { ...env, founder, ip: env.ip });
  return answered.body === null ? new Response(null, { status: 202, headers: { "Cache-Control": "no-store" } }) : json(answered.body, 200);
}

/** One MCP request. `pathKey` is null for /api/mcp (the key is in the header) and the address's key for /api/mcp/k/<key>. */
export async function handleMcpPost(request: Request, pathKey: string | null, env: McpEnv): Promise<Response> {
  try {
    return await handle(request, pathKey, env);
  } catch (error) {
    console.error(JSON.stringify({ event: "connector_failed", message: error instanceof Error ? error.message.slice(0, 200) : "unknown" }));
    return json(fail(null, -32603, "The engine couldn't answer just now. Try again in a minute."), 503);
  }
}

/** The live pieces: the bound database, the Worker's settings, the audit log and the rate limiter. Built per request. */
export function liveMcpEnv(request: Request): McpEnv {
  const own = [originOf(request.url), originOf(engineSetting("APP_BASE_URL"))].filter((origin): origin is string => Boolean(origin));
  return {
    db: getDatabase() as unknown as ProspectDb,
    settings: { fccFirstInbox: engineSetting("FCC_SENDER_ADDRESS"), mailingAddress: engineSetting("FCC_CAMPAIGN_MAILING_ADDRESS") },
    ownOrigins: own, ip: getClientIp(request), audit: writeAuditEvent, rateLimit: consumeRateLimit,
  };
}
