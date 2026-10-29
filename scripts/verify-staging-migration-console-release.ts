import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { z } from "zod";

export const STAGING_MIGRATION_CONSOLE_RELEASE = {
  version: "staging-migration-console-release/v1",
  preparedAt: "2026-09-23T18:37:38.000Z",
  candidate: {
    releaseSha: "cf2cb47e9690ecb3e9db986d7c69d99a5cf471be",
    parentShas: [
      "29c56b8247d97256b9522c2fae88ef62e289b91d",
      "e5da196da125285c7fe6bbedc8a1edab0a08702d",
    ],
    treeSha: "f672d5648259c4ebe3b46abd15796bacff8463a6",
  },
  migrations: [
    { name: "0056_durable_evidence_receipts.sql", blobSha: "e814860ba41398047702a4a63370c362bac11d93" },
    { name: "0057_fenced_evidence_resume_records.sql", blobSha: "22d421fdd7f8f1d7820151889933f678ae7753db" },
    { name: "0058_artifact_reference_projections.sql", blobSha: "450eda35d19d25d8fe81145e31cda079a541d632" },
    { name: "0059_atomic_artifact_reference_snapshots.sql", blobSha: "2c25d72bf4b3e777dea9668558a8afceec7f27f2" },
    { name: "0060_artifact_reference_source_writer_guards.sql", blobSha: "41d388d2014de235985a66777d70c0704a43dd4f" },
    { name: "0061_shadow_lead_assessment_receipts.sql", blobSha: "788f437428af6b5612bf480144a753cd0992eeab" },
    { name: "0062_append_only_contact_verification_records.sql", blobSha: "f52d3d11a80645a2217a1829abfb7113c6cf2d3b" },
    { name: "0063_harden_contact_record_lineage.sql", blobSha: "158729646511a4462c33611f47d74dfb8939dfb4" },
    { name: "0064_local_source_workflow_materializations.sql", blobSha: "d5c44b0e199cbe346c723669ab46290ea7eeab04" },
    { name: "0065_local_contact_persistence_receipts.sql", blobSha: "14115d15a7fbf25024f7e3b71dfac74fe8bc0f18" },
    { name: "0066_harden_local_contact_persistence_receipts.sql", blobSha: "c1561da410f3d9245cbb6b31bdad74068c7d803c" },
    { name: "0067_local_contact_invocation_receipts.sql", blobSha: "3684f481d064b29c4c9045757a7138ae49ec8366" },
    { name: "0068_current_website_evidence_eligibility_receipts.sql", blobSha: "37fb7dceb27b18008d511233b9f2d59191369a66" },
    { name: "0069_private_kw_m2_html_assessment_lineage.sql", blobSha: "34666cbe15b8d3c2788797cc901e543ce60b2923" },
    { name: "0070_revenue_cost_reservations.sql", blobSha: "e6e9997a301dc52724919bbacff95865265c3f7a" },
    { name: "0071_revenue_owner_tasks.sql", blobSha: "3aa799e48dbd5ca28db683a8bee000731802cc7d" },
    { name: "0072_revenue_business_stop.sql", blobSha: "1c8b1a840acf3fb9f9c41a5b431222675e9fb4ae" },
    { name: "0073_revenue_contact_suppression.sql", blobSha: "ded748311b5452c15eb483aa8cadb77d724990e3" },
    { name: "0074_revenue_owner_observed_replies.sql", blobSha: "ff81684658ee66a715ba348d68895bff670c9c50" },
  ],
  target: {
    environment: "staging",
    configPath: "wrangler.jsonc",
    configBlobSha: "ead3b564f3e333cf3f9b825707ead9dcba8271bf",
    workerName: "axiom-revenue-engine-console-staging",
    baseUrl: "https://axiom-revenue-engine-console-staging.aidan-magee2.workers.dev/",
    database: {
      binding: "DB",
      name: "axiom-revenue-engine-staging",
      id: "322fcf89-312c-44f0-b238-c4a348f6d6ad",
    },
    browserBinding: "BROWSER",
    assetsBinding: "ASSETS",
    cronTriggers: [],
    serviceBindings: [],
    autonomy: {
      intake: false,
      queue: false,
      send: false,
      dailyLeadCap: 0,
      dailySendCap: 0,
      dailyFollowUpCap: 0,
    },
  },
  ci: {
    provider: "GitHub Actions",
    runNumber: 118,
    runId: "35901772615",
    candidateSha: "cf2cb47e9690ecb3e9db986d7c69d99a5cf471be",
    status: "PASS",
    scope: "CI safety, tests, owner UI, typecheck, lint, Cloudflare build, default and engine no-upload dry runs",
  },
  rollback: {
    observationAt: "2026-09-23T17:11:00.000Z",
    workerVersionId: "941b37bc-38e8-4c6c-9111-d475e9871727",
    deploymentId: "c4bdd4af-85ec-4075-9a5a-7ded9f42add4",
    sourceSha: "7725098232829b7aca64a81d730db3b1729a5c7a",
    revalidation: "PENDING",
  },
  gates: {
    liveLedger: { status: "PENDING", evidence: null },
    liveStops: { status: "PENDING", evidence: null },
    freshExport: { status: "PENDING", path: null, sha256: null, evidence: null },
    offlineReplay: { status: "PENDING", evidence: null },
    localWranglerRestore: { status: "PENDING", evidence: null },
    exactStagingDryRun: {
      status: "PASS",
      command: "npx wrangler deploy --env staging --dry-run --autoconfig false",
      candidateSha: "cf2cb47e9690ecb3e9db986d7c69d99a5cf471be",
      databaseBinding: "axiom-revenue-engine-staging",
      autonomousIntake: false,
      autonomousQueue: false,
      autonomousSend: false,
      dailyLeadCap: 0,
      dailySendCap: 0,
      dailyFollowUpCap: 0,
      bundleFilesScanned: 1765,
      localSecretValuesRemoved: 0,
      uploadPerformed: false,
      evidence: "Fresh clean worktree; exact candidate; Wrangler exit 0; no upload.",
    },
    currentTimeTravelBookmark: { status: "PENDING", bookmark: null, evidence: null },
    migrationApproval: { status: "PENDING", evidence: null },
    deploymentApproval: { status: "PENDING", evidence: null },
    remoteMigration: { status: "PENDING", evidence: null },
    deployment: { status: "PENDING", evidence: null },
    postDeploySmoke: { status: "PENDING", evidence: null },
  },
  authority: {
    databaseMigrationAuthorized: false,
    deploymentAuthorized: false,
    providerOperationsAuthorized: 0,
    mailboxOperationsAuthorized: 0,
    prospectContactsAuthorized: 0,
    externalWebsiteRequestsAuthorized: 0,
    costAuthorizedCad: 0,
  },
};

