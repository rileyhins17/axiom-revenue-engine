import { NextResponse } from "next/server";

import { getCloudflareBindings } from "@/lib/cloudflare";
import { buildValidatedM2OwnerIdentitySaveCommand } from "@/lib/revenue-engine/m2-owner-identity-save-command";
import { getM2OwnerIdentityActor } from "@/lib/revenue-engine/m2-owner-identity-actor";
import {
  M2OwnerIdentityLocalStoreError,
  readLatestPrivateKwM2OwnerDecisions,
  savePrivateKwM2OwnerDecisions,
} from "@/lib/revenue-engine/m2-owner-identity-local-store";
import { readLocalM2OwnerIdentityPacket } from "@/lib/revenue-engine/m2-owner-identity-packet";
import { requireAdminApiSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 64_000;

function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

function sameOwnerOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  let parsed: URL;
  try { parsed = new URL(origin); } catch { return false; }
  if (parsed.origin !== origin) return false;
  if (origin === new URL(request.url).origin) return true;

  // A local reverse proxy may expose a different public URL from Next's
  // listener. Browsers cannot choose the Host header for a cross-site request.
  const host = request.headers.get("host");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  return Boolean(host && host.toLowerCase() === parsed.host.toLowerCase() &&
    (parsed.protocol === "https:" || (loopback && parsed.protocol === "http:")));
}

class InvalidSaveRequest extends Error {
  constructor(readonly status: 400 | 413 | 415) { super("INVALID_SAVE_REQUEST"); }
}

async function readBoundedJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    throw new InvalidSaveRequest(415);
  }
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    throw new InvalidSaveRequest(413);
  }
  if (!request.body) throw new InvalidSaveRequest(400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel("M2 owner decision body too large");
        throw new InvalidSaveRequest(413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new InvalidSaveRequest(400);
  }
}

async function ownerContext(request: Request) {
  const auth = await requireAdminApiSession(request);
  if ("response" in auth) return { response: auth.response } as const;
  const actor = getM2OwnerIdentityActor(auth.session.user.email);
  if (!actor) return { response: json({ error: "Only a named Axiom owner can save this review." }, 403) } as const;
  if (getCloudflareBindings() !== null) {
    return { response: json({ error: "This review is available only in the local workspace." }, 503) } as const;
  }
  const packet = await readLocalM2OwnerIdentityPacket();
  if (packet.status !== "READY") {
    return { response: json({ error: "The exact local research packet is unavailable." }, 503) } as const;
  }
  return { actor, packet } as const;
}

export async function GET(request: Request) {
  const context = await ownerContext(request);
  if ("response" in context) return context.response;
  try {
    const saved = await readLatestPrivateKwM2OwnerDecisions(context.packet.packetSha256);
    return json({ saved });
  } catch {
    return json({ error: "Saved owner decisions could not be verified." }, 503);
  }
}

export async function POST(request: Request) {
  const context = await ownerContext(request);
  if ("response" in context) return context.response;
  if (!sameOwnerOrigin(request)) return json({ error: "Open this review from the same Axiom workspace." }, 403);

  let input: unknown;
  try {
    input = await readBoundedJson(request);
  } catch (error) {
    if (error instanceof InvalidSaveRequest) {
      const message = error.status === 413
        ? "The review is too large."
        : error.status === 415
          ? "The review must be sent as JSON."
          : "The review request must be valid JSON.";
      return json({ error: message }, error.status);
    }
    return json({ error: "The review request could not be read." }, 400);
  }

  let ledger;
  try {
    ledger = buildValidatedM2OwnerIdentitySaveCommand(input, context.packet, context.actor, new Date().toISOString());
  } catch {
    return json({ error: "Review all ten businesses again before saving." }, 400);
  }
  try {
    const saved = await savePrivateKwM2OwnerDecisions(ledger);
    return json({ saved }, saved.status === "SAVED" ? 201 : 200);
  } catch (error) {
    if (error instanceof M2OwnerIdentityLocalStoreError && error.code === "CONFLICT") {
      return json({ error: "A different saved review already exists. Reload before trying again." }, 409);
    }
    return json({ error: "The private review could not be saved locally." }, 503);
  }
}
