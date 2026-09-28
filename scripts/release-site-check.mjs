// Guarded deploy of the cloud website check Worker (axiom-site-check, ADR 0062).
// It refuses unless the owner's approval phrase, the account, a clean checkout, the
// exact config target and the live database schema all match.
//
//   AXIOM_SITE_CHECK_RELEASE_APPROVAL="RELEASE SITE CHECK 2026-09-28" \
//   node --env-file=<env file> scripts/release-site-check.mjs
//
// To pause it without a deploy: set the Worker variable SITE_CHECK_ENABLED to "false"
// in the Cloudflare dashboard. Calling is never affected either way.
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ACCOUNT = "fe468a56a5b8c7f8fc5d39e265c2f791";
const WORKER = "axiom-site-check";
const DATABASE = "axiom-ops-omniscient";
const DATABASE_ID = "e42f3d48-5813-4d18-86c4-4471b55aa65e";
const APPROVAL = "RELEASE SITE CHECK 2026-09-28";
const CRONS = ["*/10 11-23 * * MON-FRI"];
const repo = process.cwd();

function stop(reason) { console.error(`SITE CHECK RELEASE STOPPED: ${reason}`); process.exit(1); }
if (process.env.AXIOM_SITE_CHECK_RELEASE_APPROVAL !== APPROVAL) stop("owner approval phrase missing");
if (process.env.CLOUDFLARE_ACCOUNT_ID !== ACCOUNT) stop("wrong Cloudflare account");
if (spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: repo, encoding: "utf8" }).stdout.split("\n").some((line) => line.trim() && !/\.(open-next|next|wrangler)\//.test(line))) stop("checkout is not clean");

const configPath = path.join(repo, "wrangler.site-check.jsonc");
const config = JSON.parse(readFileSync(configPath, "utf8").replace(/^\s*\/\/.*$/gm, ""));
if (config.name !== WORKER || config.account_id !== ACCOUNT || config.main !== "src/site-check/worker.ts") stop("config target mismatch");
if (config.workers_dev !== false || config.preview_urls !== false) stop("the checker must not have a public address");
if (config.browser?.binding !== "BROWSER" || config.d1_databases?.length !== 1 || config.d1_databases[0].database_id !== DATABASE_ID) stop("unexpected bindings");
for (const key of ["send_email", "services", "kv_namespaces", "r2_buckets", "queues", "routes", "durable_objects"]) if (key in config) stop(`unexpected ${key} binding`);
if (JSON.stringify(config.triggers?.crons ?? []) !== JSON.stringify(CRONS)) stop("unexpected schedule");

const wrangler = (args) => spawnSync(process.execPath, [path.join(repo, "node_modules", "wrangler", "bin", "wrangler.js"), ...args, "--config", configPath], { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: process.env });
const schema = wrangler(["d1", "execute", DATABASE, "--remote", "--json", "--command", "SELECT (SELECT COUNT(*) FROM d1_migrations WHERE name = '0084_site_check.sql') AS applied, (SELECT COUNT(*) FROM sqlite_master WHERE name = 'SiteCheckRun') AS runs"]);
const live = JSON.parse(schema.stdout || "[]")[0]?.results?.[0];
if (!live || live.applied !== 1 || live.runs !== 1) stop("live database does not have migration 0084 yet; release the main app first");
console.log("live schema: 0084 applied");

const before = JSON.parse(wrangler(["deployments", "list", "--json"]).stdout || "[]");
const previous = [...before].sort((a, b) => String(a.created_on).localeCompare(String(b.created_on))).at(-1)?.versions?.[0]?.version_id ?? null;
const deploy = wrangler(["deploy"]);
const version = (deploy.stdout.match(/Current Version ID: ([0-9a-f-]+)/) ?? [])[1];
if (!version) { console.error(deploy.stdout.slice(-2000), deploy.stderr.slice(-2000)); stop("deploy did not report a version"); }
if (!CRONS.every((cron) => deploy.stdout.includes(cron))) console.warn("warning: deploy output did not echo the schedule; check Triggers in the dashboard");
console.log("deployed version:", version, previous ? `(previous ${previous})` : "(first deploy)");
console.log("The first check runs at the next 10-minute mark between 7:00 and 19:50 Toronto time on a weekday.");