const PendingEvidence = z.object({ status: z.literal("PENDING"), evidence: z.null() }).strict();

export const StagingMigrationConsoleReleaseSchema = z.object({
  version: z.literal("staging-migration-console-release/v1"),
  preparedAt: z.literal(STAGING_MIGRATION_CONSOLE_RELEASE.preparedAt),
  candidate: z.object({
    releaseSha: z.literal("cf2cb47e9690ecb3e9db986d7c69d99a5cf471be"),
    parentShas: z.tuple([z.literal("29c56b8247d97256b9522c2fae88ef62e289b91d"), z.literal("e5da196da125285c7fe6bbedc8a1edab0a08702d")]),
    treeSha: z.literal("f672d5648259c4ebe3b46abd15796bacff8463a6"),
  }).strict(),
  migrations: z.array(z.object({
    name: z.string().regex(/^\d{4}_[a-z0-9_]+\.sql$/),
    blobSha: z.string().regex(/^[0-9a-f]{40}$/),
  }).strict()).length(19),
  target: z.object({
    environment: z.literal("staging"),
    configPath: z.literal("wrangler.jsonc"),
    configBlobSha: z.literal("ead3b564f3e333cf3f9b825707ead9dcba8271bf"),
    workerName: z.literal("axiom-revenue-engine-console-staging"),
    baseUrl: z.literal("https://axiom-revenue-engine-console-staging.aidan-magee2.workers.dev/"),
    database: z.object({
      binding: z.literal("DB"),
      name: z.literal("axiom-revenue-engine-staging"),
      id: z.literal("322fcf89-312c-44f0-b238-c4a348f6d6ad"),
    }).strict(),
    browserBinding: z.literal("BROWSER"),
    assetsBinding: z.literal("ASSETS"),
    cronTriggers: z.tuple([]),
    serviceBindings: z.tuple([]),
    autonomy: z.object({
      intake: z.literal(false), queue: z.literal(false), send: z.literal(false),
      dailyLeadCap: z.literal(0), dailySendCap: z.literal(0), dailyFollowUpCap: z.literal(0),
    }).strict(),
  }).strict(),
  ci: z.object({
    provider: z.literal("GitHub Actions"),
    runNumber: z.literal(118),
    runId: z.literal("35901772615"),
    candidateSha: z.literal("cf2cb47e9690ecb3e9db986d7c69d99a5cf471be"),
    status: z.literal("PASS"),
    scope: z.literal(STAGING_MIGRATION_CONSOLE_RELEASE.ci.scope),
  }).strict(),
  rollback: z.object({
    observationAt: z.literal("2026-09-23T17:11:00.000Z"),
    workerVersionId: z.literal("941b37bc-38e8-4c6c-9111-d475e9871727"),
    deploymentId: z.literal("c4bdd4af-85ec-4075-9a5a-7ded9f42add4"),
    sourceSha: z.literal("7725098232829b7aca64a81d730db3b1729a5c7a"),
    revalidation: z.literal("PENDING"),
  }).strict(),
  gates: z.object({
    liveLedger: PendingEvidence,
    liveStops: PendingEvidence,
    freshExport: z.object({ status: z.literal("PENDING"), path: z.null(), sha256: z.null(), evidence: z.null() }).strict(),
    offlineReplay: PendingEvidence,
    localWranglerRestore: PendingEvidence,
    exactStagingDryRun: z.object({
      status: z.literal("PASS"),
      command: z.literal("npx wrangler deploy --env staging --dry-run --autoconfig false"),
      candidateSha: z.literal("cf2cb47e9690ecb3e9db986d7c69d99a5cf471be"),
      databaseBinding: z.literal("axiom-revenue-engine-staging"),
      autonomousIntake: z.literal(false),
      autonomousQueue: z.literal(false),
      autonomousSend: z.literal(false),
      dailyLeadCap: z.literal(0),
      dailySendCap: z.literal(0),
      dailyFollowUpCap: z.literal(0),
      bundleFilesScanned: z.literal(1765),
      localSecretValuesRemoved: z.literal(0),
      uploadPerformed: z.literal(false),
      evidence: z.literal("Fresh clean worktree; exact candidate; Wrangler exit 0; no upload."),
    }).strict(),
    currentTimeTravelBookmark: z.object({ status: z.literal("PENDING"), bookmark: z.null(), evidence: z.null() }).strict(),
    migrationApproval: PendingEvidence,
    deploymentApproval: PendingEvidence,
    remoteMigration: PendingEvidence,
    deployment: PendingEvidence,
    postDeploySmoke: PendingEvidence,
  }).strict(),
  authority: z.object({
    databaseMigrationAuthorized: z.literal(false),
    deploymentAuthorized: z.literal(false),
    providerOperationsAuthorized: z.literal(0),
    mailboxOperationsAuthorized: z.literal(0),
    prospectContactsAuthorized: z.literal(0),
    externalWebsiteRequestsAuthorized: z.literal(0),
    costAuthorizedCad: z.literal(0),
  }).strict(),
}).strict().superRefine((packet, context) => {
  STAGING_MIGRATION_CONSOLE_RELEASE.migrations.forEach((expected, index) => {
    const actual = packet.migrations[index];
    if (actual?.name !== expected.name || actual.blobSha !== expected.blobSha) {
      context.addIssue({
        code: "custom",
        message: "Migration names and Git blob hashes must match the exact ordered 0056–0074 candidate list.",
        path: ["migrations", index],
      });
    }
  });
});

