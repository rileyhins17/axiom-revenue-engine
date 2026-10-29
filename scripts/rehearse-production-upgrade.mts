// Local rehearsal of the legacy production upgrade (0053-0074) on a pinned private
// export. Restores into a temporary SQLite file, applies each migration in order,
// and reports integrity, foreign keys, stops and per-table row-count changes.
// Prints counts only; no row contents.
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const [exportPath, expectedSha] = process.argv.slice(2);
if (!exportPath || !expectedSha) throw new Error("Usage: rehearse-production-upgrade.mts <export.sql> <sha256>");
const bytes = readFileSync(exportPath);
const sha = createHash("sha256").update(bytes).digest("hex");
if (sha !== expectedSha) throw new Error("EXPORT_SHA256_MISMATCH");

const dir = mkdtempSync(path.join(os.tmpdir(), "prod-rehearsal-"));
const db = new Database(path.join(dir, "rehearsal.sqlite"));
try {
  db.exec(bytes.toString("utf8"));
  const tables = () => (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as { name: string }[]).map((t) => t.name);
  const counts = () => Object.fromEntries(tables().map((t) => [t, (db.prepare(`SELECT COUNT(*) n FROM "${t.replaceAll('"', '""')}"`).get() as { n: number }).n]));
  const before = counts();
  const receipts = (db.prepare(`SELECT name FROM d1_migrations ORDER BY id`).all() as { name: string }[]).map((r) => r.name);
  const pending = readdirSync("migrations").filter((f) => /^\d{4}_.+\.sql$/.test(f) && Number(f.slice(0, 4)) >= 53).sort();
  const integrityBefore = (db.pragma("integrity_check") as { integrity_check: string }[])[0]?.integrity_check;
  const fkBefore = (db.pragma("foreign_key_check") as unknown[]).length;
  const applied: string[] = [];
  for (const file of pending) {
    if (receipts.includes(file)) throw new Error(`ALREADY_APPLIED ${file}`);
    db.exec("BEGIN");
    try {
      db.exec(readFileSync(path.join("migrations", file), "utf8"));
      db.prepare(`INSERT INTO d1_migrations (name) VALUES (?)`).run(file);
      db.exec("COMMIT");
      applied.push(file);
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(`MIGRATION_FAILED ${file}: ${(error as Error).message.slice(0, 200)}`);
    }
  }
  const after = counts();
  const changed = Object.entries(before).filter(([t, n]) => after[t] !== n).map(([t, n]) => ({ table: t, before: n, after: after[t] ?? "dropped" }));
  const stops = db.prepare(`SELECT enabled, globalPaused, emergencyPaused, intakePaused, followUpsPaused FROM OutreachAutomationSetting`).all();
  console.log(JSON.stringify({
    exportSha256: sha, baselineReceipts: receipts.length, baselineLast: receipts.at(-1), applied: applied.length,
    finalLast: applied.at(-1), originalTables: Object.keys(before).length, originalRows: Object.values(before).reduce((a, b) => a + b, 0),
    changedTables: changed, integrityBefore, integrityAfter: (db.pragma("integrity_check") as { integrity_check: string }[])[0]?.integrity_check,
    fkViolationsBefore: fkBefore, fkViolationsAfter: (db.pragma("foreign_key_check") as unknown[]).length, stops,
  }, null, 2));
} finally {
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
