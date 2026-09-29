import { NextResponse } from "next/server";
import { z } from "zod";

import { BlindOwnerLabelingPacketSchema, rejoinOwnerLabelingPacket } from "@/lib/revenue-engine/owner-labeling-blind";
import { validateOwnerFirstPassForReveal } from "@/lib/revenue-engine/owner-labeling-first-pass";
import { readOwnerLabelingPacketRequest, OWNER_LABELING_REVEAL_MAX_BYTES, OwnerLabelingUploadError } from "@/lib/revenue-engine/owner-labeling-upload";
import { projectOwnerLabelingWorkspace } from "@/lib/revenue-engine/owner-labeling-workspace";
import { requireApiSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
};

const RevealRequestSchema = z.object({
  blindPacket: z.unknown(),
  assessmentSidecar: z.unknown(),
  firstPassExport: z.unknown(),
}).strict();

export async function POST(request: Request) {
  const authResult = await requireApiSession(request);
  if ("response" in authResult) return authResult.response;

  try {
    const value = await readOwnerLabelingPacketRequest(request, OWNER_LABELING_REVEAL_MAX_BYTES);
    const input = RevealRequestSchema.parse(value);
    const blind = BlindOwnerLabelingPacketSchema.parse(input.blindPacket);
    validateOwnerFirstPassForReveal(input.firstPassExport, {
      packetId: blind.fullPacketId,
      packetDigest: blind.fullPacketDigest,
      blindDigest: blind.blindDigest,
      entries: blind.entries,
    });
    const fullPacket = rejoinOwnerLabelingPacket(blind, input.assessmentSidecar);
    const workspace = projectOwnerLabelingWorkspace(fullPacket);
    return NextResponse.json(workspace, { headers: PRIVATE_NO_STORE_HEADERS });
  } catch (error) {
    const invalidBody = error instanceof OwnerLabelingUploadError;
    return NextResponse.json(
      {
        code: invalidBody ? error.code : "INVALID_REVEAL",
        error: invalidBody ? error.message : "The first-pass review and assessment file do not match this exact dossier.",
      },
      { status: invalidBody ? error.status : 400, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
}
