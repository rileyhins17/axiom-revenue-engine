// Guarded in-place live release (ADR 0061). Refuses to run unless the target,
// backup checksum, current live state and the owner's recorded approval all match.
//
//   AXIOM_PRODUCTION_RELEASE_APPROVAL="RELEASE LIVE 2026-09-24 CALL LIST" \
//   node --env-file=<env file> scripts/release-production.mjs <backup.sql> <sha256>
// Run from a clean, built checkout: Wrangler resolves the bundle relative to the config.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ACCOUNT = "fe468a56a5b8c7f8fc5d39e265c2f791";
const WORKER = "axiom-ops-omniscient";
const DATABASE = "axiom-ops-omniscient";
const DATABASE_ID = "e42f3d48-5813-4d18-86c4-4471b55aa65e";
const APPROVAL = "RELEASE LIVE 2026-09-24 CALL LIST";
const [backup, expectedSha] = process.argv.slice(2);
const repo = process.cwd();

function stop(reason) { console.error(`RELEASE STOPPED: ${reason}`); process.exit(1); }
if (process.env.AXIOM_PRODUCTION_RELEASE_APPROVAL !== APPROVAL) stop("owner approval phrase missing");
if (process.env.CLOUDFLARE_ACCOUNT_ID !== ACCOUNT) stop("wrong Cloudflare account");
if (!backup || !expectedSha) stop("usage: <backup.sql> <sha256>");
if (spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: repo, encoding: "utf8" }).stdout.split("\n").some((line) => line.trim() && !/\.(open-next|next|wrangler)\//.test(line))) stop("checkout is not clean");
if (createHash("sha256").update(readFileSync(backup)).digest("hex") !== expectedSha) stop("backup checksum mismatch");

const config = JSON.parse(readFileSync(path.join(repo, "wrangler.production.jsonc"), "utf8").replace(/^\s*\/\/.*$/gm, ""));
if (config.name !== WORKER || config.account_id !== ACCOUNT || config.d1_databases?.[0]?.database_id !== DATABASE_ID) stop("config target mismatch");
if (config.vars?.AUTONOMOUS_SEND_ENABLED !== "false" || config.vars?.AUTONOMOUS_QUEUE_ENABLED !== "false" || config.vars?.AUTONOMOUS_INTAKE_ENABLED !== "false" || config.vars?.ENGINE_EMAIL_ENABLED !== "false") stop("automation must stay off");
// The only schedule allowed is the gated weekday email batch, which sends nothing while ENGINE_EMAIL_ENABLED is "false".
if (!["", "0 14 * * 1-5"].includes((config.triggers?.crons ?? []).join("|"))) stop("unexpected cron schedule");

const wrangler = (args, cwd = repo, input) => spawnSync(process.execPath, [path.join(cwd, "node_modules", "wrangler", "bin", "wrangler.js"), ...args, "--config", path.join(repo, "wrangler.production.jsonc")], { cwd, encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024, env: process.env });
const read = (sql) => {
  const result = wrangler(["d1", "execute", DATABASE, "--remote", "--json", "--command", sql]);
  const batch = JSON.parse(result.stdout)[0];
  if (!batch?.success || batch.meta?.rows_written) stop("read check failed");
  return batch.results[0];
};
const state = () => read("SELECT (SELECT COUNT(*) FROM d1_migrations) n, (SELECT MAX(id) FROM d1_migrations) maxId, (SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1) last, (SELECT enabled||globalPaused||emergencyPaused||intakePaused||followUpsPaused FROM OutreachAutomationSetting) stops");

const before = state();
console.log("before:", JSON.stringify(before));
if (before.stops !== "01111") stop("stops are not engaged");
const pending = (wrangler(["d1", "migrations", "list", DATABASE, "--remote"]).stdout.match(/\b\d{4}_[a-z0-9_]+\.sql\b/g) ?? []);
const unique = [...new Set(pending)];
// Live is past 0074. Allowed: nothing pending, or only the next known migrations in order.
const KNOWN = ["0075_engine_prospects_and_call_log.sql", "0076_engine_email_outreach.sql"];
const TARGET = KNOWN.at(-1);
const position = KNOWN.indexOf(before.last);
if (before.last !== "0074_revenue_owner_observed_replies.sql" && position < 0) stop("live is in an unexpected state; investigate before retrying");
const expected = KNOWN.slice(position + 1);
if (unique.join(",") !== expected.join(",")) stop(`unexpected pending list (${unique.join(",") || "none"}; expected ${expected.join(",") || "none"})`);

if (unique.length) {
  const bookmark = wrangler(["d1", "time-travel", "info", DATABASE]).stdout.match(/bookmark is '([^']+)'/)?.[1];
  if (!bookmark) stop("could not record a Time Travel bookmark");
  console.log("time-travel bookmark:", bookmark);
  const apply = wrangler(["d1", "migrations", "apply", DATABASE, "--remote"], repo, "y\n");
  const failed = /❌|\[ERROR\]/.test(apply.stdout + apply.stderr);
  console.log("migrations:", failed ? "FAILED" : "applied");
  if (failed) stop(`migration failed; live DB partially upgraded. Inspect, then restore with bookmark ${bookmark} if needed`);
}
const after = state();
console.log("after:", JSON.stringify(after));
if (after.last !== TARGET || after.stops !== "01111") stop("post-migration state mismatch");

const deploy = wrangler(["deploy"]);
const version = (deploy.stdout.match(/Current Version ID: ([0-9a-f-]+)/) ?? [])[1];
if (!version) stop("deploy did not report a version");
console.log("deployed version:", version);
