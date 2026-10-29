import { getDatabase } from "@/lib/cloudflare";
import { unsubscribe } from "@/lib/revenue-engine/engine-email";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";

export const dynamic = "force-dynamic";

/** One-click (RFC 8058) and form unsubscribe. Public by design: the token is the credential. */
export async function POST(request: Request) {
  const url = new URL(request.url);
  let token = url.searchParams.get("t") ?? "";
  if (!token) {
    const form = await request.formData().catch(() => null);
    token = String(form?.get("t") ?? "");
  }
  const result = await unsubscribe(getDatabase() as unknown as ProspectDb, token.slice(0, 128));
  const accepts = request.headers.get("accept") ?? "";
  if (accepts.includes("text/html")) return Response.redirect(new URL(`/unsubscribe?done=${result === "DONE" ? 1 : 0}`, url.origin), 303);
  return Response.json({ status: result }, { status: result === "DONE" ? 200 : 404 });
}
