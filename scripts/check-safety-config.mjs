import { readFile } from "node:fs/promises";

const [wrangler, example, envSource, packageJson, bootstrap] = await Promise.all([
  readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
  readFile(new URL("../.env.example", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/env.ts", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../WORKER_DESKTOP_BOOTSTRAP_PROMPT.md", import.meta.url), "utf8").catch(() => ""),
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

requireMatch("src/lib/env.ts", envSource, /AUTONOMOUS_INTAKE_ENABLED:\s*environmentBoolean\(false\)/, "intake must default false");
requireMatch("src/lib/env.ts", envSource, /AUTONOMOUS_QUEUE_ENABLED:\s*environmentBoolean\(false\)/, "queue must default false");
requireMatch("src/lib/env.ts", envSource, /AUTONOMOUS_SEND_ENABLED:\s*environmentBoolean\(false\)/, "send must default false");
requireMatch("src/lib/env.ts", envSource, /AUTONOMOUS_DAILY_LEAD_INTAKE_CAP:\s*z\.coerce\.number\(\)\.int\(\)\.nonnegative\(\)\.default\(0\)/, "intake cap must accept and default to zero");
requireMatch("package.json", packageJson, /"deploy"\s*:\s*"node scripts\/production-deploy-guard\.mjs"/, "plain npm run deploy must be guarded");
requireMatch("package.json", packageJson, /"db:migrate:remote"\s*:\s*"node scripts\/production-migration-guard\.mjs"/, "plain remote migration must be guarded");
requireMatch("package.json", packageJson, /"build:cloudflare"\s*:\s*"[^"]*sanitize-cloudflare-bundle\.mjs"/, "Cloudflare builds must remove local env values and scan for secrets");
forbidMatch("WORKER_DESKTOP_BOOTSTRAP_PROMPT.md", bootstrap, /the-omniscient/i, "stale the-omniscient bootstrap reference is forbidden");

if (failures.length > 0) {
  console.error("Safety configuration check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Safety configuration check passed: autonomous work defaults off and production shortcuts are guarded.");
}
