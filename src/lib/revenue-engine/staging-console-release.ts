import { createHash } from "node:crypto";

import { z } from "zod";

export const STAGING_CONSOLE_RELEASE_VERSION = "staging-console-release/v1" as const;

export const STAGING_CONSOLE_SOURCE_PATHS = [
  "package-lock.json",
  "wrangler.jsonc",
  "scripts/check-safety-config.mjs",
  "scripts/verify-owner-ui-acceptance.ts",
  "src/app/api/v1/leads/[businessId]/route.ts",
  "src/app/api/v1/leads/evaluation/validate/route.ts",
  "src/app/api/v1/leads/route.ts",
  "src/app/leads/[businessId]/page.tsx",
  "src/app/leads/evaluation/page.tsx",
  "src/app/leads/page.tsx",
  "src/components/leads/owner-lead-detail.tsx",
  "src/components/leads/owner-lead-evaluation-workspace.tsx",
  "src/components/leads/owner-lead-list.tsx",
  "src/lib/revenue-engine/owner-labeling-upload.ts",
  "src/lib/revenue-engine/owner-labeling-workspace.ts",
  "src/lib/revenue-engine/owner-lead-detail-read-model.ts",
  "src/lib/revenue-engine/owner-lead-projection.ts",
  "src/lib/revenue-engine/owner-lead-read-model.ts",
] as const;

export const STAGING_CONSOLE_OWNER_ROUTES = [
  "/leads",
  "/leads/[businessId]",
  "/leads/evaluation",
] as const;

export const STAGING_CONSOLE_API_ROUTES = [
  "/api/v1/leads",
  "/api/v1/leads/[businessId]",
  "/api/v1/leads/evaluation/validate",
] as const;

const GitShaSchema = z.string().regex(/^[0-9a-f]{40}$/);
const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const EmptyStringArraySchema = z.array(z.string()).max(0);

const SourceBlobSchema = z.object({
  path: z.enum(STAGING_CONSOLE_SOURCE_PATHS),
  blobSha: GitShaSchema,
}).strict();

const PassedCommandSchema = z.object({
  command: z.string().trim().min(1).max(180),
  status: z.literal("PASS"),
}).strict();

