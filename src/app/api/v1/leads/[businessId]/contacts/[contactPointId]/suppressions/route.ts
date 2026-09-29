import { NextResponse } from "next/server";
import { z } from "zod";

import { getDatabase } from "@/lib/cloudflare";
import {
  createRevenueContactSuppressionD1Boundary,
  type RevenueContactSuppression,
} from "@/lib/revenue-engine/contact-suppression-d1";
import { parseOwnerLeadBusinessIdRouteParam } from "@/lib/revenue-engine/owner-lead-identity";
import { requireApiSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
const MAX_BODY_BYTES = 2048;
const SuppressionCommand = z.object({
  idempotencyKey: z.string().uuid(),
  reason: z.enum(["UNSUBSCRIBE", "COMPLAINT", "BOUNCE"]),
  note: z.string().trim().min(1).max(300),
  observedAt: z.string().datetime({ offset: false }),
}).strict();

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

function publicSuppression(suppression: RevenueContactSuppression) {
  return {
    suppressionId: suppression.suppressionId,
    businessId: suppression.businessId,
    contactPointId: suppression.contactPointId,
    reason: suppression.reason,
    note: suppression.note,
    actorUserId: suppression.actorUserId,
    observedAt: suppression.observedAt,
    createdAt: suppression.createdAt,
  };
}

async function authenticatedScope(
  request: Request,
  params: Promise<{ businessId: string; contactPointId: string }>,
) {
  const auth = await requireApiSession(request);
  if ("response" in auth) return { response: auth.response } as const;
  const route = await params;
  const businessId = parseOwnerLeadBusinessIdRouteParam(route.businessId);
  if (!businessId || typeof route.contactPointId !== "string" || route.contactPointId.length < 1 ||
      route.contactPointId.length > 160 || route.contactPointId.trim() !== route.contactPointId || /[\u0000-\u001f\u007f]/.test(route.contactPointId)) {
    return { response: json({ code: "INVALID_CONTACT_SCOPE", error: "The business or contact identity is invalid." }, 400) } as const;
  }
  try {
    const database = getDatabase();
    // A stop must remain recordable even when the current dossier projection is
    // unavailable or stale. Exact persisted contact ownership is the scope gate.
    const contact = await database.prepare(`SELECT "id" FROM "RevenueContactPoint" WHERE "id"=? AND "businessId"=?`)
      .bind(route.contactPointId, businessId).first();
    if (!contact) return { response: json({ code: "CONTACT_POINT_NOT_FOUND", error: "That contact point is not part of this business." }, 404) } as const;
    return { database, businessId, contactPointId: route.contactPointId, actorUserId: auth.session.user.id } as const;
  } catch {
    return { response: json({ code: "CONTACT_SUPPRESSION_UNAVAILABLE", error: "The current business and contact could not be verified." }, 503) } as const;
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

export async function GET(request: Request, { params }: { params: Promise<{ businessId: string; contactPointId: string }> }) {
  const context = await authenticatedScope(request, params);
  if ("response" in context) return context.response;
  try {
    const suppression = await createRevenueContactSuppressionD1Boundary(context.database)
      .getSuppression(context.businessId, context.contactPointId);
    return json({ suppression: suppression ? publicSuppression(suppression) : null });
  } catch {
    return json({ code: "CONTACT_SUPPRESSION_UNAVAILABLE", error: "The saved contact decision is unavailable right now." }, 503);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ businessId: string; contactPointId: string }> }) {
  const context = await authenticatedScope(request, params);
  if ("response" in context) return context.response;
  if (!matchesOwnerOrigin(request) || request.headers.get("sec-fetch-site") === "cross-site") {
    return json({ code: "ORIGIN_REJECTED", error: "This contact decision must come from the owner console." }, 403);
  }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
    return json({ code: "INVALID_CONTENT_TYPE", error: "Send a JSON contact decision." }, 415);
  }
  let raw: unknown;
  try {
    raw = await readJsonUnderLimit(request);
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === "BODY_TOO_LARGE";
    return json({ code: tooLarge ? "BODY_TOO_LARGE" : "INVALID_JSON", error: tooLarge ? "The contact decision is too large." : "The contact decision is not valid JSON." }, tooLarge ? 413 : 400);
  }
  const parsed = SuppressionCommand.safeParse(raw);
  if (!parsed.success) return json({ code: "INVALID_CONTACT_SUPPRESSION", error: "Check the reason, observation time, and short note." }, 400);

  const boundary = createRevenueContactSuppressionD1Boundary(context.database);
  try {
    await boundary.createSuppression({
      businessId: context.businessId,
      contactPointId: context.contactPointId,
      idempotencyKey: parsed.data.idempotencyKey,
      reason: parsed.data.reason,
      note: parsed.data.note,
      actorUserId: context.actorUserId,
      observedAt: parsed.data.observedAt,
    });
    const suppression = await boundary.getSuppression(context.businessId, context.contactPointId);
    if (!suppression || suppression.idempotencyKey !== parsed.data.idempotencyKey) {
      return json({ code: "CONTACT_SUPPRESSION_READBACK_FAILED", error: "The saved decision could not be verified. Reload before retrying." }, 503);
    }
    return json({ suppression: publicSuppression(suppression) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "CONTACT_SUPPRESSION_WRITE_FAILED";
    if (code === "CONTACT_SUPPRESSION_IDEMPOTENCY_CONFLICT" || code === "CONTACT_SUPPRESSION_ALREADY_EXISTS") {
      return json({ code, error: "A contact decision already exists or this request conflicts with an earlier one. Reload and review it." }, 409);
    }
    if (code === "CONTACT_SUPPRESSION_CONTACT_UNKNOWN" || code === "CONTACT_SUPPRESSION_SCOPE_INVALID") {
      return json({ code, error: "That contact point is not part of this business." }, 404);
    }
    if (code.endsWith("_INVALID")) return json({ code: "INVALID_CONTACT_SUPPRESSION", error: "Check the reason, observation time, and short note." }, 400);
    return json({ code: "CONTACT_SUPPRESSION_UNAVAILABLE", error: "The saved contact decision is unavailable right now." }, 503);
  }
}
