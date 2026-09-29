// Read-only logical export of the isolated staging D1, for the checksum-pinned
// upgrade rehearsal. Uses only a D1 Read token (Cloudflare's native export needs
// D1 Edit). Rows are rendered to SQL literals server-side with SQLite quote(), and
// written straight to ignored backups/staging/ without being printed. Output: counts
// and the SHA-256 only.
//
//   node --env-file=.env.staging-read scripts/export-staging-d1-readonly.mjs
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const DATABASE = "axiom-revenue-engine-staging";
const DATABASE_ID = "322fcf89-312c-44f0-b238-c4a348f6d6ad";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");

function query(sql) {
  const result = spawnSync(process.execPath, [
    path.join(root, "node_modules", "wrangler", "bin", "wrangler.js"),
    "d1", "execute", DATABASE, "--remote", "--env", "staging", "--json", "--command", sql,
  ], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: process.env });
  // Wrangler on Windows can crash in teardown (libuv UV_HANDLE_CLOSING assertion) after
  // printing a complete result, so trust only a fully parsed, successful, write-free batch.
  let parsed;
  try { parsed = JSON.parse(result.stdout); } catch {
    const reason = (result.stdout + result.stderr).match(/\[ERROR\][^\n]*|SQLITE_[A-Z]+[^\n]*/)?.[0] ?? "unknown";
    throw new Error(`Read query failed (exit ${result.status}): ${reason.slice(0, 300)}`);
  }
  const batch = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!batch?.success) throw new Error(`Read query was not successful: ${JSON.stringify(parsed?.error ?? batch?.error ?? "no detail").slice(0, 300)}`);
  if (batch.meta?.rows_written || batch.meta?.changed_db) throw new Error("A read query reported a write; stopping.");
  return batch.results;
}

const q = (identifier) => `"${identifier.replaceAll('"', '""')}"`;

const objects = query(`SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name`);
if (objects.some((object) => !["table", "index"].includes(object.type))) throw new Error("Unexpected schema object type; stopping.");
const tables = objects.filter((object) => object.type === "table");
const lines = ["PRAGMA defer_foreign_keys=TRUE;"];
let rowCount = 0;
for (const table of tables) lines.push(`${table.sql};`);
for (const table of tables) {
  const columns = query(`PRAGMA table_info(${q(table.name)})`).sort((left, right) => left.cid - right.cid).map((column) => column.name);
  if (columns.length === 0) throw new Error(`Table has no columns: ${table.name}`);
  // D1 caps expression depth, so fetch quote()d literals column-chunk by column-chunk,
  // keyed by rowid, and assemble each INSERT locally.
  const literals = new Map();
  for (let start = 0; start < columns.length; start += 40) {
    const chunk = columns.slice(start, start + 40);
    const select = chunk.map((column, index) => `quote(${q(column)}) AS c${start + index}`).join(", ");
    for (const row of query(`SELECT rowid AS __r, ${select} FROM ${q(table.name)} ORDER BY rowid`)) {
      const current = literals.get(row.__r) ?? [];
      chunk.forEach((_, index) => { current[start + index] = row[`c${start + index}`]; });
      literals.set(row.__r, current);
    }
  }
  for (const values of literals.values()) {
    if (values.length !== columns.length || values.some((value) => typeof value !== "string")) throw new Error(`Incomplete row in ${table.name}; stopping.`);
    lines.push(`INSERT INTO ${q(table.name)} (${columns.map(q).join(",")}) VALUES(${values.join(",")});`);
  }
  rowCount += literals.size;
}
for (const index of objects.filter((object) => object.type === "index")) lines.push(`${index.sql};`);

const sql = `${lines.join("\n")}\n`;
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const dir = path.join(root, "backups", "staging");
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `staging-readonly-export-${stamp}.sql`);
writeFileSync(file, sql, { flag: "wx", mode: 0o600 });
const sha256 = createHash("sha256").update(sql).digest("hex");
console.log(JSON.stringify({ database: DATABASE, databaseId: DATABASE_ID, file, bytes: Buffer.byteLength(sql), tables: tables.length, indexes: objects.length - tables.length, rows: rowCount, sha256, method: "d1-read-quote-v1" }, null, 2));