const StagingConsoleReleaseCoreBaseSchema = z.object({
  version: z.literal(STAGING_CONSOLE_RELEASE_VERSION),
  preparedAt: z.string().datetime({ offset: true }),
  preparedBy: z.enum(["RILEY", "AIDAN", "CODEX_INTEGRATION_OWNER"]),
  candidate: z.object({
    releaseSha: GitShaSchema,
    parentSha: GitShaSchema,
    treeSha: GitShaSchema,
    committedAt: z.string().datetime({ offset: true }),
    subject: z.string().trim().min(1).max(120),
    sourceBlobs: z.array(SourceBlobSchema).length(STAGING_CONSOLE_SOURCE_PATHS.length),
  }).strict(),
  scope: z.object({
    ownerRoutes: z.tuple([
      z.literal(STAGING_CONSOLE_OWNER_ROUTES[0]),
      z.literal(STAGING_CONSOLE_OWNER_ROUTES[1]),
      z.literal(STAGING_CONSOLE_OWNER_ROUTES[2]),
    ]),
    apiRoutes: z.tuple([
      z.literal(STAGING_CONSOLE_API_ROUTES[0]),
      z.literal(STAGING_CONSOLE_API_ROUTES[1]),
      z.literal(STAGING_CONSOLE_API_ROUTES[2]),
    ]),
    dataPolicy: z.literal("SYNTHETIC_ONLY"),
    engineWorkerIncluded: z.literal(false),
    databaseMigrationIncluded: z.literal(false),
    providerIntegrationIncluded: z.literal(false),
    mailboxIntegrationIncluded: z.literal(false),
  }).strict(),
  target: z.object({
    environment: z.literal("staging"),
    workerName: z.literal("axiom-revenue-engine-console-staging"),
    baseUrl: z.literal("https://axiom-revenue-engine-console-staging.aidan-magee2.workers.dev/"),
    database: z.object({
      binding: z.literal("DB"),
      name: z.literal("axiom-revenue-engine-staging"),
      id: z.literal("322fcf89-312c-44f0-b238-c4a348f6d6ad"),
    }).strict(),
    browserBinding: z.literal("BROWSER"),
    assetsBinding: z.literal("ASSETS"),
    expectedSecretNames: z.tuple([z.literal("BETTER_AUTH_SECRET")]),
    providerSecretNames: EmptyStringArraySchema,
    serviceBindings: EmptyStringArraySchema,
    queueBindings: EmptyStringArraySchema,
    cronTriggers: EmptyStringArraySchema,
  }).strict(),
  verification: z.object({
    verifiedAt: z.string().datetime({ offset: true }),
    platform: z.literal("windows-local"),
    safety: PassedCommandSchema,
    unitTests: PassedCommandSchema.extend({
      total: z.number().int().positive(),
      failed: z.literal(0),
    }).strict(),
    typecheck: PassedCommandSchema,
    lint: PassedCommandSchema,
    cloudflareBuild: PassedCommandSchema.extend({
      sanitizedFiles: z.number().int().positive(),
      localSecretValuesRemoved: z.number().int().nonnegative(),
    }).strict(),
    defaultDryRun: PassedCommandSchema,
    stagingDryRun: PassedCommandSchema.extend({
      databaseBinding: z.literal("axiom-revenue-engine-staging"),
      autonomousIntake: z.literal(false),
      autonomousQueue: z.literal(false),
      autonomousSend: z.literal(false),
      dailyLeadCap: z.literal(0),
      dailySendCap: z.literal(0),
      dailyFollowUpCap: z.literal(0),
    }).strict(),
    ownerUi: PassedCommandSchema.extend({
      pagesScanned: z.number().int().min(6),
      externalRequests: z.literal(0),
      desktopListReadyMs: z.number().int().nonnegative().max(10_000),
      desktopDossierReadyMs: z.number().int().nonnegative().max(15_000),
      desktopWidth: z.literal(1440),
      mobileWidth: z.literal(390),
    }).strict(),
    linuxCi: z.object({
      status: z.literal("PENDING"),
      runId: z.null(),
    }).strict(),
    stagingSmoke: z.object({
      status: z.literal("NOT_RUN"),
      reason: z.literal("DEPLOYMENT_NOT_AUTHORIZED"),
    }).strict(),
    knownWarnings: z.tuple([
      z.literal("OPENNEXT_WINDOWS_COMPATIBILITY_WARNING"),
      z.literal("GENERATED_DUPLICATE_OPTIONS_WARNING"),
    ]),
  }).strict(),
  rollback: z.object({
    sourceSha: z.literal("7725098232829b7aca64a81d730db3b1729a5c7a"),
    codeVersion: z.literal("941b37bc-38e8-4c6c-9111-d475e9871727"),
    deploymentId: z.literal("c4bdd4af-85ec-4075-9a5a-7ded9f42add4"),
    action: z.literal("RESTORE_RECORDED_STAGING_VERSION"),
    databaseRollbackRequired: z.literal(false),
  }).strict(),
  approval: z.object({
    status: z.literal("PENDING"),
    requiredPhrase: z.literal("DEPLOY AXIOM REVENUE ENGINE CONSOLE TO ISOLATED STAGING"),
    approvedBy: z.null(),
    approvedAt: z.null(),
  }).strict(),
  readiness: z.literal("PREPARED_NOT_APPROVED"),
  authority: z.object({
    deploymentAuthorized: z.literal(false),
    databaseMigrationAuthorized: z.literal(false),
    engineDeploymentAuthorized: z.literal(false),
    providerOperationsAuthorized: z.literal(0),
    externalWebsiteRequestsAuthorized: z.literal(0),
    mailboxOperationsAuthorized: z.literal(0),
    prospectContactsAuthorized: z.literal(0),
    costAuthorizedCad: z.literal(0),
  }).strict(),
}).strict();