export type StagingMigrationConsoleRelease = z.infer<typeof StagingMigrationConsoleReleaseSchema>;

export type StagingMigrationGitReader = {
  commitExists(sha: string): boolean;
  treeSha(sha: string): string;
  blobSha(sha: string, path: string): string | null;
  isAncestorOfHead(sha: string): boolean;
};

export function verifyStagingMigrationConsoleReleaseAgainstGit(
  value: unknown,
  git: StagingMigrationGitReader,
): StagingMigrationConsoleRelease {
  const packet = StagingMigrationConsoleReleaseSchema.parse(value);
  if (!git.commitExists(packet.candidate.releaseSha)) throw new Error("Migration release candidate commit does not exist locally.");
  if (!git.isAncestorOfHead(packet.candidate.releaseSha)) throw new Error("Migration release candidate is not contained in current repository history.");
  if (git.treeSha(packet.candidate.releaseSha) !== packet.candidate.treeSha) throw new Error("Migration release candidate tree does not match the packet.");
  for (const migration of packet.migrations) {
    if (git.blobSha(packet.candidate.releaseSha, `migrations/${migration.name}`) !== migration.blobSha) {
      throw new Error(`Migration blob does not match the packet: ${migration.name}`);
    }
  }
  if (git.blobSha(packet.candidate.releaseSha, packet.target.configPath) !== packet.target.configBlobSha) {
    throw new Error("Staging config blob does not match the packet.");
  }
  return packet;
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIR, "..");
const PACKET_ROOT = resolve(REPOSITORY_ROOT, "docs", "releases", "staging");

