import assert from "node:assert/strict";
import test from "node:test";

import {
  STAGING_CONSOLE_SOURCE_PATHS,
  StagingConsoleReleasePacketSchema,
  buildStagingConsoleReleasePacket,
  verifyStagingConsoleReleaseAgainstGit,
  type StagingConsoleGitReader,
  type StagingConsoleReleaseCore,
} from "@/lib/revenue-engine/staging-console-release";

const releaseSha = "a".repeat(40);
const treeSha = "b".repeat(40);

function core(): StagingConsoleReleaseCore {
  return {
    version: "staging-console-release/v1",
    preparedAt: "2026-08-28T23:33:38.568Z",
    preparedBy: "CODEX_INTEGRATION_OWNER",
    candidate: {
      releaseSha,
      parentSha: "c".repeat(40),
      treeSha,
      committedAt: "2026-08-28T23:30:13.000Z",
      subject: "feat-owner-quality-lab",
      sourceBlobs: STAGING_CONSOLE_SOURCE_PATHS.map((path, index) => ({
        path,
        blobSha: index.toString(16).padStart(40, "0"),
      })),
    },
    scope: {
      ownerRoutes: ["/leads", "/leads/[businessId]", "/leads/evaluation"],
      apiRoutes: ["/api/v1/leads", "/api/v1/leads/[businessId]", "/api/v1/leads/evaluation/validate"],
      dataPolicy: "SYNTHETIC_ONLY",
      engineWorkerIncluded: false,
      databaseMigrationIncluded: false,
      providerIntegrationIncluded: false,
      mailboxIntegrationIncluded: false,
    },
    target: {
      environment: "staging",
      workerName: "axiom-revenue-engine-console-staging",
      baseUrl: "https://axiom-revenue-engine-console-staging.aidan-magee2.workers.dev/",
      database: { binding: "DB", name: "axiom-revenue-engine-staging", id: "322fcf89-312c-44f0-b238-c4a348f6d6ad" },
      browserBinding: "BROWSER",
      assetsBinding: "ASSETS",
      expectedSecretNames: ["BETTER_AUTH_SECRET"],
      providerSecretNames: [],
      serviceBindings: [],
      queueBindings: [],
      cronTriggers: [],
    },
    verification: {
      verifiedAt: "2026-08-28T23:33:38.568Z",
      platform: "windows-local",
      safety: { command: "npm run check:safety", status: "PASS" },
      unitTests: { command: "npm test", status: "PASS", total: 449, failed: 0 },
      typecheck: { command: "npm run typecheck", status: "PASS" },
      lint: { command: "npm run lint", status: "PASS" },
      cloudflareBuild: { command: "npm run build:cloudflare", status: "PASS", sanitizedFiles: 2018, localSecretValuesRemoved: 1 },
      defaultDryRun: { command: "npx wrangler deploy --env=\"\" --dry-run --autoconfig false", status: "PASS" },
      stagingDryRun: {
        command: "npx wrangler deploy --env staging --dry-run --autoconfig false",
        status: "PASS",
        databaseBinding: "axiom-revenue-engine-staging",
        autonomousIntake: false,
        autonomousQueue: false,
        autonomousSend: false,
        dailyLeadCap: 0,
        dailySendCap: 0,
        dailyFollowUpCap: 0,
      },
      ownerUi: {
        command: "npm run test:owner-ui",
        status: "PASS",
        pagesScanned: 6,
        externalRequests: 0,
        desktopListReadyMs: 492,
        desktopDossierReadyMs: 2361,
        desktopWidth: 1440,
        mobileWidth: 390,
      },
      linuxCi: { status: "PENDING", runId: null },
      stagingSmoke: { status: "NOT_RUN", reason: "DEPLOYMENT_NOT_AUTHORIZED" },
      knownWarnings: ["OPENNEXT_WINDOWS_COMPATIBILITY_WARNING", "GENERATED_DUPLICATE_OPTIONS_WARNING"],
    },
    rollback: {
      sourceSha: "7725098232829b7aca64a81d730db3b1729a5c7a",
      codeVersion: "941b37bc-38e8-4c6c-9111-d475e9871727",
      deploymentId: "c4bdd4af-85ec-4075-9a5a-7ded9f42add4",
      action: "RESTORE_RECORDED_STAGING_VERSION",
      databaseRollbackRequired: false,
    },
    approval: {
      status: "PENDING",
      requiredPhrase: "DEPLOY AXIOM REVENUE ENGINE CONSOLE TO ISOLATED STAGING",
      approvedBy: null,
      approvedAt: null,
    },
    readiness: "PREPARED_NOT_APPROVED",
    authority: {
      deploymentAuthorized: false,
      databaseMigrationAuthorized: false,
      engineDeploymentAuthorized: false,
      providerOperationsAuthorized: 0,
      externalWebsiteRequestsAuthorized: 0,
      mailboxOperationsAuthorized: 0,
      prospectContactsAuthorized: 0,
      costAuthorizedCad: 0,
    },
  };
}

