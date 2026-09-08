import { createHash } from "node:crypto";

import { z } from "zod";

import {
  ARTIFACT_DELIVERY_CONTRACT_VERSION,
  verifyFixtureArtifactDeliveryGrant,
} from "@/lib/revenue-engine/artifact-delivery-authorization";
import { ARTIFACT_MAX_ITEM_BYTES } from "@/lib/revenue-engine/content-addressed-artifact-store";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const ArtifactRefSchema = z.string().regex(/^artifact:sha256:[a-f0-9]{64}$/);
const BytesSchema = z.custom<Uint8Array>(
  (value) => value instanceof Uint8Array,
  "Artifact bytes must be a Uint8Array.",
);

const FixtureArtifactDeliveryReadRequestSchema = z.object({
  readerKind: z.literal("FIXTURE"),
  providerReadAuthorized: z.literal(false),
  artifactRef: ArtifactRefSchema,
  mediaType: z.literal("image/webp"),
  maxBytes: z.literal(ARTIFACT_MAX_ITEM_BYTES),
}).strict();

export type FixtureArtifactDeliveryReadRequest = z.infer<typeof FixtureArtifactDeliveryReadRequestSchema>;

const FixtureArtifactDeliveryObjectSchema = z.object({
  artifactRef: ArtifactRefSchema,
  bytes: BytesSchema,
  byteLength: z.number().int().positive().max(ARTIFACT_MAX_ITEM_BYTES),
  sha256: Sha256Schema,
  mediaType: z.literal("image/webp"),
}).strict();

export interface FixturePrivateArtifactReader {
  kind: "FIXTURE";
  readByArtifactRef(request: FixtureArtifactDeliveryReadRequest): Promise<unknown>;
}

const ArtifactDeliveryResponseHeadersSchema = z.object({
  "Cache-Control": z.literal("private, no-store, max-age=0"),
  "Content-Disposition": z.literal('inline; filename="axiom-evidence.webp"'),
  "Content-Length": z.string().regex(/^[1-9][0-9]*$/),
  "Content-Security-Policy": z.literal("default-src 'none'; sandbox"),
  "Content-Type": z.literal("image/webp"),
  "Cross-Origin-Resource-Policy": z.literal("same-origin"),
  ETag: z.string().regex(/^"[a-f0-9]{64}"$/),
  Pragma: z.literal("no-cache"),
  "Referrer-Policy": z.literal("no-referrer"),
  Vary: z.literal("Cookie"),
  "X-Content-Type-Options": z.literal("nosniff"),
}).strict();

export const FixtureArtifactDeliveryExecutionSchema = z.object({
  contractVersion: z.literal(ARTIFACT_DELIVERY_CONTRACT_VERSION),
  grantId: z.string().uuid(),
  mode: z.literal("SHADOW"),
  readerKind: z.literal("FIXTURE"),
  runtimeConnected: z.literal(false),
  fixtureReadPerformed: z.literal(true),
  providerReadPerformed: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  mutationAuthorized: z.literal(false),
  outreachAuthorized: z.literal(false),
  sendAuthorized: z.literal(false),
  costUsd: z.literal(0),
  response: z.object({
    status: z.literal(200),
    headers: ArtifactDeliveryResponseHeadersSchema,
    body: BytesSchema,
  }).strict(),
}).strict();

export type FixtureArtifactDeliveryExecution = z.infer<typeof FixtureArtifactDeliveryExecutionSchema>;

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isWebp(bytes: Uint8Array) {
  return bytes.byteLength >= 12
    && Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF"
    && Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP";
}

export async function executeFixtureArtifactDelivery(
  value: { token: string; expected: unknown },
  dependencies: {
    signingKey: Uint8Array;
    reader: FixturePrivateArtifactReader;
    now?: () => Date;
  },
): Promise<FixtureArtifactDeliveryExecution> {
  if (dependencies.reader.kind !== "FIXTURE") {
    throw new Error("Artifact delivery contract version 1 accepts fixture readers only.");
  }
  const claims = verifyFixtureArtifactDeliveryGrant(value.token, value.expected, dependencies);
  const object = FixtureArtifactDeliveryObjectSchema.parse(await dependencies.reader.readByArtifactRef(
    FixtureArtifactDeliveryReadRequestSchema.parse({
      readerKind: "FIXTURE",
      providerReadAuthorized: false,
      artifactRef: claims.artifactRef,
      mediaType: claims.mediaType,
      maxBytes: ARTIFACT_MAX_ITEM_BYTES,
    }),
  ));
  const body = Uint8Array.from(object.bytes);
  if (
    object.artifactRef !== claims.artifactRef
    || object.sha256 !== claims.artifactRef.slice("artifact:sha256:".length)
    || object.byteLength !== body.byteLength
    || sha256(body) !== object.sha256
    || !isWebp(body)
  ) {
    throw new Error("Private artifact reader returned invalid screenshot bytes.");
  }
  return FixtureArtifactDeliveryExecutionSchema.parse({
    contractVersion: ARTIFACT_DELIVERY_CONTRACT_VERSION,
    grantId: claims.grantId,
    mode: claims.mode,
    readerKind: "FIXTURE",
    runtimeConnected: false,
    fixtureReadPerformed: true,
    providerReadPerformed: false,
    providerOperationsAuthorized: 0,
    mutationAuthorized: false,
    outreachAuthorized: false,
    sendAuthorized: false,
    costUsd: 0,
    response: {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": 'inline; filename="axiom-evidence.webp"',
        "Content-Length": String(object.byteLength),
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Type": "image/webp",
        "Cross-Origin-Resource-Policy": "same-origin",
        ETag: `"${object.sha256}"`,
        Pragma: "no-cache",
        "Referrer-Policy": "no-referrer",
        Vary: "Cookie",
        "X-Content-Type-Options": "nosniff",
      },
      body,
    },
  });
}
