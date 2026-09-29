import { NextResponse } from "next/server";

import {
  OwnerLabelingUploadError,
  readOwnerLabelingPacketRequest,
  validateOwnerLabelingBlindUpload,
} from "@/lib/revenue-engine/owner-labeling-upload";
import { requireApiSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
};

export async function POST(request: Request) {
  const authResult = await requireApiSession(request);
  if ("response" in authResult) return authResult.response;

  try {
    const value = await readOwnerLabelingPacketRequest(request);
    const workspace = validateOwnerLabelingBlindUpload(value);
    return NextResponse.json(workspace, { headers: PRIVATE_NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof OwnerLabelingUploadError) {
      return NextResponse.json(
        { code: error.code, error: error.message },
        { status: error.status, headers: PRIVATE_NO_STORE_HEADERS },
      );
    }
    return NextResponse.json(
      { code: "OWNER_LABELING_VALIDATION_FAILED", error: "The owner-review checkpoint could not be verified." },
      { status: 500, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
}
