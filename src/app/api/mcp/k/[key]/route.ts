import { handleMcpPost, liveMcpEnv, methodNotAllowed } from "@/lib/connector/mcp-http";

export const dynamic = "force-dynamic";

/**
 * The same Claude connector as /api/mcp, for claude.ai custom connectors, which can't send a header: the
 * founder's link key ("axel_...") is part of the address. A header key is refused here.
 */
export async function POST(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return handleMcpPost(request, key, liveMcpEnv(request));
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