function gitReader(input = core()): StagingConsoleGitReader {
  const blobs = new Map(input.candidate.sourceBlobs.map((source) => [source.path, source.blobSha]));
  return {
    commitExists: (sha) => sha === input.candidate.releaseSha,
    treeSha: () => input.candidate.treeSha,
    blobSha: (_sha, path) => blobs.get(path as typeof STAGING_CONSOLE_SOURCE_PATHS[number]) ?? null,
    isAncestorOfHead: () => true,
  };
}

test("builds one exact staging console release packet with zero deployment authority", () => {
  const packet = buildStagingConsoleReleasePacket(core());
  assert.match(packet.packetId, /^staging-console-release:[0-9a-f]{64}$/);
  assert.equal(packet.candidate.sourceBlobs.length, STAGING_CONSOLE_SOURCE_PATHS.length);
  assert.equal(packet.target.database.name, "axiom-revenue-engine-staging");
  assert.equal(packet.approval.status, "PENDING");
  assert.equal(packet.verification.linuxCi.status, "PENDING");
  assert.equal(packet.authority.deploymentAuthorized, false);
  assert.equal(packet.authority.databaseMigrationAuthorized, false);
  assert.equal(packet.authority.providerOperationsAuthorized, 0);
  assert.equal(packet.authority.prospectContactsAuthorized, 0);
  assert.equal(packet.authority.costAuthorizedCad, 0);
  assert.deepEqual(verifyStagingConsoleReleaseAgainstGit(packet, gitReader()), packet);
});

test("rejects content tampering, a wrong target, and any attempt to grant authority", () => {
  const packet = buildStagingConsoleReleasePacket(core());
  assert.throws(() => StagingConsoleReleasePacketSchema.parse({ ...packet, packetDigest: "f".repeat(64) }), /digest/i);
  assert.throws(() => buildStagingConsoleReleasePacket({ ...core(), target: { ...core().target, environment: "production" as "staging" } }), /staging/i);
  assert.throws(() => buildStagingConsoleReleasePacket({ ...core(), authority: { ...core().authority, deploymentAuthorized: true as false } }), /false/i);
});

test("rejects source omissions, reordering, Git drift, and a candidate outside current history", () => {
  const source = core();
  const reordered = [...source.candidate.sourceBlobs];
  [reordered[0], reordered[1]] = [reordered[1]!, reordered[0]!];
  assert.throws(() => buildStagingConsoleReleasePacket({ ...source, candidate: { ...source.candidate, sourceBlobs: reordered } }), /ordered owner-console release surface/i);

  const packet = buildStagingConsoleReleasePacket(source);
  assert.throws(() => verifyStagingConsoleReleaseAgainstGit(packet, { ...gitReader(source), treeSha: () => "d".repeat(40) }), /tree/i);
  assert.throws(() => verifyStagingConsoleReleaseAgainstGit(packet, { ...gitReader(source), blobSha: () => "e".repeat(40) }), /source blob/i);
  assert.throws(() => verifyStagingConsoleReleaseAgainstGit(packet, { ...gitReader(source), isAncestorOfHead: () => false }), /current repository history/i);
});
