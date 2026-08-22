import { readFile } from "node:fs/promises";

const [wrangler, engineWrangler, example, envSource, packageJson, ci, bootstrap, gitignore, privateKwCli, privateKwImport] = await Promise.all([
  readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
  readFile(new URL("../wrangler.engine.jsonc", import.meta.url), "utf8"),
  readFile(new URL("../.env.example", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/env.ts", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
  readFile(new URL("../WORKER_DESKTOP_BOOTSTRAP_PROMPT.md", import.meta.url), "utf8").catch(() => ""),
  readFile(new URL("../.gitignore", import.meta.url), "utf8"),
  readFile(new URL("./prepare-private-kw-import.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/private-kw-import.ts", import.meta.url), "utf8"),
]);

const failures = [];
const stagingMarker = '"staging": {';
const stagingIndex = wrangler.indexOf(stagingMarker);
const staging = stagingIndex >= 0 ? wrangler.slice(stagingIndex) : "";

function requireMatch(name, content, pattern, expectation) {
  if (!pattern.test(content)) failures.push(`${name}: ${expectation}`);
}

function forbidMatch(name, content, pattern, expectation) {
  if (pattern.test(content)) failures.push(`${name}: ${expectation}`);
}

for (const key of [
  "AUTONOMOUS_INTAKE_ENABLED",
  "AUTONOMOUS_QUEUE_ENABLED",
  "AUTONOMOUS_SEND_ENABLED",
]) {
  requireMatch("wrangler.jsonc", wrangler, new RegExp(`"${key}"\\s*:\\s*"false"`), `${key} must be false`);
  requireMatch(".env.example", example, new RegExp(`^${key}=false$`, "m"), `${key} must be false`);
  requireMatch("wrangler.jsonc env.staging", staging, new RegExp(`"${key}"\\s*:\\s*"false"`), `${key} must be false`);
}

for (const key of ["CLOUD_SCRAPE_ENABLED", "CLOUD_SCRAPE_DETAIL_PAGES_ENABLED"]) {
  requireMatch("wrangler.jsonc", wrangler, new RegExp(`"${key}"\\s*:\\s*"false"`), `${key} must be false`);
  requireMatch(".env.example", example, new RegExp(`^${key}=false$`, "m"), `${key} must be false`);
  requireMatch("wrangler.jsonc env.staging", staging, new RegExp(`"${key}"\\s*:\\s*"false"`), `${key} must be false`);
}

for (const key of [
  "AUTONOMOUS_DAILY_LEAD_INTAKE_CAP",
  "AUTONOMOUS_MAX_SENDS_PER_DAY",
  "AUTONOMOUS_MAX_FOLLOW_UP_SENDS_PER_DAY",
]) {
  requireMatch("wrangler.jsonc", wrangler, new RegExp(`"${key}"\\s*:\\s*"0"`), `${key} must be zero`);
  requireMatch(".env.example", example, new RegExp(`^${key}=0$`, "m"), `${key} must be zero`);
  requireMatch("wrangler.jsonc env.staging", staging, new RegExp(`"${key}"\\s*:\\s*"0"`), `${key} must be zero`);
}

requireMatch("wrangler.jsonc", wrangler, /"env"\s*:\s*\{/, "an explicit staging environment is required");
requireMatch("wrangler.jsonc", wrangler, /"services"\s*:\s*\[\s*\]/, "legacy self-service bindings must be absent");
requireMatch("wrangler.jsonc env.staging", staging, /"services"\s*:\s*\[\s*\]/, "legacy self-service bindings must be absent");
requireMatch("wrangler.jsonc env.staging", staging, /"crons"\s*:\s*\[\s*\]/, "staging cron triggers must be empty");
requireMatch("wrangler.jsonc env.staging", staging, /"database_name"\s*:\s*"axiom-revenue-engine-staging"/, "staging must use the isolated D1 database");
forbidMatch("wrangler.jsonc", wrangler, /"crons"\s*:\s*\[\s*"/, "no cron schedule may be checked in during the rebuild");
forbidMatch("wrangler.jsonc env.staging", staging, /axiom-ops-omniscient|e42f3d48-5813-4d18-86c4-4471b55aa65e/, "staging must never reference legacy production D1");
forbidMatch("wrangler.jsonc", wrangler, /WORKER_SELF_REFERENCE/, "legacy self-fetch orchestration must not be configured");

requireMatch("wrangler.engine.jsonc", engineWrangler, /"workers_dev"\s*:\s*false/, "the inert engine must not expose workers.dev");
requireMatch("wrangler.engine.jsonc", engineWrangler, /"preview_urls"\s*:\s*false/, "the inert engine must not expose preview URLs");
requireMatch("wrangler.engine.jsonc", engineWrangler, /"ENGINE_EXECUTION_ENABLED"\s*:\s*"false"/, "engine execution must remain disabled");
requireMatch("wrangler.engine.jsonc", engineWrangler, /"ENGINE_AUTONOMY_LEVEL"\s*:\s*"OFF"/, "engine autonomy must remain off");
requireMatch("wrangler.engine.jsonc", engineWrangler, /"ENGINE_MAX_JOB_COST_USD"\s*:\s*"0"/, "engine job cost must remain zero");
requireMatch("wrangler.engine.jsonc", engineWrangler, /"global_fetch_strictly_public"/, "engine fetches must use the public Internet route");
requireMatch("wrangler.engine.jsonc", engineWrangler, /"secrets"\s*:\s*\{\s*"required"\s*:\s*\[\s*\]\s*\}/, "the inert engine must reject unrelated local secrets");
requireMatch("wrangler.engine.jsonc", engineWrangler, /"services"\s*:\s*\[\s*\]/, "engine service bindings must remain absent");
requireMatch("wrangler.engine.jsonc", engineWrangler, /"crons"\s*:\s*\[\s*\]/, "engine schedules must remain absent");
forbidMatch("wrangler.engine.jsonc", engineWrangler, /"queues"\s*:/, "engine queues require a later explicit release gate");
forbidMatch("wrangler.engine.jsonc", engineWrangler, /"schedules"\s*:/, "workflow schedules require a later explicit release gate");
forbidMatch("wrangler.engine.jsonc", engineWrangler, /"routes"\s*:/, "engine routes require a later explicit release gate");
forbidMatch("wrangler.engine.jsonc", engineWrangler, /d1_databases|r2_buckets|"browser"\s*:/, "engine data and browser bindings require a later explicit release gate");
forbidMatch("wrangler.engine.jsonc", engineWrangler, /axiom-ops-omniscient|e42f3d48-5813-4d18-86c4-4471b55aa65e/, "the engine must never reference legacy production resources");

requireMatch("src/lib/env.ts", envSource, /AUTONOMOUS_INTAKE_ENABLED:\s*environmentBoolean\(false\)/, "intake must default false");
requireMatch("src/lib/env.ts", envSource, /AUTONOMOUS_QUEUE_ENABLED:\s*environmentBoolean\(false\)/, "queue must default false");
requireMatch("src/lib/env.ts", envSource, /AUTONOMOUS_SEND_ENABLED:\s*environmentBoolean\(false\)/, "send must default false");
requireMatch("src/lib/env.ts", envSource, /AUTONOMOUS_DAILY_LEAD_INTAKE_CAP:\s*z\.coerce\.number\(\)\.int\(\)\.nonnegative\(\)\.default\(0\)/, "intake cap must accept and default to zero");
requireMatch("package.json", packageJson, /"deploy"\s*:\s*"node scripts\/production-deploy-guard\.mjs"/, "plain npm run deploy must be guarded");
requireMatch("package.json", packageJson, /"db:migrate:remote"\s*:\s*"node scripts\/production-migration-guard\.mjs"/, "plain remote migration must be guarded");
requireMatch("package.json", packageJson, /"build:cloudflare"\s*:\s*"[^"]*sanitize-cloudflare-bundle\.mjs"/, "Cloudflare builds must remove local env values and scan for secrets");
requireMatch("package.json", packageJson, /"cf:engine:typegen:check"\s*:\s*"[^"]*--env-file wrangler\.typegen\.env/, "engine binding generation must ignore local env files");
requireMatch("package.json", packageJson, /"cf:engine:dry-run"\s*:/, "CI must dry-run the inert engine bundle");
requireMatch("package.json", packageJson, /scripts\/\*\*\/\*\.test\.ts/, "TypeScript script tests must run in the complete test gate");
requireMatch("package.json", packageJson, /"kw:prepare-import"\s*:\s*"tsx scripts\/prepare-private-kw-import\.ts"/, "the private KW import must use the guarded local CLI");
requireMatch(".github/workflows/ci.yml", ci, /run:\s*npm run cf:engine:typegen:check/, "CI must verify generated engine bindings");
requireMatch(".github/workflows/ci.yml", ci, /run:\s*npm run cf:engine:dry-run/, "CI must dry-run the inert engine bundle");
forbidMatch("WORKER_DESKTOP_BOOTSTRAP_PROMPT.md", bootstrap, /the-omniscient/i, "stale the-omniscient bootstrap reference is forbidden");
requireMatch(".gitignore", gitignore, /^data\/$/m, "private local evaluation storage must remain ignored");
requireMatch("scripts/prepare-private-kw-import.ts", privateKwCli, /data["'],\s*["']kw-evaluation/, "private import files must stay in ignored KW storage");
requireMatch("scripts/prepare-private-kw-import.ts", privateKwCli, /open\(files\.output,\s*"wx"\)/, "private import output must not overwrite an existing file");
forbidMatch("scripts/prepare-private-kw-import.ts", privateKwCli, /wrangler|--remote|deploy|fetch\s*\(/i, "the private import CLI must not access providers or Cloudflare");
requireMatch("src/lib/revenue-engine/private-kw-import.ts", privateKwImport, /costUsd:\s*z\.literal\(0\)/, "private seed imports must have zero provider cost");
requireMatch("src/lib/revenue-engine/private-kw-import.ts", privateKwImport, /qualificationAuthorized:\s*false/, "private seed imports must not authorize qualification");
requireMatch("src/lib/revenue-engine/private-kw-import.ts", privateKwImport, /outreachAuthorized:\s*false/, "private seed imports must not authorize outreach");

if (failures.length > 0) {
  console.error("Safety configuration check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Safety configuration check passed: autonomous work defaults off and production shortcuts are guarded.");
}