export const StagingConsoleReleaseCoreSchema = StagingConsoleReleaseCoreBaseSchema.superRefine((value, context) => {
  value.candidate.sourceBlobs.forEach((source, index) => {
    if (source.path !== STAGING_CONSOLE_SOURCE_PATHS[index]) {
      context.addIssue({
        code: "custom",
        message: "Source blobs must contain the exact ordered owner-console release surface.",
        path: ["candidate", "sourceBlobs", index, "path"],
      });
    }
  });
});

export type StagingConsoleReleaseCore = z.infer<typeof StagingConsoleReleaseCoreSchema>;

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalValue(child)]));
  }
  return value;
}

export function stagingConsoleReleaseCanonicalJson(value: unknown) {
  return JSON.stringify(canonicalValue(value));
}

export function stagingConsoleReleaseDigest(value: StagingConsoleReleaseCore) {
  const parsed = StagingConsoleReleaseCoreSchema.parse(value);
  return createHash("sha256").update(stagingConsoleReleaseCanonicalJson(parsed)).digest("hex");
}

export const StagingConsoleReleasePacketSchema = StagingConsoleReleaseCoreSchema.and(z.object({
  packetId: z.string().regex(/^staging-console-release:[0-9a-f]{64}$/),
  packetDigest: Sha256Schema,
}).strict()).superRefine((value, context) => {
  const { packetId: _packetId, packetDigest: _packetDigest, ...core } = value;
  void _packetId;
  void _packetDigest;
  const expectedDigest = stagingConsoleReleaseDigest(core);
  if (value.packetDigest !== expectedDigest) {
    context.addIssue({ code: "custom", message: "Packet digest must bind the exact staging release content.", path: ["packetDigest"] });
  }
  if (value.packetId !== `staging-console-release:${expectedDigest}`) {
    context.addIssue({ code: "custom", message: "Packet identity must derive from the exact packet digest.", path: ["packetId"] });
  }
});

export type StagingConsoleReleasePacket = z.infer<typeof StagingConsoleReleasePacketSchema>;

export function buildStagingConsoleReleasePacket(input: StagingConsoleReleaseCore): StagingConsoleReleasePacket {
  const core = StagingConsoleReleaseCoreSchema.parse(input);
  const packetDigest = stagingConsoleReleaseDigest(core);
  return StagingConsoleReleasePacketSchema.parse({
    ...core,
    packetId: `staging-console-release:${packetDigest}`,
    packetDigest,
  });
}

export type StagingConsoleGitReader = {
  commitExists(sha: string): boolean;
  treeSha(sha: string): string;
  blobSha(sha: string, path: string): string | null;
  isAncestorOfHead(sha: string): boolean;
};

export function verifyStagingConsoleReleaseAgainstGit(
  value: unknown,
  git: StagingConsoleGitReader,
): StagingConsoleReleasePacket {
  const packet = StagingConsoleReleasePacketSchema.parse(value);
  if (!git.commitExists(packet.candidate.releaseSha)) throw new Error("Release candidate commit does not exist locally.");
  if (!git.isAncestorOfHead(packet.candidate.releaseSha)) throw new Error("Release candidate is not contained in the current repository history.");
  if (git.treeSha(packet.candidate.releaseSha) !== packet.candidate.treeSha) throw new Error("Release candidate tree does not match the packet.");
  for (const source of packet.candidate.sourceBlobs) {
    if (git.blobSha(packet.candidate.releaseSha, source.path) !== source.blobSha) {
      throw new Error(`Release source blob does not match the packet: ${source.path}`);
    }
  }
  return packet;
}