function git(args: string[]) {
  return execFileSync("git", args, {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  }).trim();
}

function createLocalGitReader(): StagingMigrationGitReader {
  return {
    commitExists(sha) {
      try { return git(["cat-file", "-t", `${sha}^{commit}`]) === "commit"; } catch { return false; }
    },
    treeSha(sha) { return git(["show", "-s", "--format=%T", sha]); },
    blobSha(sha, path) {
      const line = git(["ls-tree", sha, "--", path]);
      return /^100644 blob ([0-9a-f]{40})\t/.exec(line)?.[1] ?? null;
    },
    isAncestorOfHead(sha) {
      try {
        execFileSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"], {
          cwd: REPOSITORY_ROOT, stdio: "ignore", windowsHide: true,
        });
        return true;
      } catch { return false; }
    },
  };
}

function resolvePacketPath(input: string) {
  const packetPath = resolve(REPOSITORY_ROOT, input);
  const fromRoot = relative(PACKET_ROOT, packetPath);
  if (isAbsolute(fromRoot) || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || extname(packetPath).toLowerCase() !== ".json") {
    throw new Error("Migration release packet must be one JSON file under docs/releases/staging/.");
  }
  return packetPath;
}

function canonicalJson(value: unknown): string {
  const sortKeys = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sortKeys);
    if (item && typeof item === "object") {
      return Object.fromEntries(Object.entries(item as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortKeys(child)]));
    }
    return item;
  };
  return JSON.stringify(sortKeys(value));
}

export function stagingMigrationPacketDigest(packet: StagingMigrationConsoleRelease): string {
  return createHash("sha256").update(canonicalJson(packet)).digest("hex");
}

export async function verifyStagingMigrationConsoleReleaseFile(input: string) {
  const packetPath = resolvePacketPath(input);
  const repositoryPath = relative(REPOSITORY_ROOT, packetPath).split(sep).join("/");
  let trackedPath: string;
  try {
    trackedPath = git(["ls-files", "--error-unmatch", "--", repositoryPath]);
  } catch {
    throw new Error("Migration release packet must be committed or staged in this repository.");
  }
  if (trackedPath !== repositoryPath) throw new Error("Migration release packet Git identity is ambiguous.");
  const indexBlob = git(["rev-parse", `:${repositoryPath}`]);
  const worktreeBlob = git(["hash-object", "--", repositoryPath]);
  if (indexBlob !== worktreeBlob) throw new Error("Migration release packet working copy differs from its staged or committed Git blob.");
  const metadata = await stat(packetPath);
  if (!metadata.isFile() || metadata.size > 100_000) throw new Error("Migration release packet is missing or exceeds the 100 KB limit.");
  const packetBytes = await readFile(packetPath);
  const packet = verifyStagingMigrationConsoleReleaseAgainstGit(
    JSON.parse(packetBytes.toString("utf8")) as unknown,
    createLocalGitReader(),
  );
  return {
    packet,
    packetSha256: stagingMigrationPacketDigest(packet),
  };
}

async function run() {
  const input = process.argv[2];
  if (!input || process.argv.length !== 3) throw new Error("Usage: npx tsx scripts/verify-staging-migration-console-release.ts docs/releases/staging/<packet>.json");
  const { packet, packetSha256 } = await verifyStagingMigrationConsoleReleaseFile(input);
  console.log(`Verified pending staging migration packet for ${packet.candidate.releaseSha}.`);
  console.log(`Canonical packet SHA-256: ${packetSha256}`);
  console.log(`Migrations bound: ${packet.migrations.length} (0056–0074).`);
  console.log("Live migration/deployment approvals: pending; authority: false.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : "Staging migration release verification failed.");
    process.exitCode = 1;
  });
}
