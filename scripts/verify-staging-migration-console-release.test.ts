import assert from "node:assert/strict";
import test from "node:test";

import {
  STAGING_MIGRATION_CONSOLE_RELEASE,
  stagingMigrationPacketDigest,
  verifyStagingMigrationConsoleReleaseAgainstGit,
} from "./verify-staging-migration-console-release";

const clonePacket = () => structuredClone(STAGING_MIGRATION_CONSOLE_RELEASE);

function gitReader(overrides: Partial<{
  commitExists: (sha: string) => boolean;
  treeSha: (sha: string) => string;
  blobSha: (sha: string, path: string) => string | null;
  isAncestorOfHead: (sha: string) => boolean;
}> = {}) {
  return {
    commitExists: overrides.commitExists ?? (() => true),
    treeSha: overrides.treeSha ?? (() => STAGING_MIGRATION_CONSOLE_RELEASE.candidate.treeSha),
    blobSha: overrides.blobSha ?? ((_sha: string, path: string) => path === "wrangler.jsonc"
      ? STAGING_MIGRATION_CONSOLE_RELEASE.target.configBlobSha
      : STAGING_MIGRATION_CONSOLE_RELEASE.migrations.find((migration) => `migrations/${migration.name}` === path)?.blobSha ?? null),
    isAncestorOfHead: overrides.isAncestorOfHead ?? (() => true),
  };
}

test("accepts the exact pending migration and console packet against matching Git objects", () => {
  const packet = verifyStagingMigrationConsoleReleaseAgainstGit(
    clonePacket(),
    gitReader(),
  );
  assert.equal(packet.candidate.releaseSha, "cf2cb47e9690ecb3e9db986d7c69d99a5cf471be");
  assert.equal(packet.migrations.length, 19);
  assert.equal(packet.gates.remoteMigration.status, "PENDING");
  assert.equal(packet.gates.exactStagingDryRun.status, "PASS");
});

test("rejects a reordered migration sequence", () => {
  const packet = clonePacket();
  [packet.migrations[0], packet.migrations[1]] = [packet.migrations[1], packet.migrations[0]];
  assert.throws(() => verifyStagingMigrationConsoleReleaseAgainstGit(packet, gitReader()));
});

test("rejects a changed migration blob and an extra migration", () => {
  const changed = clonePacket();
  changed.migrations[0].blobSha = "0".repeat(40);
  assert.throws(() => verifyStagingMigrationConsoleReleaseAgainstGit(changed, gitReader()));

  const extra = clonePacket();
  extra.migrations.push({ ...extra.migrations[18] });
  assert.throws(() => verifyStagingMigrationConsoleReleaseAgainstGit(extra, gitReader()));
});

test("rejects a wrong candidate commit and mismatched Git tree", () => {
  const wrongCommit = clonePacket();
  wrongCommit.candidate.releaseSha = "1".repeat(40);
  assert.throws(() => verifyStagingMigrationConsoleReleaseAgainstGit(wrongCommit, gitReader()));

  assert.throws(() => verifyStagingMigrationConsoleReleaseAgainstGit(
    clonePacket(),
    gitReader({ treeSha: () => "2".repeat(40) }),
  ));
});

test("rejects a wrong staging config blob or target identity", () => {
  const wrongConfig = clonePacket();
  wrongConfig.target.configBlobSha = "3".repeat(40);
  assert.throws(() => verifyStagingMigrationConsoleReleaseAgainstGit(wrongConfig, gitReader()));

  const wrongTarget = clonePacket();
  wrongTarget.target.database.id = "00000000-0000-0000-0000-000000000000";
  assert.throws(() => verifyStagingMigrationConsoleReleaseAgainstGit(wrongTarget, gitReader()));
});

test("rejects any claimed completed live gate or authority", () => {
  const completedGate = clonePacket();
  completedGate.gates.freshExport.status = "PASS" as "PENDING";
  assert.throws(() => verifyStagingMigrationConsoleReleaseAgainstGit(completedGate, gitReader()));

  const authorized = clonePacket();
  authorized.authority.databaseMigrationAuthorized = true as false;
  assert.throws(() => verifyStagingMigrationConsoleReleaseAgainstGit(authorized, gitReader()));
});

test("rejects overstated staging dry-run evidence", () => {
  const packet = clonePacket();
  packet.gates.exactStagingDryRun.databaseBinding = "axiom-ops-omniscient" as "axiom-revenue-engine-staging";
  assert.throws(() => verifyStagingMigrationConsoleReleaseAgainstGit(packet, gitReader()));

  const uploadClaim = clonePacket();
  uploadClaim.gates.exactStagingDryRun.uploadPerformed = true as false;
  assert.throws(() => verifyStagingMigrationConsoleReleaseAgainstGit(uploadClaim, gitReader()));
});

test("the packet digest is stable across JSON key order and line endings", () => {
  const packet = verifyStagingMigrationConsoleReleaseAgainstGit(clonePacket(), gitReader());
  const reordered = Object.fromEntries(Object.entries(packet).reverse()) as typeof packet;
  const crlfFormatted = JSON.parse(JSON.stringify(reordered, null, 2).replace(/\n/g, "\r\n")) as typeof packet;
  assert.equal(stagingMigrationPacketDigest(packet), "1cf2ec39d471281c76d8e52caf99245d2f09c1114f7c1b81bd9da40cfe5fd66e");
  assert.equal(stagingMigrationPacketDigest(crlfFormatted), stagingMigrationPacketDigest(packet));
});
