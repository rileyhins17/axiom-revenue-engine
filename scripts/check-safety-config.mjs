import { readFile } from "node:fs/promises";

const [wrangler, engineWrangler, engineWorker, example, envSource, packageJson, ci, bootstrap, gitignore, privateKwCli, privateKwImport, privateKwFiles, privateKwPersistenceCli, privateKwPersistence, browserMeasurementAdapter, artifactStore, auditAssembly, artifactLifecycle, pageSelection, fixtureEvidenceWorkflow, durableEvidencePersistence, fixtureEvidenceResumePlan, fencedResumePersistence, artifactReferenceProjection, artifactReferencePersistence, artifactReferenceAtomicSnapshot, artifactManifestAvailability, artifactManifestHeadAdapter, artifactReferenceSourceRows, artifactReferenceSourceDecoder, artifactReferenceD1Executor, artifactReferenceTrustedProjection, artifactReferenceSourceWriterGuard, ownerLeadProjection, ownerLeadReadModel, ownerLeadRoute, durableEvidenceMigration, fencedResumeMigration, artifactReferenceMigration, artifactReferenceAtomicMigration, artifactReferenceWriterGuardMigration] = await Promise.all([
  readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
  readFile(new URL("../wrangler.engine.jsonc", import.meta.url), "utf8"),
  readFile(new URL("../src/engine/worker.ts", import.meta.url), "utf8"),
  readFile(new URL("../.env.example", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/env.ts", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
  readFile(new URL("../WORKER_DESKTOP_BOOTSTRAP_PROMPT.md", import.meta.url), "utf8").catch(() => ""),
  readFile(new URL("../.gitignore", import.meta.url), "utf8"),
  readFile(new URL("./prepare-private-kw-import.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/private-kw-import.ts", import.meta.url), "utf8"),
  readFile(new URL("./private-kw-files.ts", import.meta.url), "utf8"),
  readFile(new URL("./plan-private-kw-persistence.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/private-kw-persistence-plan.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/browser-measurement-adapter.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/content-addressed-artifact-store.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/website-audit-assembly.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/artifact-lifecycle.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/website-page-selection.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/fixture-website-evidence-workflow.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/durable-evidence-persistence-plan.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/fixture-website-evidence-resume-plan.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/fenced-evidence-resume-persistence-plan.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/artifact-reference-projection.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/artifact-reference-persistence-plan.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/artifact-reference-atomic-snapshot.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/artifact-manifest-availability.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/artifact-manifest-head-adapter.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/artifact-reference-d1-source-rows.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/artifact-reference-d1-source-decoder.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/artifact-reference-d1-executor.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/artifact-reference-trusted-projection.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/artifact-reference-source-writer-guard.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/owner-lead-projection.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/owner-lead-read-model.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/v1/leads/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../migrations/0056_durable_evidence_receipts.sql", import.meta.url), "utf8"),
  readFile(new URL("../migrations/0057_fenced_evidence_resume_records.sql", import.meta.url), "utf8"),
  readFile(new URL("../migrations/0058_artifact_reference_projections.sql", import.meta.url), "utf8"),
  readFile(new URL("../migrations/0059_atomic_artifact_reference_snapshots.sql", import.meta.url), "utf8"),
  readFile(new URL("../migrations/0060_artifact_reference_source_writer_guards.sql", import.meta.url), "utf8"),
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
requireMatch("package.json", packageJson, /"kw:plan-persistence"\s*:\s*"tsx scripts\/plan-private-kw-persistence\.ts"/, "private persistence planning must use the validation-only CLI");
requireMatch(".github/workflows/ci.yml", ci, /run:\s*npm run cf:engine:typegen:check/, "CI must verify generated engine bindings");
requireMatch(".github/workflows/ci.yml", ci, /run:\s*npm run cf:engine:dry-run/, "CI must dry-run the inert engine bundle");
forbidMatch("WORKER_DESKTOP_BOOTSTRAP_PROMPT.md", bootstrap, /the-omniscient/i, "stale the-omniscient bootstrap reference is forbidden");
requireMatch(".gitignore", gitignore, /^data\/$/m, "private local evaluation storage must remain ignored");
requireMatch("scripts/private-kw-files.ts", privateKwFiles, /data["'],\s*["']kw-evaluation/, "private files must stay in ignored KW storage");
requireMatch("scripts/private-kw-files.ts", privateKwFiles, /open\(file,\s*"wx"\)/, "private outputs must not overwrite an existing file");
forbidMatch("scripts/prepare-private-kw-import.ts", privateKwCli, /wrangler|--remote|deploy|fetch\s*\(/i, "the private import CLI must not access providers or Cloudflare");
forbidMatch("scripts/plan-private-kw-persistence.ts", privateKwPersistenceCli, /wrangler|--remote|deploy|fetch\s*\(|better-sqlite3|D1Database/i, "persistence planning must not access a database, provider, or Cloudflare");
requireMatch("src/lib/revenue-engine/private-kw-import.ts", privateKwImport, /costUsd:\s*z\.literal\(0\)/, "private seed imports must have zero provider cost");
requireMatch("src/lib/revenue-engine/private-kw-import.ts", privateKwImport, /qualificationAuthorized:\s*false/, "private seed imports must not authorize qualification");
requireMatch("src/lib/revenue-engine/private-kw-import.ts", privateKwImport, /outreachAuthorized:\s*false/, "private seed imports must not authorize outreach");
requireMatch("src/lib/revenue-engine/private-kw-persistence-plan.ts", privateKwPersistence, /mutationAuthorized:\s*false/, "private persistence plans must not authorize mutation");
requireMatch("src/lib/revenue-engine/private-kw-persistence-plan.ts", privateKwPersistence, /qualificationRows:\s*0/, "private persistence plans must not create qualification rows");
requireMatch("src/lib/revenue-engine/private-kw-persistence-plan.ts", privateKwPersistence, /outreachRows:\s*0/, "private persistence plans must not create outreach rows");
requireMatch("src/lib/revenue-engine/browser-measurement-adapter.ts", browserMeasurementAdapter, /runnerKind:\s*z\.literal\("FIXTURE"\)/, "browser measurement requests must remain fixture-only");
requireMatch("src/lib/revenue-engine/browser-measurement-adapter.ts", browserMeasurementAdapter, /artifactWriteAuthorized:\s*z\.literal\(false\)/, "browser measurement drafts must not authorize artifact writes");
requireMatch("src/lib/revenue-engine/browser-measurement-adapter.ts", browserMeasurementAdapter, /maxCostUsd:\s*z\.literal\(0\)/, "browser measurement requests must have zero provider budget");
forbidMatch("src/lib/revenue-engine/browser-measurement-adapter.ts", browserMeasurementAdapter, /@cloudflare\/playwright|env\.BROWSER|R2Bucket|\.put\s*\(/, "fixture-only browser measurements must not access Browser Rendering or artifact storage");
requireMatch("src/lib/revenue-engine/content-addressed-artifact-store.ts", artifactStore, /storeKind:\s*z\.literal\("FIXTURE"\)/, "artifact storage plans must remain fixture-only");
requireMatch("src/lib/revenue-engine/content-addressed-artifact-store.ts", artifactStore, /providerWriteAuthorized:\s*z\.literal\(false\)/, "artifact storage plans must not authorize provider writes");
requireMatch("src/lib/revenue-engine/content-addressed-artifact-store.ts", artifactStore, /maxCostUsd:\s*z\.literal\(0\)/, "artifact storage plans must have zero provider budget");
requireMatch("src/lib/revenue-engine/content-addressed-artifact-store.ts", artifactStore, /QUALIFICATION_180D:\s*\{[\s\S]*?automaticDeletion:\s*false[\s\S]*?requiresOwnerRelease:\s*true/, "qualification evidence must require review instead of automatic object deletion");
forbidMatch("src/lib/revenue-engine/content-addressed-artifact-store.ts", artifactStore, /expire-uncontacted-qualification-evidence-after-180-days/, "qualification review cannot be installed as an automatic storage lifecycle delete");
forbidMatch("src/lib/revenue-engine/content-addressed-artifact-store.ts", artifactStore, /@cloudflare|env\.[A-Z_]*(R2|ARTIFACT)|R2Bucket|\.put\s*\(|fetch\s*\(/, "fixture-only artifact storage must not access R2 or another provider");
requireMatch("src/lib/revenue-engine/website-audit-assembly.ts", auditAssembly, /assemblerKind:\s*z\.literal\("FIXTURE"\)/, "website audit assembly must remain fixture-only");
requireMatch("src/lib/revenue-engine/website-audit-assembly.ts", auditAssembly, /maxCostUsd:\s*z\.literal\(0\)/, "website audit assembly must have zero provider budget");
forbidMatch("src/lib/revenue-engine/website-audit-assembly.ts", auditAssembly, /@cloudflare|env\.[A-Z_]+|R2Bucket|fetch\s*\(|\.put\s*\(/, "fixture-only website audit assembly must not access providers or runtime bindings");
requireMatch("src/lib/revenue-engine/artifact-lifecycle.ts", artifactLifecycle, /executorKind:\s*z\.literal\("FIXTURE"\)/, "artifact promotion must remain fixture-only");
requireMatch("src/lib/revenue-engine/artifact-lifecycle.ts", artifactLifecycle, /providerCopyAuthorized:\s*z\.literal\(false\)/, "artifact promotion must not authorize provider copies");
requireMatch("src/lib/revenue-engine/artifact-lifecycle.ts", artifactLifecycle, /providerDeleteAuthorized:\s*z\.literal\(false\)/, "artifact release records must not authorize deletion");
requireMatch("src/lib/revenue-engine/artifact-lifecycle.ts", artifactLifecycle, /maxCostUsd:\s*z\.literal\(0\)/, "artifact lifecycle operations must have zero provider budget");
forbidMatch("src/lib/revenue-engine/artifact-lifecycle.ts", artifactLifecycle, /@cloudflare|env\.[A-Z_]+|R2Bucket|fetch\s*\(|\.put\s*\(|\.delete\s*\(/, "fixture-only artifact lifecycle must not access providers, runtime bindings, writes, or deletion");
requireMatch("src/lib/revenue-engine/website-page-selection.ts", pageSelection, /plannerKind:\s*z\.literal\("DETERMINISTIC_FIXTURE"\)/, "website page selection must remain deterministic and fixture-only");
requireMatch("src/lib/revenue-engine/website-page-selection.ts", pageSelection, /maxCostUsd:\s*z\.literal\(0\)/, "website page selection must have zero provider budget");
forbidMatch("src/lib/revenue-engine/website-page-selection.ts", pageSelection, /@cloudflare|env\.[A-Z_]+|R2Bucket|fetch\s*\(|\.put\s*\(|\.delete\s*\(/, "fixture-only website page selection must not access providers, runtime bindings, writes, or deletion");
requireMatch("src/lib/revenue-engine/fixture-website-evidence-workflow.ts", fixtureEvidenceWorkflow, /orchestratorKind:\s*z\.literal\("FIXTURE"\)/, "website evidence composition must remain fixture-only");
requireMatch("src/lib/revenue-engine/fixture-website-evidence-workflow.ts", fixtureEvidenceWorkflow, /maxCostUsd:\s*z\.literal\(0\)/, "website evidence composition must have zero provider budget");
requireMatch("src/lib/revenue-engine/fixture-website-evidence-workflow.ts", fixtureEvidenceWorkflow, /interface FixtureWebsiteEvidenceCheckpointSink[\s\S]*?kind:\s*"FIXTURE"/, "checkpoint observation sinks must remain fixture-only");
forbidMatch("src/lib/revenue-engine/fixture-website-evidence-workflow.ts", fixtureEvidenceWorkflow, /@cloudflare|env\.[A-Z_]+|R2Bucket|fetch\s*\(|\.delete\s*\(/, "fixture-only website evidence composition must not access providers, runtime bindings, network fetch, or deletion");
requireMatch("src/lib/revenue-engine/durable-evidence-persistence-plan.ts", durableEvidencePersistence, /mutationAuthorized:\s*z\.literal\(false\)/, "durable evidence plans must not authorize database mutation");
requireMatch("src/lib/revenue-engine/durable-evidence-persistence-plan.ts", durableEvidencePersistence, /resumeAuthorized:\s*z\.literal\(false\)/, "audit receipts must not claim durable resume authority");
requireMatch("src/lib/revenue-engine/durable-evidence-persistence-plan.ts", durableEvidencePersistence, /maxCostUsd:\s*z\.literal\(0\)/, "durable evidence planning must have zero provider budget");
forbidMatch("src/lib/revenue-engine/durable-evidence-persistence-plan.ts", durableEvidencePersistence, /@cloudflare|env\.[A-Z_]+|D1Database|R2Bucket|fetch\s*\(|\.delete\s*\(|\.prepare\s*\(|\.batch\s*\(/, "fixture-only durable evidence planning must not access providers, runtime bindings, databases, network fetch, or deletion");
requireMatch("src/lib/revenue-engine/fixture-website-evidence-resume-plan.ts", fixtureEvidenceResumePlan, /plannerKind:\s*z\.literal\("FIXTURE"\)/, "resume planning must remain fixture-only");
requireMatch("src/lib/revenue-engine/fixture-website-evidence-resume-plan.ts", fixtureEvidenceResumePlan, /maxCostUsd:\s*z\.literal\(0\)/, "resume planning must have zero provider budget");
requireMatch("src/lib/revenue-engine/fixture-website-evidence-resume-plan.ts", fixtureEvidenceResumePlan, /mutationAuthorized:\s*z\.literal\(false\)/, "resume planning must not authorize mutation");
requireMatch("src/lib/revenue-engine/fixture-website-evidence-resume-plan.ts", fixtureEvidenceResumePlan, /executionAuthorized:\s*z\.literal\(false\)/, "resume planning must not authorize execution");
requireMatch("src/lib/revenue-engine/fixture-website-evidence-resume-plan.ts", fixtureEvidenceResumePlan, /providerOperationsAuthorized:\s*z\.literal\(0\)/, "resume planning must not authorize provider operations");
requireMatch("src/lib/revenue-engine/fixture-website-evidence-resume-plan.ts", fixtureEvidenceResumePlan, /rollbackDeletionAuthorized:\s*z\.literal\(false\)/, "artifact reconciliation must never authorize rollback deletion");
forbidMatch("src/lib/revenue-engine/fixture-website-evidence-resume-plan.ts", fixtureEvidenceResumePlan, /@cloudflare|env\.[A-Z_]+|D1Database|R2Bucket|fetch\s*\(|\.put\s*\(|\.delete\s*\(|\.prepare\s*\(|\.batch\s*\(/, "fixture-only resume planning must not access providers, runtime bindings, databases, network fetch, writes, or deletion");
requireMatch("src/lib/revenue-engine/fenced-evidence-resume-persistence-plan.ts", fencedResumePersistence, /plannerKind:\s*z\.literal\("FIXTURE"\)/, "fenced resume persistence planning must remain fixture-only");
requireMatch("src/lib/revenue-engine/fenced-evidence-resume-persistence-plan.ts", fencedResumePersistence, /maxCostUsd:\s*z\.literal\(0\)/, "fenced resume persistence planning must have zero provider budget");
requireMatch("src/lib/revenue-engine/fenced-evidence-resume-persistence-plan.ts", fencedResumePersistence, /mutationAuthorized:\s*z\.literal\(false\)/, "fenced resume persistence plans must not authorize mutation");
requireMatch("src/lib/revenue-engine/fenced-evidence-resume-persistence-plan.ts", fencedResumePersistence, /resumeAuthorized:\s*z\.literal\(false\)/, "fenced resume persistence plans must not authorize resume");
requireMatch("src/lib/revenue-engine/fenced-evidence-resume-persistence-plan.ts", fencedResumePersistence, /executionAuthorized:\s*z\.literal\(false\)/, "fenced resume persistence plans must not authorize execution");
requireMatch("src/lib/revenue-engine/fenced-evidence-resume-persistence-plan.ts", fencedResumePersistence, /providerOperationsAuthorized:\s*z\.literal\(0\)/, "fenced resume persistence plans must not authorize provider operations");
forbidMatch("src/lib/revenue-engine/fenced-evidence-resume-persistence-plan.ts", fencedResumePersistence, /@cloudflare|env\.[A-Z_]+|D1Database|R2Bucket|fetch\s*\(|\.put\s*\(|\.delete\s*\(|\.prepare\s*\(|\.batch\s*\(/, "fenced resume persistence planning must not access providers, runtime bindings, databases, network fetch, writes, or deletion");
forbidMatch("src/lib/revenue-engine/fenced-evidence-resume-persistence-plan.ts", fencedResumePersistence, /LIMIT\s+1/i, "collision preflights must inspect every matching primary or alternate identity");
requireMatch("src/lib/revenue-engine/artifact-reference-projection.ts", artifactReferenceProjection, /projectorKind:\s*z\.literal\("FIXTURE"\)/, "artifact reference projection must remain fixture-only");
requireMatch("src/lib/revenue-engine/artifact-reference-projection.ts", artifactReferenceProjection, /releaseAuthorized:\s*z\.literal\(false\)/, "reference projections must not authorize retention release");
requireMatch("src/lib/revenue-engine/artifact-reference-projection.ts", artifactReferenceProjection, /deletionAuthorized:\s*z\.literal\(false\)/, "reference projections must not authorize deletion");
requireMatch("src/lib/revenue-engine/artifact-reference-projection.ts", artifactReferenceProjection, /providerDeleteAuthorized:\s*z\.literal\(false\)/, "reference projections must not authorize provider deletion");
requireMatch("src/lib/revenue-engine/artifact-reference-projection.ts", artifactReferenceProjection, /maxCostUsd:\s*z\.literal\(0\)/, "artifact reference projection must have zero provider budget");
requireMatch("src/lib/revenue-engine/artifact-reference-projection.ts", artifactReferenceProjection, /manifest\.retentionClass === "SHADOW_30D"/, "only shadow manifests may carry automatic object expiry in reference replay");
forbidMatch("src/lib/revenue-engine/artifact-reference-projection.ts", artifactReferenceProjection, /@cloudflare|env\.[A-Z_]+|D1Database|R2Bucket|fetch\s*\(|\.put\s*\(|\.delete\s*\(|\.prepare\s*\(|\.batch\s*\(/, "artifact reference projection must not access providers, runtime bindings, databases, network, writes, or deletion");
requireMatch("src/lib/revenue-engine/artifact-reference-persistence-plan.ts", artifactReferencePersistence, /plannerKind:\s*z\.literal\("FIXTURE"\)/, "artifact reference persistence planning must remain fixture-only");
requireMatch("src/lib/revenue-engine/artifact-reference-persistence-plan.ts", artifactReferencePersistence, /mutationAuthorized:\s*z\.literal\(false\)/, "artifact reference persistence must not authorize database mutation");
requireMatch("src/lib/revenue-engine/artifact-reference-persistence-plan.ts", artifactReferencePersistence, /retentionReleaseAuthorized:\s*z\.literal\(false\)/, "artifact reference persistence must not authorize retention release");
requireMatch("src/lib/revenue-engine/artifact-reference-persistence-plan.ts", artifactReferencePersistence, /deletionAuthorized:\s*z\.literal\(false\)/, "artifact reference persistence must not authorize deletion");
requireMatch("src/lib/revenue-engine/artifact-reference-persistence-plan.ts", artifactReferencePersistence, /providerDeleteAuthorized:\s*z\.literal\(false\)/, "artifact reference persistence must not authorize provider deletion");
forbidMatch("src/lib/revenue-engine/artifact-reference-persistence-plan.ts", artifactReferencePersistence, /@cloudflare|env\.[A-Z_]+|D1Database|R2Bucket|fetch\s*\(|\.put\s*\(|\.delete\s*\(|\.prepare\s*\(|\.batch\s*\(/, "artifact reference persistence planning must not access providers, runtime bindings, databases, network, writes, or deletion");
forbidMatch("src/lib/revenue-engine/artifact-reference-persistence-plan.ts", artifactReferencePersistence, /LIMIT\s+1/i, "artifact reference collision preflights must inspect every matching identity");
for (const table of ["RevenueWorkflowRun", "RevenueWorkflowReceipt", "RevenueWorkflowStepReceipt", "RevenueWebsitePageSelection", "RevenueArtifactManifest", "RevenueArtifactManifestEvidenceUse", "RevenueArtifactReleaseRecord"]) {
  requireMatch("migrations/0056_durable_evidence_receipts.sql", durableEvidenceMigration, new RegExp(`CREATE TABLE \\\"${table}\\\"`), `${table} must remain an additive durable evidence table`);
}
forbidMatch("migrations/0056_durable_evidence_receipts.sql", durableEvidenceMigration, /\b(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO|CREATE\s+TRIGGER)\b/i, "the additive durable evidence migration must not mutate existing rows or install triggers");
for (const table of ["RevenueWorkflowDefinition", "RevenueWorkflowDelivery", "RevenueWorkflowAttempt", "RevenueWorkflowAttemptClosure", "RevenueWorkflowLease", "RevenueWorkflowReceiptRevision", "RevenueWorkflowCheckpointPayload", "RevenueWorkflowCheckpoint", "RevenueWorkflowCheckpointStateReceipt", "RevenueWorkflowCheckpointDependency", "RevenueArtifactRecoveryPlan", "RevenueArtifactRecoveryReceipt"]) {
  requireMatch("migrations/0057_fenced_evidence_resume_records.sql", fencedResumeMigration, new RegExp(`CREATE TABLE \\"${table}\\"`), `${table} must remain an additive fenced resume table`);
}
forbidMatch("migrations/0057_fenced_evidence_resume_records.sql", fencedResumeMigration, /\b(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO|CREATE\s+TRIGGER)\b/i, "the additive fenced resume migration must not mutate existing rows or install triggers");
for (const table of ["RevenueArtifactEvidenceUseEnd", "RevenueArtifactReferenceProjection", "RevenueArtifactReferenceProjectionUse", "RevenueArtifactReferenceProjectionAssignment"]) {
  requireMatch("migrations/0058_artifact_reference_projections.sql", artifactReferenceMigration, new RegExp(`CREATE TABLE \\"${table}\\"`), `${table} must remain an additive artifact reference table`);
}
forbidMatch("migrations/0058_artifact_reference_projections.sql", artifactReferenceMigration, /\b(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO|CREATE\s+TRIGGER)\b/i, "the additive artifact reference migration must not mutate existing rows or install triggers");
requireMatch("migrations/0058_artifact_reference_projections.sql", artifactReferenceMigration, /CHECK \("providerDeleteAuthorized" = 0\)/, "artifact reference records must reject provider deletion authority");
requireMatch("src/lib/revenue-engine/artifact-reference-atomic-snapshot.ts", artifactReferenceAtomicSnapshot, /ARTIFACT_REFERENCE_ATOMIC_TARGET_SCHEMA_VERSION\s*=\s*"0060_artifact_reference_source_writer_guards"/, "atomic reference planning must require the guarded schema");
requireMatch("src/lib/revenue-engine/artifact-reference-atomic-snapshot.ts", artifactReferenceAtomicSnapshot, /allSourceWritersGuarded:\s*z\.literal\(true\)/, "atomic reference planning must require every source writer to be database guarded");
requireMatch("src/lib/revenue-engine/artifact-reference-atomic-snapshot.ts", artifactReferenceAtomicSnapshot, /completenessReceiptCreationAuthorized:\s*z\.literal\(false\)/, "validation-only planning must not mint a completeness receipt");
requireMatch("src/lib/revenue-engine/artifact-reference-atomic-snapshot.ts", artifactReferenceAtomicSnapshot, /executionAuthorized:\s*z\.literal\(false\)/, "atomic reference planning must not authorize execution");
requireMatch("src/lib/revenue-engine/artifact-reference-atomic-snapshot.ts", artifactReferenceAtomicSnapshot, /trusted:\s*false as const/, "structural completeness inspection must not become trusted without a D1 executor reload");
forbidMatch("src/lib/revenue-engine/artifact-reference-atomic-snapshot.ts", artifactReferenceAtomicSnapshot, /@cloudflare|env\.[A-Z_]+|R2Bucket|fetch\s*\(|\.put\s*\(|\.delete\s*\(|\.prepare\s*\(|\.batch\s*\(/, "atomic reference planning must not access providers, runtime bindings, databases, network, writes, or deletion");
forbidMatch("src/lib/revenue-engine/artifact-reference-atomic-snapshot.ts", artifactReferenceAtomicSnapshot, /LIMIT\s+1/i, "atomic snapshot queries must inspect every matching identity");
requireMatch("src/lib/revenue-engine/artifact-manifest-availability.ts", artifactManifestAvailability, /providerOperationsAuthorized:\s*z\.literal\(false\)/, "availability observations must not authorize provider operations");
requireMatch("src/lib/revenue-engine/artifact-manifest-availability.ts", artifactManifestAvailability, /releaseAuthorized:\s*z\.literal\(false\)/, "availability observations must not authorize release");
requireMatch("src/lib/revenue-engine/artifact-manifest-availability.ts", artifactManifestAvailability, /deletionAuthorized:\s*z\.literal\(false\)/, "availability observations must not authorize deletion");
requireMatch("src/lib/revenue-engine/artifact-manifest-availability.ts", artifactManifestAvailability, /costUsd:\s*z\.literal\(0\)/, "availability observations must not authorize cost");
forbidMatch("src/lib/revenue-engine/artifact-manifest-availability.ts", artifactManifestAvailability, /@cloudflare|env\.[A-Z_]+|D1Database|R2Bucket|fetch\s*\(|\.head\s*\(|\.put\s*\(|\.delete\s*\(|\.prepare\s*\(|\.batch\s*\(/, "availability validation must not access providers, runtime bindings, databases, network, writes, or deletion");
requireMatch("src/lib/revenue-engine/artifact-manifest-head-adapter.ts", artifactManifestHeadAdapter, /checkerKind:\s*z\.literal\("FIXTURE"\)/, "manifest HEAD adapter must remain fixture-only");
requireMatch("src/lib/revenue-engine/artifact-manifest-head-adapter.ts", artifactManifestHeadAdapter, /maxProviderClassBOperations:\s*z\.literal\(0\)/, "fixture HEAD requests must authorize zero provider reads");
requireMatch("src/lib/revenue-engine/artifact-manifest-head-adapter.ts", artifactManifestHeadAdapter, /providerReadPerformed:\s*z\.literal\(false\)/, "fixture HEAD execution must not impersonate an R2 read");
requireMatch("src/lib/revenue-engine/artifact-manifest-head-adapter.ts", artifactManifestHeadAdapter, /availabilityPersistenceAuthorized:\s*z\.literal\(false\)/, "fixture HEAD execution must not authorize persistence");
requireMatch("src/lib/revenue-engine/artifact-manifest-head-adapter.ts", artifactManifestHeadAdapter, /providerOperationsAuthorized:\s*z\.literal\(0\)/, "fixture HEAD execution must not authorize provider operations");
requireMatch("src/lib/revenue-engine/artifact-manifest-head-adapter.ts", artifactManifestHeadAdapter, /releaseAuthorized:\s*z\.literal\(false\)/, "fixture HEAD execution must not authorize release");
requireMatch("src/lib/revenue-engine/artifact-manifest-head-adapter.ts", artifactManifestHeadAdapter, /deletionAuthorized:\s*z\.literal\(false\)/, "fixture HEAD execution must not authorize deletion");
forbidMatch("src/lib/revenue-engine/artifact-manifest-head-adapter.ts", artifactManifestHeadAdapter, /@cloudflare|env\.[A-Z_]+|D1Database|R2Bucket|fetch\s*\(|\.put\s*\(|\.delete\s*\(|\.prepare\s*\(|\.batch\s*\(/, "fixture HEAD adapter must not access providers, runtime bindings, databases, network, writes, or deletion");
forbidMatch("src/engine/worker.ts", engineWorker, /artifact-manifest-head-adapter/, "the inert engine must not wire fixture HEAD inspection to runtime");
forbidMatch("src/lib/revenue-engine/artifact-reference-d1-source-rows.ts", artifactReferenceSourceRows, /@cloudflare|env\.[A-Z_]+|D1Database|R2Bucket|fetch\s*\(|\.head\s*\(|\.put\s*\(|\.delete\s*\(|\.prepare\s*\(|\.batch\s*\(/, "raw-row schemas must not access providers, runtime bindings, databases, network, writes, or deletion");
requireMatch("src/lib/revenue-engine/artifact-reference-d1-source-decoder.ts", artifactReferenceSourceDecoder, /transactionallyTrusted:\s*z\.literal\(false\)/, "raw-row decoding must remain explicitly untrusted");
requireMatch("src/lib/revenue-engine/artifact-reference-d1-source-decoder.ts", artifactReferenceSourceDecoder, /snapshotComplete:\s*z\.literal\(false\)/, "raw-row decoding must not claim snapshot completeness");
requireMatch("src/lib/revenue-engine/artifact-reference-d1-source-decoder.ts", artifactReferenceSourceDecoder, /providerOperationsAuthorized:\s*z\.literal\(0\)/, "raw-row decoding must not authorize provider operations");
requireMatch("src/lib/revenue-engine/artifact-reference-d1-source-decoder.ts", artifactReferenceSourceDecoder, /projectionPersistenceAuthorized:\s*z\.literal\(false\)/, "raw-row decoding must not authorize projection persistence");
forbidMatch("src/lib/revenue-engine/artifact-reference-d1-source-decoder.ts", artifactReferenceSourceDecoder, /@cloudflare|env\.[A-Z_]+|D1Database|R2Bucket|fetch\s*\(|\.head\s*\(|\.put\s*\(|\.delete\s*\(|\.prepare\s*\(|\.batch\s*\(/, "raw-row decoding must not access providers, runtime bindings, databases, network, writes, or deletion");
requireMatch("src/lib/revenue-engine/artifact-reference-d1-executor.ts", artifactReferenceD1Executor, /transactionallyTrusted:\s*z\.literal\(true\)/, "only the private D1 commit-and-reload executor may return transactional trust");
requireMatch("src/lib/revenue-engine/artifact-reference-d1-executor.ts", artifactReferenceD1Executor, /committedReceiptReloaded:\s*z\.literal\(true\)/, "trusted D1 execution must require a committed receipt reload");
requireMatch("src/lib/revenue-engine/artifact-reference-d1-executor.ts", artifactReferenceD1Executor, /Pick<D1Database,\s*"prepare"\s*\|\s*"batch">/, "the Cloudflare adapter must use the generated narrow D1 binding type");
requireMatch("src/lib/revenue-engine/artifact-reference-d1-executor.ts", artifactReferenceD1Executor, /projectionPersistenceAuthorized:\s*z\.literal\(false\)/, "trusted completeness must not authorize projection persistence");
requireMatch("src/lib/revenue-engine/artifact-reference-d1-executor.ts", artifactReferenceD1Executor, /providerOperationsAuthorized:\s*z\.literal\(0\)/, "trusted completeness must not authorize provider operations");
requireMatch("src/lib/revenue-engine/artifact-reference-d1-executor.ts", artifactReferenceD1Executor, /trustedExecutionInstances\s*=\s*new WeakSet/, "projectable D1 trust must be bound to the exact in-process executor result");
requireMatch("src/lib/revenue-engine/artifact-reference-d1-executor.ts", artifactReferenceD1Executor, /deepFreeze\(TrustedExecutionSchema\.parse/, "projectable D1 executor results must be frozen before they leave the trust boundary");
forbidMatch("src/lib/revenue-engine/artifact-reference-d1-executor.ts", artifactReferenceD1Executor, /env\.[A-Z_]+|R2Bucket|fetch\s*\(|\.head\s*\(|\.put\s*\(|\.delete\s*\(/, "the local-only D1 executor must not access runtime bindings, providers, network, release, or deletion paths");
forbidMatch("src/engine/worker.ts", engineWorker, /artifact-reference-d1-executor/, "the inert engine must not wire the local-only D1 executor to runtime");
requireMatch("src/lib/revenue-engine/artifact-reference-trusted-projection.ts", artifactReferenceTrustedProjection, /projectorKind:\s*z\.literal\("FRESH_D1_EXECUTION_FIXTURE"\)/, "trusted reference projection must remain fixture-only");
requireMatch("src/lib/revenue-engine/artifact-reference-trusted-projection.ts", artifactReferenceTrustedProjection, /requireFreshMaterializedArtifactReferenceD1Execution/, "trusted projection must require the private fresh materialized executor boundary");
requireMatch("src/lib/revenue-engine/artifact-reference-trusted-projection.ts", artifactReferenceTrustedProjection, /projectionClockAssurance:\s*z\.literal\("CALLER_ASSERTED_FIXTURE_ONLY"\)/, "trusted projection must not overstate its caller-supplied clock");
requireMatch("src/lib/revenue-engine/artifact-reference-trusted-projection.ts", artifactReferenceTrustedProjection, /retentionConclusionAuthorized:\s*z\.literal\(false\)/, "trusted projection must not authorize retention conclusions");
requireMatch("src/lib/revenue-engine/artifact-reference-trusted-projection.ts", artifactReferenceTrustedProjection, /projectionPersistenceAuthorized:\s*z\.literal\(false\)/, "trusted projection must not authorize persistence");
requireMatch("src/lib/revenue-engine/artifact-reference-trusted-projection.ts", artifactReferenceTrustedProjection, /releaseAuthorized:\s*z\.literal\(false\)/, "trusted projection must not authorize release");
requireMatch("src/lib/revenue-engine/artifact-reference-trusted-projection.ts", artifactReferenceTrustedProjection, /deletionAuthorized:\s*z\.literal\(false\)/, "trusted projection must not authorize deletion");
requireMatch("src/lib/revenue-engine/artifact-reference-trusted-projection.ts", artifactReferenceTrustedProjection, /providerOperationsAuthorized:\s*z\.literal\(0\)/, "trusted projection must not authorize provider operations");
forbidMatch("src/lib/revenue-engine/artifact-reference-trusted-projection.ts", artifactReferenceTrustedProjection, /@cloudflare|env\.[A-Z_]+|D1Database|R2Bucket|fetch\s*\(|\.head\s*\(|\.put\s*\(|\.delete\s*\(|\.prepare\s*\(|\.batch\s*\(/, "fixture-only trusted projection must not access providers, runtime bindings, databases, network, writes, or deletion");
forbidMatch("src/engine/worker.ts", engineWorker, /artifact-reference-trusted-projection/, "the inert engine must not wire trusted projection to runtime");
requireMatch("src/lib/revenue-engine/owner-lead-projection.ts", ownerLeadProjection, /outreachAuthorized:\s*z\.literal\(false\)/, "owner lead projections must not authorize outreach");
requireMatch("src/lib/revenue-engine/owner-lead-projection.ts", ownerLeadProjection, /sendAuthorized:\s*z\.literal\(false\)/, "owner lead projections must not authorize sending");
requireMatch("src/lib/revenue-engine/owner-lead-projection.ts", ownerLeadProjection, /mutationAuthorized:\s*z\.literal\(false\)/, "owner lead projections must not authorize mutation");
requireMatch("src/lib/revenue-engine/owner-lead-projection.ts", ownerLeadProjection, /providerOperationsAuthorized:\s*z\.literal\(0\)/, "owner lead projections must not authorize provider operations");
forbidMatch("src/lib/revenue-engine/owner-lead-projection.ts", ownerLeadProjection, /@cloudflare|env\.[A-Z_]+|D1Database|R2Bucket|fetch\s*\(|\.prepare\s*\(|\.run\s*\(|\.put\s*\(|\.delete\s*\(/, "owner lead projection must remain a pure zero-provider read model");
requireMatch("src/lib/revenue-engine/owner-lead-read-model.ts", ownerLeadReadModel, /OWNER_LEAD_CANDIDATE_QUERY\s*=\s*`\s*SELECT/, "owner lead D1 access must begin from an explicit SELECT contract");
requireMatch("src/lib/revenue-engine/owner-lead-read-model.ts", ownerLeadReadModel, /mutationAuthorized:\s*z\.literal\(false\)/, "owner lead list responses must not authorize mutation");
requireMatch("src/lib/revenue-engine/owner-lead-read-model.ts", ownerLeadReadModel, /outreachAuthorized:\s*z\.literal\(false\)/, "owner lead list responses must not authorize outreach");
forbidMatch("src/lib/revenue-engine/owner-lead-read-model.ts", ownerLeadReadModel, /\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE)\b/i, "owner lead D1 access must remain SELECT-only");
forbidMatch("src/lib/revenue-engine/owner-lead-read-model.ts", ownerLeadReadModel, /@cloudflare|env\.[A-Z_]+|R2Bucket|fetch\s*\(|\.run\s*\(|\.put\s*\(|\.delete\s*\(/, "owner lead reader must not access providers, runtime bindings, or mutation methods");
requireMatch("src/app/api/v1/leads/route.ts", ownerLeadRoute, /requireApiSession\(request\)/, "owner lead API must require an authenticated session");
requireMatch("src/app/api/v1/leads/route.ts", ownerLeadRoute, /export async function GET\(request:\s*Request\)/, "owner lead API must remain read-only GET");
requireMatch("src/app/api/v1/leads/route.ts", ownerLeadRoute, /private, no-store/, "owner lead API responses must not be cached publicly");
forbidMatch("src/app/api/v1/leads/route.ts", ownerLeadRoute, /export async function (?:POST|PUT|PATCH|DELETE)|\.run\s*\(|fetch\s*\(/, "owner lead API must not expose mutations or provider requests");
requireMatch("src/lib/revenue-engine/artifact-reference-source-writer-guard.ts", artifactReferenceSourceWriterGuard, /allSourceWritersGuarded:\s*z\.literal\(true\)/, "the writer-guard contract must cover every atomic source table");
requireMatch("src/lib/revenue-engine/artifact-reference-source-writer-guard.ts", artifactReferenceSourceWriterGuard, /trustedExecutorImplemented:\s*z\.literal\(true\)/, "the guard contract must accurately report the private disposable-D1 executor");
requireMatch("src/lib/revenue-engine/artifact-reference-source-writer-guard.ts", artifactReferenceSourceWriterGuard, /completenessReceiptCreationAuthorized:\s*z\.literal\(false\)/, "writer guards must not authorize completeness receipt creation");
requireMatch("src/lib/revenue-engine/artifact-reference-source-writer-guard.ts", artifactReferenceSourceWriterGuard, /providerOperationsAuthorized:\s*z\.literal\(0\)/, "writer guards must not authorize provider operations");
forbidMatch("src/lib/revenue-engine/artifact-reference-source-writer-guard.ts", artifactReferenceSourceWriterGuard, /@cloudflare|env\.[A-Z_]+|D1Database|R2Bucket|fetch\s*\(|\.head\s*\(|\.put\s*\(|\.delete\s*\(|\.prepare\s*\(|\.batch\s*\(/, "writer-guard contracts must not access providers, runtime bindings, databases, network, writes, or deletion");
for (const table of ["RevenueArtifactReferenceSnapshotAttempt", "RevenueArtifactManifestAvailabilityReceipt", "RevenueArtifactReferenceCompletenessReceipt", "RevenueArtifactReferenceSourceSetProof"]) {
  requireMatch("migrations/0059_atomic_artifact_reference_snapshots.sql", artifactReferenceAtomicMigration, new RegExp(`CREATE TABLE \\"${table}\\"`), `${table} must remain an additive atomic-reference table`);
}
forbidMatch("migrations/0059_atomic_artifact_reference_snapshots.sql", artifactReferenceAtomicMigration, /\b(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO|CREATE\s+TRIGGER)\b/i, "the additive atomic-reference migration must not mutate existing rows or install triggers");
requireMatch("migrations/0059_atomic_artifact_reference_snapshots.sql", artifactReferenceAtomicMigration, /CHECK \("retentionConclusionAuthorized" = 0\)/, "atomic reference receipts must reject retention-conclusion authority");
requireMatch("migrations/0059_atomic_artifact_reference_snapshots.sql", artifactReferenceAtomicMigration, /CHECK \("deletionAuthorized" = 0\)/, "atomic reference records must reject deletion authority");
const guardedSourceTables = [
  "RevenueWorkflowRun", "RevenueWorkflowDefinition", "RevenueWorkflowDelivery", "RevenueWorkflowAttempt", "RevenueWorkflowLease",
  "RevenueWorkflowReceiptRevision", "RevenueWorkflowAttemptClosure", "RevenueArtifactManifest", "RevenueArtifactManifestItem",
  "RevenueArtifactPromotionReceipt", "RevenueArtifactPromotionUse", "RevenueArtifactManifestEvidenceUse", "RevenueArtifactEvidenceUse",
  "RevenueArtifactEvidenceUseEnd", "RevenueArtifactManifestAvailabilityReceipt",
];
for (const table of guardedSourceTables) {
  requireMatch("migrations/0060_artifact_reference_source_writer_guards.sql", artifactReferenceWriterGuardMigration, new RegExp(`CREATE TRIGGER \\"${table}_reference_source_freeze_insert\\"`), `${table} must block scoped inserts during an active snapshot`);
  requireMatch("migrations/0060_artifact_reference_source_writer_guards.sql", artifactReferenceWriterGuardMigration, new RegExp(`CREATE TRIGGER \\"${table}_reference_source_immutable_update\\"`), `${table} must reject updates`);
  requireMatch("migrations/0060_artifact_reference_source_writer_guards.sql", artifactReferenceWriterGuardMigration, new RegExp(`CREATE TRIGGER \\"${table}_reference_source_immutable_delete\\"`), `${table} must reject deletes`);
}
for (const table of ["RevenueArtifactReferenceSnapshotAttempt", "RevenueArtifactReferenceCompletenessReceipt", "RevenueArtifactReferenceSourceSetProof"]) {
  requireMatch("migrations/0060_artifact_reference_source_writer_guards.sql", artifactReferenceWriterGuardMigration, new RegExp(`CREATE TRIGGER \\"${table}_immutable_update\\"`), `${table} must reject updates`);
  requireMatch("migrations/0060_artifact_reference_source_writer_guards.sql", artifactReferenceWriterGuardMigration, new RegExp(`CREATE TRIGGER \\"${table}_immutable_delete\\"`), `${table} must reject deletes`);
}
if ((artifactReferenceWriterGuardMigration.match(/CREATE TRIGGER/g) || []).length !== 51) failures.push("migrations/0060_artifact_reference_source_writer_guards.sql: exactly 51 source-freeze and append-only triggers are required");
requireMatch("migrations/0060_artifact_reference_source_writer_guards.sql", artifactReferenceWriterGuardMigration, /ARTIFACT_REFERENCE_SOURCE_FROZEN/, "active source writes must fail with a stable freeze error");
requireMatch("migrations/0060_artifact_reference_source_writer_guards.sql", artifactReferenceWriterGuardMigration, /ARTIFACT_REFERENCE_APPEND_ONLY/, "source and control revisions must fail with a stable append-only error");
forbidMatch("migrations/0060_artifact_reference_source_writer_guards.sql", artifactReferenceWriterGuardMigration, /\b(?:INSERT\s+INTO|UPDATE\s+\"[^\"]+\"\s+SET|DELETE\s+FROM)\b/i, "writer-guard migration must not mutate existing rows");
forbidMatch("migrations/0060_artifact_reference_source_writer_guards.sql", artifactReferenceWriterGuardMigration, /retentionConclusionAuthorized\s*=\s*1|projectionPersistenceAuthorized\s*=\s*1|releaseAuthorized\s*=\s*1|deletionAuthorized\s*=\s*1|providerOperationsAuthorized\s*>\s*0/i, "writer-guard migration must not grant operational authority");

if (failures.length > 0) {
  console.error("Safety configuration check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Safety configuration check passed: autonomous work defaults off and production shortcuts are guarded.");
}
