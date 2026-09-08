import { PrivateKwOwnerLabelingPacketSchema } from "@/lib/revenue-engine/private-kw-owner-labeling";
import {
  projectOwnerLabelingWorkspace,
} from "@/lib/revenue-engine/owner-labeling-workspace";

export const OWNER_LABELING_UPLOAD_MAX_BYTES = 10_000_000;

export class OwnerLabelingUploadError extends Error {
  constructor(
    message: string,
    readonly code: "INVALID_CONTENT_TYPE" | "PACKET_TOO_LARGE" | "INVALID_PACKET",
    readonly status: 400 | 413 | 415,
  ) {
    super(message);
  }
}

export function validateOwnerLabelingPacketUpload(value: unknown) {
  const packet = PrivateKwOwnerLabelingPacketSchema.safeParse(value);
  if (!packet.success) {
    throw new OwnerLabelingUploadError(
      "That file is not an exact Axiom owner-review checkpoint.",
      "INVALID_PACKET",
      400,
    );
  }
  try {
    return projectOwnerLabelingWorkspace(packet.data);
  } catch {
    throw new OwnerLabelingUploadError(
      "Owner review requires the fixed 50-business cohort with exact assessments.",
      "INVALID_PACKET",
      400,
    );
  }
}

export async function readOwnerLabelingPacketRequest(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new OwnerLabelingUploadError("Upload the checkpoint as a JSON file.", "INVALID_CONTENT_TYPE", 415);
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > OWNER_LABELING_UPLOAD_MAX_BYTES)) {
    throw new OwnerLabelingUploadError("The owner-review checkpoint is too large.", "PACKET_TOO_LARGE", 413);
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > OWNER_LABELING_UPLOAD_MAX_BYTES) {
    throw new OwnerLabelingUploadError("The owner-review checkpoint is too large.", "PACKET_TOO_LARGE", 413);
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch {
    throw new OwnerLabelingUploadError("The owner-review checkpoint is not valid JSON.", "INVALID_PACKET", 400);
  }
}
