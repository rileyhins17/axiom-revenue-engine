import { NextResponse } from "next/server";
import { z } from "zod";

import { getDatabase } from "@/lib/cloudflare";
import {
  createRevenueBusinessStopD1Boundary,
  type RevenueBusinessStop,
} from "@/lib/revenue-engine/business-stop-d1";
import { readOwnerLeadDetail } from "@/lib/revenue-engine/owner-lead-detail-read-model";
import { parseOwnerLeadBusinessIdRouteParam } from "@/lib/revenue-engine/owner-lead-identity";
import { requireApiSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
const MAX_BODY_BYTES = 2048;
const StopCommand = z.object({
  idempotencyKey: z.string().uuid(),
  reason: z.enum(["OWNER_DECISION", "PROSPECT_REQUEST", "OTHER"]),
  note: z.string().trim().min(1).max(500),
}).strict();

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

function publicStop(stop: RevenueBusinessStop) {
  return {
    stopId: stop.stopId,
    businessId: stop.businessId,
    reason: stop.reason,
    source: stop.source,
    note: stop.note,
    actorUserId: stop.actorUserId,
    createdAt: stop.createdAt,
  };
}

async function authenticatedBusiness(request: Request, params: Promise<{ businessId: string }>) {
  const auth = await requireApiSession(request);
  if ("response" in auth) return { response: auth.response } as const;
  const { businessId: routeId } = await params;
  const businessId = parseOwnerLeadBusinessIdRouteParam(routeId);
  if (!businessId) return { response: json({ code: "INVALID_BUSINESS_ID", error: "The lead identity is invalid." }, 400) } as const;
  try {
    const database = getDatabase();
    const dossier = await readOwnerLeadDetail(database, businessId, new Date().toISOString());
    if (!dossier) return { response: json({ code: "OWNER_LEAD_NOT_FOUND", error: "No current v2 lead dossier was found." }, 404) } as const;
    return { database, businessId, actorUserId: auth.session.user.id } as const;
  } catch {
    return { response: json({ code: "BUSINESS_STOP_UNAVAILABLE", error: "The current lead dossier could not be verified." }, 503) } as const;
  }
}

function matchesOwnerOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  let parsed: URL;
  try { parsed = new URL(origin); } catch { return false; }
  if (parsed.origin !== origin) return false;
  if (origin === new URL(request.url).origin) return true;
  // Next may normalize request.url to its internal listener. Host is the
  // browser-visible authority and cannot be forged by a cross-site browser.
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
    const stop = await createRevenueBusinessStopD1Boundary(context.database).getStop(context.businessId);
    return json({ stop: stop ? publicStop(stop) : null });
  } catch {
    return json({ code: "BUSINESS_STOP_UNAVAILABLE", error: "The saved contact stop is unavailable right now." }, 503);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ businessId: string }> }) {
  const context = await authenticatedBusiness(request, params);
  if ("response" in context) return context.response;
  if (!matchesOwnerOrigin(request)) {
    return json({ code: "ORIGIN_REJECTED", error: "This stop must come from the owner console." }, 403);
  }
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return json({ code: "FETCH_SITE_REJECTED", error: "This stop must come from the owner console." }, 403);
  }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
    return json({ code: "INVALID_CONTENT_TYPE", error: "Send a JSON stop command." }, 415);
  }
  let raw: unknown;
  try {
    raw = await readJsonUnderLimit(request);
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === "BODY_TOO_LARGE";
    return json({ code: tooLarge ? "BODY_TOO_LARGE" : "INVALID_JSON", error: tooLarge ? "The stop command is too large." : "The stop command is not valid JSON." }, tooLarge ? 413 : 400);
  }
  const parsed = StopCommand.safeParse(raw);
  if (!parsed.success) return json({ code: "INVALID_STOP_COMMAND", error: "Check the stop reason and note." }, 400);

  const boundary = createRevenueBusinessStopD1Boundary(context.database);
  try {
    await boundary.createStop({
      businessId: context.businessId,
      idempotencyKey: parsed.data.idempotencyKey,
      reason: parsed.data.reason,
      source: "OWNER_ACTION",
      note: parsed.data.note,
      actorUserId: context.actorUserId,
    });
    const stop = await boundary.getStop(context.businessId);
    if (!stop || stop.idempotencyKey !== parsed.data.idempotencyKey) {
      return json({ code: "BUSINESS_STOP_READBACK_FAILED", error: "The saved stop could not be verified. Reload before retrying." }, 503);
    }
    return json({ stop: publicStop(stop) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "BUSINESS_STOP_WRITE_FAILED";
    if (code === "BUSINESS_STOP_IDEMPOTENCY_CONFLICT" || code === "BUSINESS_STOP_ALREADY_EXISTS") {
      return json({ code, error: "A stop already exists or this request conflicts with an earlier one. Reload and review it." }, 409);
    }
    if (code === "BUSINESS_STOP_BUSINESS_UNKNOWN") return json({ code, error: "The business could not be found." }, 404);
    if (code.endsWith("_INVALID")) return json({ code: "INVALID_STOP_COMMAND", error: "Check the stop reason and note." }, 400);
    return json({ code: "BUSINESS_STOP_UNAVAILABLE", error: "The saved contact stop is unavailable right now." }, 503);
  }
}
