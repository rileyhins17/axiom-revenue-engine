import { NextResponse } from "next/server";

import { getCloudflareBindings } from "@/lib/cloudflare";
import { getM2OwnerIdentityActor } from "@/lib/revenue-engine/m2-owner-identity-actor";
import { readLocalM2OwnerIdentityPacket } from "@/lib/revenue-engine/m2-owner-identity-packet";
import { readLatestPrivateKwM2OwnerDecisions } from "@/lib/revenue-engine/m2-owner-identity-local-store";
import {
  M2ManualWebsiteObservationCommandSchema,
  type M2ManualWebsiteObservationTarget,
} from "@/lib/revenue-engine/m2-manual-website-observation";
import {
  listM2ManualWebsiteObservations,
  M2ManualWebsiteObservationStoreError,
  saveM2ManualWebsiteObservation,
} from "@/lib/revenue-engine/m2-manual-website-observation-local-store";
import { getApprovedM2ManualWebsiteObservationTargets } from "@/lib/revenue-engine/m2-manual-website-observation-targets";
import { requireAdminApiSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4_096;

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
  const host = request.headers.get("host");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  return Boolean(host && host.toLowerCase() === parsed.host.toLowerCase()
    && (parsed.protocol === "https:" || (loopback && parsed.protocol === "http:")));
}

class InvalidObservationRequest extends Error {
  constructor(readonly status: 400 | 413 | 415) { super("INVALID_OBSERVATION_REQUEST"); }
}

async function readBoundedJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") throw new InvalidObservationRequest(415);
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) throw new InvalidObservationRequest(413);
  if (!request.body) throw new InvalidObservationRequest(400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel("Manual observation request too large");
        throw new InvalidObservationRequest(413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new InvalidObservationRequest(400); }
}

async function ownerContext(request: Request) {
  const auth = await requireAdminApiSession(request);
  if ("response" in auth) return { response: auth.response } as const;
  const actor = getM2OwnerIdentityActor(auth.session.user.email);
  if (!actor) return { response: json({ error: "Only a named Axiom owner can review M2 websites." }, 403) } as const;
  if (getCloudflareBindings() !== null) return { response: json({ error: "Manual M2 website review is available only in the local workspace." }, 503) } as const;
  const packet = await readLocalM2OwnerIdentityPacket();
  if (packet.status !== "READY") return { response: json({ error: "The exact reviewed M2 identity packet is unavailable." }, 503) } as const;
  try {
    const saved = await readLatestPrivateKwM2OwnerDecisions(packet.packetSha256);
    const targets = getApprovedM2ManualWebsiteObservationTargets(packet, saved);
    if (targets.length === 0) return { response: json({ error: "Save the current owner identity decisions before recording website observations." }, 409) } as const;
    return { actor, targets } as const;
  } catch {
    return { response: json({ error: "The saved M2 identity decisions could not be verified." }, 503) } as const;
  }
}

export async function GET(request: Request) {
  const context = await ownerContext(request);
  if ("response" in context) return context.response;
  try {
    const targets = await Promise.all(context.targets.map(async (target: M2ManualWebsiteObservationTarget) => ({
      ...target,
      observations: await listM2ManualWebsiteObservations(target),
    })));
    return json({ version: "kw-m2-manual-observation-dossier-v1", targets });
  } catch {
    return json({ error: "Saved manual website observations could not be verified." }, 503);
  }
}

export async function POST(request: Request) {
  const context = await ownerContext(request);
  if ("response" in context) return context.response;
  if (!sameOwnerOrigin(request)) return json({ error: "Open the M2 review from the same Axiom workspace." }, 403);

  let input: unknown;
  try { input = await readBoundedJson(request); }
  catch (error) {
    if (error instanceof InvalidObservationRequest) {
      return json({ error: error.status === 413 ? "The observation is too large." : error.status === 415 ? "The observation must be sent as JSON." : "The observation request must be valid JSON." }, error.status);
    }
    return json({ error: "The observation request could not be read." }, 400);
  }
  const command = M2ManualWebsiteObservationCommandSchema.safeParse(input);
  if (!command.success) return json({ error: "Review the website observation and required evidence declaration." }, 400);
  const target = context.targets.find((candidate) => candidate.reviewId === command.data.reviewId);
  if (!target) return json({ error: "This business is not selected by the current owner identity review." }, 409);

  try {
    const saved = await saveM2ManualWebsiteObservation(command.data, target, context.actor);
    const observations = await listM2ManualWebsiteObservations(target);
    const observation = observations.find((item) => item.observationId === saved.observationId);
    if (!observation) return json({ error: "The saved observation could not be reloaded." }, 503);
    return json({ saved, observation }, saved.status === "SAVED" ? 201 : 200);
  } catch (error) {
    if (error instanceof M2ManualWebsiteObservationStoreError && error.code === "CONFLICT") {
      return json({ error: "This observation conflicts with an earlier saved version. Reload before changing it." }, 409);
    }
    return json({ error: "The observation could not be saved locally." }, 503);
  }
}
