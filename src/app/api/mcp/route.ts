import { NextResponse } from "next/server";

import { ENGINE_TOOLS, runTool, UPDATE_FIX_TOOL, type EngineTool } from "@/lib/ai/engine-tools";
import { getCloudflareBindings, getDatabase } from "@/lib/cloudflare";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Engine MCP server over HTTP (JSON-RPC 2.0) for Claude Code and other MCP
// clients. Bearer token = Worker secret MCP_API_TOKEN. Tools read engine data
// and manage the fix queue; nothing here can send, queue, call or delete.
// Replaces the legacy outreach MCP (send, scheduler and mailbox tools removed).
// ---------------------------------------------------------------------------

type JsonRpcRequest = { jsonrpc: "2.0"; id?: number | string | null; method: string; params?: Record<string, unknown> };
type JsonRpcResponse = { jsonrpc: "2.0"; id: number | string | null; result?: unknown; error?: { code: number; message: string } };

const PROTOCOL_VERSION = "2025-03-26";
const SERVER_INFO = { name: "axiom-revenue-engine", version: "3.0.0" };
const TOOLS: EngineTool[] = [...ENGINE_TOOLS, UPDATE_FIX_TOOL];
const INSTRUCTIONS = "Axiom Revenue Engine. Read leads, call history and results; list fix requests reported from the app and mark them IN_PROGRESS/DONE with the commit that fixed them. The code lives in the axiom-revenue-engine repository; follow its AGENTS.md.";

function tokenMatches(presented: string, expected: string) {
  const a = new TextEncoder().encode(presented);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

function authorized(request: Request) {
  const env = (getCloudflareBindings() ?? {}) as Record<string, unknown>;
  const token = typeof env.MCP_API_TOKEN === "string" ? env.MCP_API_TOKEN.trim() : "";
  if (token.length < 32) return false;
  const match = (request.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  return Boolean(match && tokenMatches(match[1]!.trim(), token));
}
const unauthorized = () => NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });

async function handle(rpc: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const id = rpc.id ?? null;
  const ok = (result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id, result });
  switch (rpc.method) {
    case "initialize": return ok({ protocolVersion: PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
    case "notifications/initialized": case "notifications/cancelled": return null;
    case "ping": return ok({});
    case "tools/list": return ok({ tools: TOOLS.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: { ...tool.parameters, additionalProperties: false } })) });
    case "tools/call": {
      const name = typeof rpc.params?.name === "string" ? rpc.params.name : "";
      if (!TOOLS.some((tool) => tool.name === name)) return { jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool: ${name}` } };
      const result = await runTool(TOOLS, name, rpc.params?.arguments ?? {}, { db: getDatabase() as unknown as ProspectDb, actor: "RILEY", source: "OWNER", allowFixUpdates: true });
      const failed = typeof result === "object" && result !== null && "error" in result;
      return ok({ isError: failed || undefined, content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
    }
    default: return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${rpc.method}` } };
  }
}

export async function POST(request: Request) {
  if (!authorized(request)) return unauthorized();
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 }); }
  if (Array.isArray(body)) {
    const responses = (await Promise.all(body.slice(0, 20).map((rpc) => handle(rpc as JsonRpcRequest)))).filter((r): r is JsonRpcResponse => r !== null);
    return NextResponse.json(responses);
  }
  const response = await handle(body as JsonRpcRequest);
  return response ? NextResponse.json(response) : new Response(null, { status: 202 });
}

export async function GET(request: Request) {
  if (!authorized(request)) return unauthorized();
  return NextResponse.json({ protocol: "mcp", transport: "http", protocolVersion: PROTOCOL_VERSION, server: SERVER_INFO, tools: TOOLS.map((tool) => tool.name) });
}
