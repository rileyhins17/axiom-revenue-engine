import { NextResponse } from "next/server";
import { z } from "zod";

import { getDatabase } from "@/lib/cloudflare";
import {
  createRevenueOwnerObservedReplyD1Boundary,
  type RevenueObservedReply,
} from "@/lib/revenue-engine/owner-observed-reply-d1";
import { parseOwnerLeadBusinessIdRouteParam } from "@/lib/revenue-engine/owner-lead-identity";
import { requireApiSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
const MAX_BODY_BYTES = 2048;
const ReplyCommand = z.object({
  idempotencyKey: z.string().uuid(),
  contactPointId: z.string().min(1).max(160),
  category: z.enum(["INTEREST", "QUESTION", "NEGATIVE", "REFERRAL", "OUT_OF_OFFICE", "OTHER"]),
  summary: z.string().trim().min(1).max(300),
  observedAt: z.string().datetime({ offset: false }),
  owner: z.enum(["RILEY", "AIDAN"]),
  action: z.string().trim().min(1).max(500),
  dueAt: z.string().datetime({ offset: true }),
}).strict();

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

function publicReply(reply: RevenueObservedReply) {
  return {
    replyId: reply.replyId,
    businessId: reply.businessId,
    contactPointId: reply.contactPointId,
    category: reply.category,
    summary: reply.summary,
    observedAt: reply.observedAt,
    owner: reply.owner,
    action: reply.actionText,
    dueAt: reply.dueAt,
    taskId: reply.taskId,
    status: reply.taskStatus,
    createdAt: reply.createdAt,
  };
}

async function authenticatedBusiness(request: Request, params: Promise<{ businessId: string }>) {
  const auth = await requireApiSession(request);
  if ("response" in auth) return { response: auth.response } as const;
  const { businessId: routeId } = await params;
  const businessId = parseOwnerLeadBusinessIdRouteParam(routeId);
  if (!businessId) return { response: json({ code: "INVALID_BUSINESS_ID", error: "The business identity is invalid." }, 400) } as const;
  try {
    const database = getDatabase();
    const business = await database.prepare(`SELECT "id" FROM "RevenueBusiness" WHERE "id"=?`).bind(businessId).first();
    if (!business) return { response: json({ code: "BUSINESS_NOT_FOUND", error: "This saved business could not be found." }, 404) } as const;
    return { database, businessId, actorUserId: auth.session.user.id } as const;
  } catch {
    return { response: json({ code: "REPLIES_UNAVAILABLE", error: "Saved business replies are unavailable right now." }, 503) } as const;
  }
}

function matchesOwnerOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  let parsed: URL;
  try { parsed = new URL(origin); } catch { return false; }
  if (parsed.origin !== origin) return false;
  if (origin === new URL(request.url).origin) return true;
  const host = request.headers.get("host");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  return Boolean(host && host.toLowerCase() === parsed.host.toLowerCase() &&
    (parsed.protocol === "https:" || (loopback && parsed.protocol === "http:")));
}

async function readJsonUnderLimit(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) throw new Error("BODY_TOO_LARGE");
  if (!request.body) throw new Error("INVALID_JSON");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) throw new Error("BODY_TOO_LARGE");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("INVALID_JSON");
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ businessId: string }> }) {
  const context = await authenticatedBusiness(request, params);
  if ("response" in context) return context.response;
  try {
    const replies = await createRevenueOwnerObservedReplyD1Boundary(context.database).listReplies(context.businessId);
    return json({ replies: replies.map(publicReply) });
  } catch {
    return json({ code: "REPLIES_UNAVAILABLE", error: "Saved business replies are unavailable right now." }, 503);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ businessId: string }> }) {
  const context = await authenticatedBusiness(request, params);
  if ("response" in context) return context.response;
  if (!matchesOwnerOrigin(request) || request.headers.get("sec-fetch-site") === "cross-site") {
    return json({ code: "ORIGIN_REJECTED", error: "This reply record must come from the owner console." }, 403);
  }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
    return json({ code: "INVALID_CONTENT_TYPE", error: "Send a JSON reply record." }, 415);
  }
  let raw: unknown;
  try {
    raw = await readJsonUnderLimit(request);
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === "BODY_TOO_LARGE";
    return json({ code: tooLarge ? "BODY_TOO_LARGE" : "INVALID_JSON", error: tooLarge ? "The reply record is too large." : "The reply record is not valid JSON." }, tooLarge ? 413 : 400);
  }
  const parsed = ReplyCommand.safeParse(raw);
  if (!parsed.success) return json({ code: "INVALID_REPLY_RECORD", error: "Check the contact, reply details, owner, and due time." }, 400);

  try {
    const result = await createRevenueOwnerObservedReplyD1Boundary(context.database).createObservedReply({
      businessId: context.businessId,
      contactPointId: parsed.data.contactPointId,
      idempotencyKey: parsed.data.idempotencyKey,
      category: parsed.data.category,
      summary: parsed.data.summary,
      observedAt: parsed.data.observedAt,
      owner: parsed.data.owner,
      actionText: parsed.data.action,
      dueAt: parsed.data.dueAt,
      actorUserId: context.actorUserId,
    });
    return json({ reply: publicReply(result.reply) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "REPLY_RECORD_FAILED";
    if (code === "OWNER_REPLY_IDEMPOTENCY_CONFLICT") {
      return json({ code, error: "This request conflicts with an earlier saved reply. Reload and review it." }, 409);
    }
    if (code === "OWNER_REPLY_CONTACT_UNKNOWN" || code === "OWNER_REPLY_CONTACT_SCOPE_INVALID" || code === "OWNER_REPLY_BUSINESS_UNKNOWN") {
      return json({ code, error: "The saved business or email contact could not be found." }, 404);
    }
    if (code === "OWNER_REPLY_CONTACT_NOT_EMAIL") {
      return json({ code, error: "Choose a saved email contact for this reply." }, 400);
    }
    if (code === "OWNER_REPLY_BUSINESS_STOPPED" || code === "OWNER_REPLY_CONTACT_SUPPRESSED") {
      return json({ code, error: "This business or email contact is stopped. Review the saved stop before recording a new action." }, 409);
    }
    if (code.endsWith("_INVALID")) {
      return json({ code: "INVALID_REPLY_RECORD", error: "Check the contact, reply details, owner, and due time." }, 400);
    }
    return json({ code: "REPLIES_UNAVAILABLE", error: "The reply record could not be saved or verified. Reload before retrying." }, 503);
  }
}
