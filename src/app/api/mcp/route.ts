import { handleMcpPost, liveMcpEnv, methodNotAllowed } from "@/lib/connector/mcp-http";

export const dynamic = "force-dynamic";

/**
 * The engine's Claude connector (docs/runbooks/CLAUDE_CONNECTOR.md): an MCP server for a founder's Claude.
 * The key comes in `Authorization: Bearer axe_...`; the sign-in cookie opens nothing here.
 */
export async function POST(request: Request) {
  return handleMcpPost(request, null, liveMcpEnv(request));
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
