import { NextResponse } from "next/server";
import { z } from "zod";

import { getDatabase } from "@/lib/cloudflare";
import { readOwnerLeadDetail } from "@/lib/revenue-engine/owner-lead-detail-read-model";
import { parseOwnerLeadBusinessIdRouteParam } from "@/lib/revenue-engine/owner-lead-identity";
import {
  createRevenueOwnerTaskD1Boundary,
  type RevenueOwnerTask,
} from "@/lib/revenue-engine/owner-task-d1";
import { requireApiSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
const MAX_BODY_BYTES = 2048;
const IdempotencyKey = z.string().uuid();
const TaskCommand = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("CREATE"),
    idempotencyKey: IdempotencyKey,
    owner: z.enum(["RILEY", "AIDAN"]),
    action: z.string().min(1).max(500),
    dueAt: z.string().min(1).max(40),
  }).strict(),
  z.object({
    operation: z.enum(["COMPLETE", "CANCEL"]),
    idempotencyKey: IdempotencyKey,
    taskId: z.string().min(1).max(200),
    note: z.string().min(1).max(500),
  }).strict(),
]);

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

function publicTask(task: RevenueOwnerTask) {
  return {
    taskId: task.taskId,
    businessId: task.businessId,
    owner: task.owner,
    action: task.actionText,
    dueAt: task.dueAt,
    status: task.status,
    createdAt: task.createdAt,
    ...(task.terminal?.outcome === "COMPLETE" ? { completedAt: task.terminal.createdAt } : {}),
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
    return { response: json({ code: "OWNER_TASK_UNAVAILABLE", error: "The current lead dossier could not be verified." }, 503) } as const;
  }
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

function writeError(error: unknown) {
  const code = error instanceof Error ? error.message : "OWNER_TASK_WRITE_FAILED";
  if (code === "OWNER_TASK_IDEMPOTENCY_CONFLICT" || code === "OWNER_TASK_ALREADY_TERMINAL") {
    return json({ code, error: "The task changed or this request conflicts with an earlier one. Reload and review it." }, 409);
  }
  if (code === "OWNER_TASK_UNKNOWN" || code === "OWNER_TASK_BUSINESS_UNKNOWN" || code === "OWNER_TASK_BUSINESS_MISMATCH") {
    return json({ code, error: "The task or business could not be found." }, 404);
  }
  if (code.endsWith("_INVALID")) {
    return json({ code: "INVALID_TASK_COMMAND", error: "Check the task details and try again." }, 400);
  }
  return json({ code: "OWNER_TASK_UNAVAILABLE", error: "Saved owner tasks are unavailable right now." }, 503);
}

function matchesOwnerOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  let parsed: URL;
  try { parsed = new URL(origin); } catch { return false; }
  if (parsed.origin !== origin) return false;
  if (origin === new URL(request.url).origin) return true;

  // Next can normalize request.url to its internal listener. The browser's Host
  // header is the public authority; a cross-site browser cannot forge it.
  const host = request.headers.get("host");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  return Boolean(host && host.toLowerCase() === parsed.host.toLowerCase() &&
    (parsed.protocol === "https:" || (loopback && parsed.protocol === "http:")));
}

export async function GET(request: Request, { params }: { params: Promise<{ businessId: string }> }) {
  const context = await authenticatedBusiness(request, params);
  if ("response" in context) return context.response;
  try {
    const tasks = await createRevenueOwnerTaskD1Boundary(context.database).listTasks(context.businessId);
    return json({ tasks: tasks.map(publicTask) });
  } catch {
    return json({ code: "OWNER_TASK_UNAVAILABLE", error: "Saved owner tasks are unavailable right now." }, 503);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ businessId: string }> }) {
  const context = await authenticatedBusiness(request, params);
  if ("response" in context) return context.response;

  // A session cookie alone cannot authorize a cross-site mutation.
  if (!matchesOwnerOrigin(request)) {
    return json({ code: "ORIGIN_REJECTED", error: "This task change must come from the owner console." }, 403);
  }
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return json({ code: "FETCH_SITE_REJECTED", error: "This task change must come from the owner console." }, 403);
  }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
    return json({ code: "INVALID_CONTENT_TYPE", error: "Send a JSON task command." }, 415);
  }

  let raw: unknown;
  try {
    raw = await readJsonUnderLimit(request);
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === "BODY_TOO_LARGE";
    return json({ code: tooLarge ? "BODY_TOO_LARGE" : "INVALID_JSON", error: tooLarge ? "The task command is too large." : "The task command is not valid JSON." }, tooLarge ? 413 : 400);
  }
  const parsed = TaskCommand.safeParse(raw);
  if (!parsed.success) return json({ code: "INVALID_TASK_COMMAND", error: "Check the task details and try again." }, 400);

  const boundary = createRevenueOwnerTaskD1Boundary(context.database);
  try {
    let taskId: string;
    if (parsed.data.operation === "CREATE") {
      const result = await boundary.createTask({
        businessId: context.businessId,
        idempotencyKey: parsed.data.idempotencyKey,
        owner: parsed.data.owner,
        actionText: parsed.data.action,
        dueAt: parsed.data.dueAt,
        actorUserId: context.actorUserId,
      });
      taskId = result.taskId;
    } else {
      await boundary.closeTask({
        businessId: context.businessId,
        taskId: parsed.data.taskId,
        idempotencyKey: parsed.data.idempotencyKey,
        outcome: parsed.data.operation,
        actorUserId: context.actorUserId,
        note: parsed.data.note,
      });
      taskId = parsed.data.taskId;
    }
    const task = await boundary.getTask(context.businessId, taskId);
    if (!task) return json({ code: "OWNER_TASK_READBACK_FAILED", error: "The saved task could not be verified. Reload before retrying." }, 503);
    return json({ task: publicTask(task) });
  } catch (error) {
    return writeError(error);
  }
}
