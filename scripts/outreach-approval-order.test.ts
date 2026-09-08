import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import Database from "better-sqlite3";
import type { D1DatabaseLike, D1PreparedStatementLike } from "../src/lib/cloudflare";
import { buildOutreachContentDigest, requireOutreachApproval } from "../src/lib/outreach-approval";

test("latest approval selection normalizes times and orders same-second inserts monotonically", async () => {
  const content = { bodyHtml: "<p>Fixture</p>", bodyPlain: "Fixture", campaignKey: "fixture",
    leadId: 1, messagePolicyVersion: "fixture-v1", recipientEmail: "client@example.invalid",
    sequenceId: "sequence", sequenceStepId: "step", subject: "Fixture", variantKey: "fixture" };
  const digest = await buildOutreachContentDigest(content);
  for (const scenario of ["mixed", "same-second", "invalid", "approved"] as const) {
    // Selection-only fixture; real 0055 table with minimal referenced identities.
    const sqlite = new Database(":memory:");
    sqlite.exec(`CREATE TABLE "Lead" (id INTEGER PRIMARY KEY);
      CREATE TABLE "OutreachSequence" (id TEXT PRIMARY KEY);
      CREATE TABLE "OutreachSequenceStep" (id TEXT PRIMARY KEY);
      CREATE TABLE "User" (id TEXT PRIMARY KEY);
      INSERT INTO "Lead" VALUES (1);
      INSERT INTO "OutreachSequence" VALUES ('sequence');
      INSERT INTO "OutreachSequenceStep" VALUES ('step');`);
    sqlite.exec(readFileSync("migrations/0055_outreach_human_approval.sql", "utf8"));
    const insert = (id: string, decision: string, createdAt: string) => sqlite.prepare(
      `INSERT INTO "OutreachApproval" ("id", "approvalKey", "leadId", "sequenceId", "sequenceStepId",
      "recipientEmail", "contentDigest", "decision", "createdAt", "decidedAt") VALUES (?, ?, 1, 'sequence', 'step', ?, ?, ?, ?, ?)`,
    ).run(id, id, content.recipientEmail, digest, decision, createdAt, decision === "APPROVED" ? "2026-08-16T15:00:00Z" : null);
    const database: D1DatabaseLike = { prepare(sql) {
      let values: unknown[] = [];
      const statement = sqlite.prepare(sql);
      const prepared: D1PreparedStatementLike = {
        bind(...args) { values = args; return prepared; },
        async first<T>() { return (statement.get(...values) ?? null) as T | null; },
        async all() { throw new Error("Unexpected query"); },
        async run() { throw new Error("Unexpected mutation"); },
      };
      return prepared;
    } };
    try {
      insert("z-older", "APPROVED", "2026-08-16T13:00:00Z");
      insert("a-newer", scenario === "approved" ? "APPROVED" : "PENDING",
        scenario === "invalid" ? "invalid" : scenario === "same-second" ? "2026-08-16T13:00:00Z" : "2026-08-16 14:00:00");
      if (scenario === "mixed" || scenario === "same-second") {
        assert.deepEqual(sqlite.prepare(`SELECT "id", "decision" FROM "OutreachApproval"
          ORDER BY "createdAt" DESC, "id" DESC LIMIT 1`).get(), { id: "z-older", decision: "APPROVED" });
      }
      const result = await requireOutreachApproval(content, database);
      assert.equal(result.allowed, scenario === "approved", scenario);
      assert.equal(result.reason, scenario === "approved" ? "approved" : scenario === "invalid" ? "approval_invalid_time" : "approval_not_approved");
    } finally { sqlite.close(); }
  }
});
