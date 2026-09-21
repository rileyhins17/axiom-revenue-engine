import { readFile } from "node:fs/promises";

const [wrangler, engineWrangler, engineWorker, example, envSource, packageJson, ci, bootstrap, gitignore, privateKwCli, privateKwImport, privateKwFiles, privateKwDatabase, privateKwPersistenceCli, privateKwPersistence, privateKwShadowSliceCli, privateKwShadowSlice, privateKwAssessmentInvocation, privateKwAssessmentCli, privateKwMaterialization, privateKwMaterializationCli, privateKwContactPersistence, privateKwContactPersistenceExecutor, privateKwContactInvocation, privateKwContactPrerequisites, privateKwContactReviewCli, privateKwContactInvocationCli, browserMeasurementAdapter, artifactStore, auditAssembly, artifactLifecycle, pageSelection, fixtureEvidenceWorkflow, durableEvidencePersistence, fixtureEvidenceResumePlan, fencedResumePersistence, artifactReferenceProjection, artifactReferencePersistence, artifactReferenceAtomicSnapshot, artifactManifestAvailability, artifactManifestHeadAdapter, artifactDeliveryAuthorization, artifactDeliveryFixture, artifactReferenceSourceRows, artifactReferenceSourceDecoder, artifactReferenceD1Executor, artifactReferenceTrustedProjection, artifactReferenceSourceWriterGuard, leadAssessment, leadAssessmentD1, contactDiscovery, contactVerification, contactPersistencePlan, websiteAudit, ownerLeadProjection, ownerLeadReadModel, ownerLeadRoute, ownerLeadsPage, ownerLeadList, ownerLeadDetailReadModel, ownerLeadDetailRoute, ownerLeadDetailPage, ownerLeadDetail, durableEvidenceMigration, fencedResumeMigration, artifactReferenceMigration, artifactReferenceAtomicMigration, artifactReferenceWriterGuardMigration, leadAssessmentMigration, contactPersistenceMigration, contactLineageMigration, privateKwMaterializationMigration, privateKwContactPersistenceMigration, privateKwContactPersistenceHardeningMigration, privateKwContactInvocationMigration] = await Promise.all([
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
  readFile(new URL("./private-kw-database.ts", import.meta.url), "utf8"),
  readFile(new URL("./plan-private-kw-persistence.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/private-kw-persistence-plan.ts", import.meta.url), "utf8"),
  readFile(new URL("./prepare-private-kw-shadow-slice.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/private-kw-shadow-slice.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/private-kw-assessment-invocation.ts", import.meta.url), "utf8"),
  readFile(new URL("./execute-private-kw-assessment.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/private-kw-source-workflow-materialization.ts", import.meta.url), "utf8"),
  readFile(new URL("./materialize-private-kw-source-workflow.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/private-kw-contact-persistence.ts", import.meta.url), "utf8"),
  readFile(new URL("./private-kw-contact-persistence-executor.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/private-kw-contact-invocation.ts", import.meta.url), "utf8"),
  readFile(new URL("./private-kw-contact-prerequisites.ts", import.meta.url), "utf8"),
  readFile(new URL("./prepare-private-kw-contact-review.ts", import.meta.url), "utf8"),
  readFile(new URL("./persist-private-kw-contacts.ts", import.meta.url), "utf8"),
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
  readFile(new URL("../src/lib/revenue-engine/artifact-delivery-authorization.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/artifact-delivery-fixture.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/artifact-reference-d1-source-rows.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/artifact-reference-d1-source-decoder.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/artifact-reference-d1-executor.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/artifact-reference-trusted-projection.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/artifact-reference-source-writer-guard.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/lead-assessment.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/lead-assessment-d1.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/contact-discovery.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/contact-verification.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/contact-persistence-plan.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/website-audit.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/owner-lead-projection.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/owner-lead-read-model.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/v1/leads/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/leads/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/leads/owner-lead-list.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/revenue-engine/owner-lead-detail-read-model.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/v1/leads/[businessId]/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/leads/[businessId]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/leads/owner-lead-detail.tsx", import.meta.url), "utf8"),
  readFile(new URL("../migrations/0056_durable_evidence_receipts.sql", import.meta.url), "utf8"),
  readFile(new URL("../migrations/0057_fenced_evidence_resume_records.sql", import.meta.url), "utf8"),
  readFile(new URL("../migrations/0058_artifact_reference_projections.sql", import.meta.url), "utf8"),
  readFile(new URL("../migrations/0059_atomic_artifact_reference_snapshots.sql", import.meta.url), "utf8"),
  readFile(new URL("../migrations/0060_artifact_reference_source_writer_guards.sql", import.meta.url), "utf8"),
  readFile(new URL("../migrations/0061_shadow_lead_assessment_receipts.sql", import.meta.url), "utf8"),
  readFile(new URL("../migrations/0062_append_only_contact_verification_records.sql", import.meta.url), "utf8"),
  readFile(new URL("../migrations/0063_harden_contact_record_lineage.sql", import.meta.url), "utf8"),
  readFile(new URL("../migrations/0064_local_source_workflow_materializations.sql", import.meta.url), "utf8"),
  readFile(new URL("../migrations/0065_local_contact_persistence_receipts.sql", import.meta.url), "utf8"),
  readFile(new URL("../migrations/0066_harden_local_contact_persistence_receipts.sql", import.meta.url), "utf8"),
  readFile(new URL("../migrations/0067_local_contact_invocation_receipts.sql", import.meta.url), "utf8"),
]);

const failures = [];
const privateKwM2PublicTransport = await readFile(new URL("../src/lib/revenue-engine/private-kw-public-http-transport.ts", import.meta.url), "utf8");
const privateKwM2SourcePolicy = await readFile(new URL("../src/lib/revenue-engine/private-kw-source-policy.ts", import.meta.url), "utf8");
const ownerUiAcceptance = await readFile(new URL("./verify-owner-ui-acceptance.ts", import.meta.url), "utf8");
const privateKwOwnerLabeling = await readFile(new URL("../src/lib/revenue-engine/private-kw-owner-labeling.ts", import.meta.url), "utf8");
const privateKwShadowSliceProgress = await readFile(new URL("../src/lib/revenue-engine/private-kw-shadow-slice-progress.ts", import.meta.url), "utf8");
const privateKwShadowSliceProgressCli = await readFile(new URL("./record-private-kw-shadow-progress.ts", import.meta.url), "utf8");
const privateKwSourceWorkflowProgress = await readFile(new URL("../src/lib/revenue-engine/private-kw-source-workflow-progress.ts", import.meta.url), "utf8");
const privateKwSourceWorkflowProgressCli = await readFile(new URL("./prepare-private-kw-source-workflow-progress.ts", import.meta.url), "utf8");
const privateKwOwnerLabelingPrepareCli = await readFile(new URL("./prepare-private-kw-owner-labeling.ts", import.meta.url), "utf8");
const privateKwOwnerLabelingRecordCli = await readFile(new URL("./record-private-kw-owner-labels.ts", import.meta.url), "utf8");
const privateKwWebsiteEvidenceEligibilityD1 = await readFile(new URL("../src/lib/revenue-engine/private-kw-current-website-evidence-eligibility-d1.ts", import.meta.url), "utf8");
const privateKwWebsiteEvidenceProgress = await readFile(new URL("../src/lib/revenue-engine/private-kw-current-website-evidence-progress.ts", import.meta.url), "utf8");
const privateKwWebsiteEvidenceProgressAppend = await readFile(new URL("../src/lib/revenue-engine/private-kw-current-website-evidence-progress-append.ts", import.meta.url), "utf8");
const privateKwM1WebsiteCheckpoint = await readFile(new URL("./execute-private-kw-m1-website-checkpoint.ts", import.meta.url), "utf8");
const privateKwM1Dossier = await readFile(new URL("./execute-private-kw-m1-dossier.ts", import.meta.url), "utf8");
const privateKwM2Authorization = await readFile(new URL("../src/lib/revenue-engine/private-kw-m2-authorization.ts", import.meta.url), "utf8");
const privateKwM2AuthorizationCli = await readFile(new URL("./prepare-private-kw-m2-authorization.ts", import.meta.url), "utf8");
const privateKwLocalHtmlEvidenceStore = await readFile(new URL("../src/lib/revenue-engine/private-kw-local-html-evidence-store.ts", import.meta.url), "utf8");
const privateKwLocalHtmlEvidenceStoreTest = await readFile(new URL("../src/lib/revenue-engine/private-kw-local-html-evidence-store.test.ts", import.meta.url), "utf8");
const privateKwLocalPlanExecutor = await readFile(new URL("./private-kw-local-plan-executor.ts", import.meta.url), "utf8");
const privateKwAssessmentProgressProof = await readFile(new URL("../src/lib/revenue-engine/private-kw-assessment-progress-proof.ts", import.meta.url), "utf8");
const privateKwWebsiteEvidenceEligibilityMigration = await readFile(new URL("../migrations/0068_current_website_evidence_eligibility_receipts.sql", import.meta.url), "utf8");
const ownerLabelingWorkspace = await readFile(new URL("../src/lib/revenue-engine/owner-labeling-workspace.ts", import.meta.url), "utf8");
const ownerLabelingUpload = await readFile(new URL("../src/lib/revenue-engine/owner-labeling-upload.ts", import.meta.url), "utf8");
const ownerLabelingRoute = await readFile(new URL("../src/app/api/v1/leads/evaluation/validate/route.ts", import.meta.url), "utf8");
const ownerLabelingPage = await readFile(new URL("../src/app/leads/evaluation/page.tsx", import.meta.url), "utf8");
const ownerLabelingComponent = await readFile(new URL("../src/components/leads/owner-lead-evaluation-workspace.tsx", import.meta.url), "utf8");
const stagingConsoleRelease = await readFile(new URL("../src/lib/revenue-engine/staging-console-release.ts", import.meta.url), "utf8");
const stagingConsoleReleaseVerifier = await readFile(new URL("./verify-staging-console-release.ts", import.meta.url), "utf8");
const stagingConsoleReleasePacket = await readFile(new URL("../docs/releases/staging/2026-08-28-owner-quality-lab.json", import.meta.url), "utf8");
const privateKwM2HtmlWorkflow = await readFile(new URL("../src/lib/revenue-engine/private-kw-m2-html-evidence-workflow.ts", import.meta.url), "utf8");
const privateKwM2HtmlAudit = await readFile(new URL("../src/lib/revenue-engine/private-kw-m2-html-audit.ts", import.meta.url), "utf8");
const privateKwM2HtmlReceipt = await readFile(new URL("../src/lib/revenue-engine/private-kw-m2-html-evidence-receipt.ts", import.meta.url), "utf8");
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
requireMatch("package.json", packageJson, /"test:owner-ui"\s*:\s*"tsx scripts\/verify-owner-ui-acceptance\.ts"/, "the owner UI acceptance gate must have a stable local command");
requireMatch("scripts/verify-owner-ui-acceptance.ts", ownerUiAcceptance, /executePrivateKwContactPersistenceForLocalDatabase\(database, contactFixture\)/, "the owner dossier acceptance fixture must use the proven transactional contact executor");
requireMatch("scripts/verify-owner-ui-acceptance.ts", ownerUiAcceptance, /FROM "RevenuePrivateKwContactPersistenceReceipt"/, "the owner dossier acceptance fixture must verify the final contact materialization receipt");
requireMatch("scripts/verify-owner-ui-acceptance.ts", ownerUiAcceptance, /executionPath, "EXACT_REPLAY"/, "the owner dossier acceptance fixture must prove mutation-free replay");
forbidMatch("scripts/verify-owner-ui-acceptance.ts", ownerUiAcceptance, /for \(const mutation of contactPersistencePlan\.mutations\)/, "the owner dossier fixture must not bypass the executor with loose planner inserts");
for (const field of ["contactDiscoveryAuthorized", "contactVerificationAuthorized", "consentDecisionAuthorized", "qualificationAuthorized", "outreachAuthorized", "sendAuthorized"]) {
  requireMatch("scripts/verify-owner-ui-acceptance.ts", ownerUiAcceptance, new RegExp(`${field}: false`), `${field} must remain false in the owner dossier contact fixture`);
}
requireMatch("scripts/verify-owner-ui-acceptance.ts", ownerUiAcceptance, /providerOperationsAuthorized: 0/, "the owner dossier contact fixture must authorize zero provider operations");
requireMatch("scripts/verify-owner-ui-acceptance.ts", ownerUiAcceptance, /costAuthorizedUsd: 0/, "the owner dossier contact fixture must authorize zero cost");
requireMatch("package.json", packageJson, /"kw:prepare-import"\s*:\s*"tsx scripts\/prepare-private-kw-import\.ts"/, "the private KW import must use the guarded local CLI");
requireMatch("package.json", packageJson, /"kw:prepare-m2-authorization"\s*:\s*"tsx scripts\/prepare-private-kw-m2-authorization\.ts"/, "M2 authorization preparation must use the bounded local CLI");
requireMatch("package.json", packageJson, /"kw:plan-persistence"\s*:\s*"tsx scripts\/plan-private-kw-persistence\.ts"/, "private persistence planning must use the validation-only CLI");
requireMatch("package.json", packageJson, /"kw:prepare-shadow-slice"\s*:\s*"tsx scripts\/prepare-private-kw-shadow-slice\.ts"/, "the bounded shadow slice must use the ignored-local plan-only CLI");
requireMatch("package.json", packageJson, /"kw:prepare-source-workflow-progress"\s*:\s*"tsx scripts\/prepare-private-kw-source-workflow-progress\.ts"/, "source/workflow progress proof must use the guarded read-only adapter CLI");
requireMatch("package.json", packageJson, /"kw:record-shadow-progress"\s*:\s*"tsx scripts\/record-private-kw-shadow-progress\.ts"/, "shadow progress must use the guarded ignored-local append-only CLI");
requireMatch("package.json", packageJson, /"kw:execute-assessment"\s*:\s*"tsx scripts\/execute-private-kw-assessment\.ts"/, "private assessment execution must use the guarded ignored-local CLI");
requireMatch("package.json", packageJson, /"kw:execute-m1-dossier"\s*:\s*"tsx scripts\/execute-private-kw-m1-dossier\.ts"/, "the M1 dossier composition must use the bounded local CLI");
requireMatch(".github/workflows/ci.yml", ci, /run:\s*npm run cf:engine:typegen:check/, "CI must verify generated engine bindings");
requireMatch(".github/workflows/ci.yml", ci, /run:\s*npm run cf:engine:dry-run/, "CI must dry-run the inert engine bundle");
requireMatch(".github/workflows/ci.yml", ci, /run:\s*npx playwright install --with-deps chromium/, "CI must install the pinned owner UI browser");
requireMatch(".github/workflows/ci.yml", ci, /run:\s*npm run test:owner-ui/, "CI must run the owner UI acceptance gate");
forbidMatch("WORKER_DESKTOP_BOOTSTRAP_PROMPT.md", bootstrap, /the-omniscient/i, "stale the-omniscient bootstrap reference is forbidden");
requireMatch(".gitignore", gitignore, /^data\/$/m, "private local evaluation storage must remain ignored");
requireMatch("scripts/private-kw-files.ts", privateKwFiles, /data["'],\s*["']kw-evaluation/, "private files must stay in ignored KW storage");
requireMatch("scripts/private-kw-files.ts", privateKwFiles, /open\(file,\s*"wx"\)/, "private outputs must not overwrite an existing file");
forbidMatch("scripts/prepare-private-kw-import.ts", privateKwCli, /wrangler|--remote|deploy|fetch\s*\(/i, "the private import CLI must not access providers or Cloudflare");
forbidMatch("scripts/plan-private-kw-persistence.ts", privateKwPersistenceCli, /wrangler|--remote|deploy|fetch\s*\(|better-sqlite3|D1Database/i, "persistence planning must not access a database, provider, or Cloudflare");
forbidMatch("scripts/prepare-private-kw-shadow-slice.ts", privateKwShadowSliceCli, /wrangler|--remote|\bdeploy\b|fetch\s*\(|better-sqlite3|D1Database|R2Bucket/i, "shadow-slice preparation must not access a database, provider, network, or Cloudflare");
forbidMatch("scripts/prepare-private-kw-m2-authorization.ts", privateKwM2AuthorizationCli, /wrangler|--remote|\bdeploy\b|fetch\s*\(|better-sqlite3|D1Database|R2Bucket|@cloudflare|process\.env|\.prepare\s*\(|\.run\s*\(|\.transaction\s*\(|--database|--url|--business-id|--phase|--clock|--provider|--failure-stage/i, "M2 authorization preparation must remain bounded to local JSON packet inputs and must not accept database, network, provider, or execution controls");
requireMatch("scripts/prepare-private-kw-m2-authorization.ts", privateKwM2AuthorizationCli, /status !== \"PENDING\"/, "M2 authorization preparation must fail closed if a builder ever returns an approved owner envelope");
forbidMatch("src/lib/revenue-engine/private-kw-m2-authorization.ts", privateKwM2Authorization, /@cloudflare|D1Database|R2Bucket|better-sqlite3|fetch\s*\(|process\.env|\.prepare\s*\(|\.run\s*\(|\.transaction\s*\(/i, "M2 authorization contracts must remain provider-free, database-free, and network-free");
for (const field of ["liveSourceAuthorized", "browserCaptureAuthorized", "artifactStorageAuthorized", "databaseMutationAuthorized", "contactDiscoveryExecutionAuthorized", "contactVerificationExecutionAuthorized", "consentDecisionAuthorized", "qualificationAuthorized", "mailboxSyncAuthorized", "outreachAuthorized", "sendAuthorized", "deploymentAuthorized"]) {
  requireMatch("src/lib/revenue-engine/private-kw-m2-authorization.ts", privateKwM2Authorization, new RegExp(`${field}:\\s*z\\.literal\\(false\\)`), `${field} must remain false in M2 authorization contracts`);
}
requireMatch("src/lib/revenue-engine/private-kw-m2-authorization.ts", privateKwM2Authorization, /providerOperationsAuthorized:\s*z\.literal\(0\)/, "M2 authorization contracts must authorize zero provider operations");
requireMatch("src/lib/revenue-engine/private-kw-m2-authorization.ts", privateKwM2Authorization, /costAuthorizedUsd:\s*z\.literal\(0\)/, "M2 authorization contracts must authorize zero cost");
requireMatch("src/lib/revenue-engine/private-kw-m2-authorization.ts", privateKwM2Authorization, /fixtureOnly:\s*z\.literal\(true\)/, "M2 mapping policy must remain explicitly fixture-only");
requireMatch("src/lib/revenue-engine/private-kw-m2-authorization.ts", privateKwM2Authorization, /productionAssessmentApprovalAuthorized:\s*z\.literal\(false\)/, "Task 1 must not authorize a production assessment approval");
requireMatch("src/lib/revenue-engine/private-kw-local-html-evidence-store.ts", privateKwLocalHtmlEvidenceStore, /data\/kw-evaluation\/m2-evidence/, "M2 evidence must stay under the fixed ignored direct-child root");
requireMatch("src/lib/revenue-engine/private-kw-local-html-evidence-store.ts", privateKwLocalHtmlEvidenceStore, /open\(temp,\s*["']wx["']\)/, "M2 evidence publication must use exclusive temporary files");
requireMatch("src/lib/revenue-engine/private-kw-local-html-evidence-store.ts", privateKwLocalHtmlEvidenceStore, /await link\(temp,\s*file\)/, "M2 evidence publication must use no-replace hard-link publication");
requireMatch("src/lib/revenue-engine/private-kw-local-html-evidence-store.ts", privateKwLocalHtmlEvidenceStore, /assertSafeArtifactAncestors/, "M2 evidence publication must revalidate every fixed ancestor");
requireMatch("src/lib/revenue-engine/private-kw-local-html-evidence-store.ts", privateKwLocalHtmlEvidenceStore, /assertRegularIdentity/, "M2 evidence reload/publication must prove opened-handle identity");
requireMatch("src/lib/revenue-engine/private-kw-local-html-evidence-store.ts", privateKwLocalHtmlEvidenceStore, /PrivateKwM2ExecutionAuthorizationSchema\.parse/, "M2 raw evidence must consume the exact Task 1 authorization schema");
requireMatch("src/lib/revenue-engine/private-kw-local-html-evidence-store.ts", privateKwLocalHtmlEvidenceStore, /assertPrivateKwM2ApprovalChain/, "M2 raw evidence must validate the canonical Task 1 approval chain at storage time");
requireMatch("src/lib/revenue-engine/private-kw-local-html-evidence-store.ts", privateKwLocalHtmlEvidenceStore, /PrivateKwSourcePolicyDecisionSchema\.parse/, "M2 raw evidence must consume the exact Task 2 source-policy decision");
requireMatch("src/lib/revenue-engine/private-kw-local-html-evidence-store.ts", privateKwLocalHtmlEvidenceStore, /privateKwPublicHttpTransportReceiptDigest/, "M2 raw evidence must verify the exact Task 2 transport receipt digests");
requireMatch("src/lib/revenue-engine/private-kw-local-html-evidence-store.ts", privateKwLocalHtmlEvidenceStore, /\.strict\(\)/, "M2 evidence input and stored schemas must reject unknown fields");
requireMatch("src/lib/revenue-engine/private-kw-local-html-evidence-store.test.ts", privateKwLocalHtmlEvidenceStoreTest, /metadata object left without its content pair/, "M2 evidence tests must cover metadata-only crash state");
requireMatch("src/lib/revenue-engine/private-kw-local-html-evidence-store.test.ts", privateKwLocalHtmlEvidenceStoreTest, /exact authorized retention decision/, "M2 evidence tests must cover copied or changed authorization decisions");
forbidMatch("src/lib/revenue-engine/private-kw-local-html-evidence-store.ts", privateKwLocalHtmlEvidenceStore, /rename\s*\(|copyFile\s*\(|globalThis\.fetch|\bfetch\s*\(|D1Database|R2Bucket|@cloudflare|process\.env/i, "M2 local evidence must not use overwrite-capable publication, network, provider, database, or runtime authority");
forbidMatch("src/lib/revenue-engine/private-kw-local-html-evidence-store.ts", privateKwLocalHtmlEvidenceStore, /\.passthrough\(\)|rawArtifactRef:\s*z\.string|body:\s*z\.|html:\s*z\.|headers:\s*z\.|cookies:\s*z\./i, "M2 evidence input must not permit passthrough or body-bearing derived-facts fields");
requireMatch("src/lib/revenue-engine/private-kw-m2-authorization.ts", privateKwM2Authorization, /migrationRange:\s*z\.literal\(PRIVATE_KW_M2_DATABASE_MIGRATION_RANGE\)/, "M2 database receipt must bind the canonical migration range");
requireMatch("src/lib/revenue-engine/private-kw-m2-authorization.ts", privateKwM2Authorization, /localOnly:\s*z\.literal\(true\)/, "M2 database receipt must remain local-only");
for (const moduleName of ["node:http", "node:https", "node:dns/promises", "node:net"]) {
  requireMatch("src/lib/revenue-engine/private-kw-public-http-transport.ts", privateKwM2PublicTransport, new RegExp(`from \\\"${moduleName}\\\"`), `M2 transport must use ${moduleName}`);
}
for (const pattern of [/PublicDnsResolver/, /PublicConnectionExecutor/, /resolveWithAbort/, /signal\.aborted/, /response\.abort/, /address:\s*selected\.address/, /servername:\s*hostname/, /agent:\s*false/, /Connection:\s*"close"/, /Readable\.toWeb/, /receiptDigest/]) {
  requireMatch("src/lib/revenue-engine/private-kw-public-http-transport.ts", privateKwM2PublicTransport, pattern, `M2 transport is missing required address-pinned native seam ${pattern}`);
}
for (const pattern of [/globalThis\.fetch/, /\bfetch\s*\(/, /undici/i, /axios/i, /redirect:\s*[\"']follow[\"']/i, /process\.env/, /D1Database|R2Bucket|Browser|provider|contact|form|send/i]) {
  forbidMatch("src/lib/revenue-engine/private-kw-public-http-transport.ts", privateKwM2PublicTransport, pattern, `M2 transport contains a forbidden shortcut or authority ${pattern}`);
}
requireMatch("src/lib/revenue-engine/private-kw-source-policy.ts", privateKwM2SourcePolicy, /evaluatePrivateKwRobotsPolicy/, "M2 source policy must expose the robots/terms preflight");
requireMatch("src/lib/revenue-engine/private-kw-source-policy.ts", privateKwM2SourcePolicy, /transport\.request/, "M2 source policy must use the shared secure transport");
for (const pattern of [/input\.sleep/, /PRIVATE_KW_SOURCE_POLICY_MAX_ROBOTS_BYTES/, /PRIVATE_KW_SOURCE_POLICY_MAX_REDIRECTS/, /receiptDigestsFor/]) {
  requireMatch("src/lib/revenue-engine/private-kw-source-policy.ts", privateKwM2SourcePolicy, pattern, `M2 source policy is missing bounded contract ${pattern}`);
}
forbidMatch("src/lib/revenue-engine/private-kw-source-policy.ts", privateKwM2SourcePolicy, /capturePublicWebsiteDocument|globalThis\.fetch|\bfetch\s*\(|D1Database|R2Bucket|Browser|\bcontact\b|\bform\b|\bsend\b/i, "M2 source policy must remain bounded and provider/contact free");
forbidMatch("scripts/record-private-kw-shadow-progress.ts", privateKwShadowSliceProgressCli, /wrangler|--remote|\bdeploy\b|fetch\s*\(|better-sqlite3|D1Database|R2Bucket|@cloudflare/i, "shadow progress recording must not access a database, provider, network, or Cloudflare");
requireMatch("scripts/record-private-kw-shadow-progress.ts", privateKwShadowSliceProgressCli, /writePrivateKwJson\(files\.output, checkpoint\)/, "shadow progress must create a new ignored no-overwrite checkpoint");
forbidMatch("scripts/prepare-private-kw-source-workflow-progress.ts", privateKwSourceWorkflowProgressCli, /wrangler|--remote|\bdeploy\b|fetch\s*\(|D1Database|R2Bucket|@cloudflare/i, "source/workflow progress proof must not access a provider, network, remote database, or Cloudflare");
requireMatch("scripts/prepare-private-kw-source-workflow-progress.ts", privateKwSourceWorkflowProgressCli, /readonly:\s*true/, "source/workflow progress proof must open only an existing read-only local database");
requireMatch("scripts/prepare-private-kw-source-workflow-progress.ts", privateKwSourceWorkflowProgressCli, /query_only = ON/, "source/workflow progress proof must make the SQLite connection query-only");
requireMatch("scripts/prepare-private-kw-source-workflow-progress.ts", privateKwSourceWorkflowProgressCli, /assertCanonicalPrivateKwRevenueSchema\(database\)/, "source/workflow progress proof must reject schema drift");
requireMatch("scripts/prepare-private-kw-source-workflow-progress.ts", privateKwSourceWorkflowProgressCli, /writePrivateKwJson\(files\.output, receipt\)/, "source/workflow progress proof must create one ignored no-overwrite receipt input");
requireMatch("src/lib/revenue-engine/private-kw-import.ts", privateKwImport, /costUsd:\s*z\.literal\(0\)/, "private seed imports must have zero provider cost");
requireMatch("src/lib/revenue-engine/private-kw-import.ts", privateKwImport, /qualificationAuthorized:\s*false/, "private seed imports must not authorize qualification");
requireMatch("src/lib/revenue-engine/private-kw-import.ts", privateKwImport, /outreachAuthorized:\s*false/, "private seed imports must not authorize outreach");
requireMatch("src/lib/revenue-engine/private-kw-persistence-plan.ts", privateKwPersistence, /mutationAuthorized:\s*false/, "private persistence plans must not authorize mutation");
requireMatch("src/lib/revenue-engine/private-kw-persistence-plan.ts", privateKwPersistence, /qualificationRows:\s*0/, "private persistence plans must not create qualification rows");
requireMatch("src/lib/revenue-engine/private-kw-persistence-plan.ts", privateKwPersistence, /outreachRows:\s*0/, "private persistence plans must not create outreach rows");
requireMatch("src/lib/revenue-engine/private-kw-persistence-plan.ts", privateKwPersistence, /PRIVATE_KW_PERSISTENCE_PLAN_VERSION\s*=\s*"kw-private-persistence-plan-v2"/, "private persistence preflights must use the collision-complete v2 contract");
forbidMatch("src/lib/revenue-engine/private-kw-persistence-plan.ts", privateKwPersistence, /LIMIT\s+1/i, "private persistence preflights must inspect every matching identity");
requireMatch("src/lib/revenue-engine/private-kw-shadow-slice.ts", privateKwShadowSlice, /PRIVATE_KW_SHADOW_SLICE_SIZE\s*=\s*10/, "the first real-business shadow slice must remain bounded to ten businesses");
requireMatch("src/lib/revenue-engine/private-kw-shadow-slice.ts", privateKwShadowSlice, /selections:\s*z\.array\(ShadowSliceSelectionSchema\)\.length\(PRIVATE_KW_SHADOW_SLICE_SIZE\)/, "the bounded shadow slice must require exactly ten manually reviewed selections");
for (const field of ["liveSourceAuthorized", "browserCaptureAuthorized", "artifactStorageAuthorized", "databaseMutationAuthorized", "contactDiscoveryExecutionAuthorized", "contactVerificationExecutionAuthorized", "consentDecisionAuthorized", "qualificationAuthorized", "mailboxSyncAuthorized", "outreachAuthorized", "sendAuthorized", "deploymentAuthorized"]) {
  requireMatch("src/lib/revenue-engine/private-kw-shadow-slice.ts", privateKwShadowSlice, new RegExp(`${field}:\\s*z\\.literal\\(false\\)`), `${field} must remain false in the bounded shadow-slice manifest`);
}
requireMatch("src/lib/revenue-engine/private-kw-shadow-slice.ts", privateKwShadowSlice, /providerOperationsAuthorized:\s*z\.literal\(0\)/, "the shadow-slice manifest must authorize zero provider operations");
requireMatch("src/lib/revenue-engine/private-kw-shadow-slice.ts", privateKwShadowSlice, /costAuthorizedUsd:\s*z\.literal\(0\)/, "the shadow-slice manifest must authorize zero provider cost");
forbidMatch("src/lib/revenue-engine/private-kw-shadow-slice.ts", privateKwShadowSlice, /@cloudflare|env\.[A-Z_]+|D1Database|R2Bucket|fetch\s*\(|\.prepare\s*\(|\.batch\s*\(|\.run\s*\(|\.put\s*\(|\.delete\s*\(/, "shadow-slice definition must not access providers, runtime bindings, databases, network, or writes");
requireMatch("src/lib/revenue-engine/private-kw-shadow-slice-progress.ts", privateKwShadowSliceProgress, /parentCheckpoint:\s*z\.object\(/, "every later shadow progress checkpoint must retain its exact parent");
requireMatch("src/lib/revenue-engine/private-kw-shadow-slice-progress.ts", privateKwShadowSliceProgress, /previousPhaseReceipt:\s*PhaseReceiptReferenceSchema\.nullable\(\)/, "every later business phase must retain its exact predecessor receipt");
requireMatch("src/lib/revenue-engine/private-kw-shadow-slice-progress.ts", privateKwShadowSliceProgress, /phaseExecutionAuthorized:\s*z\.literal\(false\)/, "progress records must not authorize phase execution");
for (const field of ["liveSourceAuthorized", "browserCaptureAuthorized", "artifactStorageAuthorized", "databaseMutationAuthorized", "contactDiscoveryExecutionAuthorized", "contactVerificationExecutionAuthorized", "consentDecisionAuthorized", "qualificationAuthorized", "mailboxSyncAuthorized", "outreachAuthorized", "sendAuthorized", "deploymentAuthorized"]) {
  requireMatch("src/lib/revenue-engine/private-kw-shadow-slice-progress.ts", privateKwShadowSliceProgress, new RegExp(`${field}:\\s*z\\.literal\\(false\\)`), `${field} must remain false in shadow progress checkpoints`);
}
requireMatch("src/lib/revenue-engine/private-kw-shadow-slice-progress.ts", privateKwShadowSliceProgress, /providerOperationsAuthorized:\s*z\.literal\(0\)/, "shadow progress must authorize zero provider operations");
requireMatch("src/lib/revenue-engine/private-kw-shadow-slice-progress.ts", privateKwShadowSliceProgress, /costAuthorizedUsd:\s*z\.literal\(0\)/, "shadow progress must authorize zero provider cost");
forbidMatch("src/lib/revenue-engine/private-kw-shadow-slice-progress.ts", privateKwShadowSliceProgress, /@cloudflare|env\.[A-Z_]+|D1Database|R2Bucket|fetch\s*\(|\.prepare\s*\(|\.batch\s*\(|\.run\s*\(|\.put\s*\(|\.delete\s*\(/, "shadow progress definitions must not access providers, runtime bindings, databases, network, or writes");
requireMatch("src/lib/revenue-engine/private-kw-source-workflow-progress.ts", privateKwSourceWorkflowProgress, /verifyCompleteStoredMaterialization\(plan\.records, input\.storedRecords\)/, "the source/workflow adapter must verify the exact complete stored materialization");
requireMatch("src/lib/revenue-engine/private-kw-source-workflow-progress.ts", privateKwSourceWorkflowProgress, /closure\.expected\.terminalReceiptId !== plan\.workflowReceiptId/, "the source/workflow adapter must prove the workflow receipt is terminal");
requireMatch("src/lib/revenue-engine/private-kw-source-workflow-progress.ts", privateKwSourceWorkflowProgress, /privateKwShadowSliceProgressAuthority\(\)/, "the source/workflow adapter must use the central zero-authority progress contract");
forbidMatch("src/lib/revenue-engine/private-kw-source-workflow-progress.ts", privateKwSourceWorkflowProgress, /@cloudflare|env\.[A-Z_]+|D1Database|R2Bucket|fetch\s*\(|\.prepare\s*\(|\.batch\s*\(|\.run\s*\(|\.put\s*\(|\.delete\s*\(/, "source/workflow progress normalization must not access providers, runtime bindings, databases, network, or writes");
requireMatch("scripts/execute-private-kw-m1-website-checkpoint.ts", privateKwM1WebsiteCheckpoint, /createPrivateKwCurrentWebsiteEvidenceFixture/, "the M1 website checkpoint must use the committed fixture evidence workflow");
requireMatch("scripts/execute-private-kw-m1-website-checkpoint.ts", privateKwM1WebsiteCheckpoint, /createPrivateKwLocalD1Adapter/, "the M1 website checkpoint must use the supplied local SQLite D1 adapter");
requireMatch("scripts/execute-private-kw-m1-website-checkpoint.ts", privateKwM1WebsiteCheckpoint, /executePrivateKwSourceWorkflowPlanForLocalDatabase/, "the M1 website checkpoint must execute the real local source materialization writer");
requireMatch("scripts/execute-private-kw-m1-website-checkpoint.ts", privateKwM1WebsiteCheckpoint, /writeOrVerifyPrivateKwJson/, "the M1 website checkpoint must use the exact replay-safe JSON boundary");
requireMatch("scripts/execute-private-kw-m1-website-checkpoint.ts", privateKwM1WebsiteCheckpoint, /runPrivateKwLocalAsyncWriteUnit/, "the M1 website checkpoint must own one outer local atomic unit");
requireMatch("scripts/execute-private-kw-m1-website-checkpoint.ts", privateKwM1WebsiteCheckpoint, /afterCompleteness/, "the M1 website checkpoint must retain the deterministic rollback seam");
requireMatch("scripts/execute-private-kw-m1-website-checkpoint.ts", privateKwM1WebsiteCheckpoint, /SYNTHETIC_R2_HEAD_SHAPED_FIXTURE/, "synthetic provider-shaped receipts must remain visibly labelled");
for (const field of ["workerRuntimeConnected: false", "networkOperationsPerformed: 0", "providerOperationsAuthorized: 0", "contactDiscoveryExecutionAuthorized: false", "contactVerificationExecutionAuthorized: false", "consentDecisionAuthorized: false", "qualificationExecutionAuthorized: false", "outreachAuthorized: false", "sendAuthorized: false", "costAuthorizedUsd: 0"]) {
  requireMatch("scripts/execute-private-kw-m1-website-checkpoint.ts", privateKwM1WebsiteCheckpoint, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `the M1 website checkpoint must retain ${field}`);
}
forbidMatch("scripts/execute-private-kw-m1-website-checkpoint.ts", privateKwM1WebsiteCheckpoint, /wrangler|@cloudflare|fetch\s*\(|D1Database|R2Bucket|executePrivateRevenueLeadAssessmentD1|readOwnerLeadDetail|\.send\s*\(|\.delete\s*\(/i, "the M1 website checkpoint must remain local, offline, and before assessment or owner-dossier execution");
requireMatch("scripts/private-kw-local-plan-executor.ts", privateKwLocalPlanExecutor, /verifyDurableEvidencePreflight/, "local durable seeding must use the planner's exact verifier");
requireMatch("scripts/private-kw-local-plan-executor.ts", privateKwLocalPlanExecutor, /verifyFencedEvidenceResumePreflight/, "local fenced seeding must use the planner's exact verifier");
requireMatch("scripts/private-kw-local-plan-executor.ts", privateKwLocalPlanExecutor, /SAVEPOINT/, "nested local D1 batches must use explicit savepoints");
forbidMatch("scripts/private-kw-local-plan-executor.ts", privateKwLocalPlanExecutor, /INSERT\s+OR\s+IGNORE\s+INTO\s+\"RevenueArtifactManifestAvailabilityReceipt\"/i, "availability seeding must fail closed on collisions instead of ignoring them");
forbidMatch("src/engine/worker.ts", engineWorker, /private-kw-shadow-slice/, "the inert engine must not wire the shadow-slice planner to runtime");
forbidMatch("src/engine/worker.ts", engineWorker, /private-kw-shadow-slice-progress|record-private-kw-shadow-progress/, "the inert engine must not wire shadow progress recording to runtime");
forbidMatch("src/engine/worker.ts", engineWorker, /private-kw-source-workflow-progress|prepare-private-kw-source-workflow-progress/, "the inert engine must not wire local progress proof preparation to runtime");
requireMatch("src/lib/revenue-engine/private-kw-assessment-invocation.ts", privateKwAssessmentInvocation, /localAssessmentMutationAuthorized:\s*z\.literal\(true\)/, "an owner invocation must explicitly authorize only the local assessment write");
requireMatch("src/lib/revenue-engine/private-kw-assessment-invocation.ts", privateKwAssessmentInvocation, /sourceMutationAuthorized:\s*z\.literal\(false\)/, "owner assessment approval must not authorize source mutation");
requireMatch("src/lib/revenue-engine/private-kw-assessment-invocation.ts", privateKwAssessmentInvocation, /contactDiscoveryAuthorized:\s*z\.literal\(false\)/, "owner assessment approval must not authorize contact discovery");
requireMatch("src/lib/revenue-engine/private-kw-assessment-invocation.ts", privateKwAssessmentInvocation, /outreachAuthorized:\s*z\.literal\(false\)/, "owner assessment approval must not authorize outreach");
requireMatch("src/lib/revenue-engine/private-kw-assessment-invocation.ts", privateKwAssessmentInvocation, /providerOperationsAuthorized:\s*z\.literal\(0\)/, "owner assessment approval must authorize zero provider operations");
forbidMatch("src/lib/revenue-engine/private-kw-assessment-invocation.ts", privateKwAssessmentInvocation, /@cloudflare|env\.[A-Z_]+|D1Database|R2Bucket|fetch\s*\(|\.prepare\s*\(|\.batch\s*\(|\.put\s*\(|\.delete\s*\(/, "owner assessment invocation must remain deterministic and provider-free");
requireMatch("scripts/execute-private-kw-assessment.ts", privateKwAssessmentCli, /inspectPrivateKwDatabase/, "private assessment execution must use an inspected ignored local database");
requireMatch("scripts/execute-private-kw-assessment.ts", privateKwAssessmentCli, /assertExactPrivateKwSourceMaterialization/, "private assessment execution must prove exact source materialization first");
requireMatch("scripts/execute-private-kw-assessment.ts", privateKwAssessmentCli, /assertCanonicalPrivateKwRevenueSchema/, "private assessment execution must reject modified Revenue tables, indexes, and triggers");
requireMatch("scripts/execute-private-kw-assessment.ts", privateKwAssessmentCli, /executePrivateRevenueLeadAssessmentD1/, "private assessment execution must use the sealed assessment writer");
requireMatch("scripts/execute-private-kw-assessment.ts", privateKwAssessmentCli, /sourceMutationPerformed:\s*false/, "private assessment execution must report no source mutation");
requireMatch("scripts/execute-private-kw-assessment.ts", privateKwAssessmentCli, /providerOperationsAuthorized:\s*0/, "private assessment execution must authorize zero provider operations");
forbidMatch("scripts/execute-private-kw-assessment.ts", privateKwAssessmentCli, /wrangler|--remote|deploy|fetch\s*\(|env\.[A-Z_]+|@cloudflare|R2Bucket/i, "private assessment execution must not access Cloudflare, providers, network, or remote resources");
requireMatch("scripts/execute-private-kw-m1-dossier.ts", privateKwM1Dossier, /parsePrivateKwM1DossierOperation/, "the M1 dossier must parse one strict bounded operation");
requireMatch("scripts/execute-private-kw-m1-dossier.ts", privateKwM1Dossier, /executePrivateKwM1WebsiteCheckpoint/, "the M1 dossier must compose the Task 4B1 website checkpoint service");
requireMatch("scripts/execute-private-kw-m1-dossier.ts", privateKwM1Dossier, /executePrivateKwAssessmentFile/, "the M1 dossier must use the validated assessment file boundary");
requireMatch("scripts/execute-private-kw-m1-dossier.ts", privateKwM1Dossier, /loadPrivateRevenueLeadAssessmentD1/, "the M1 dossier must reload assessment rows after closing SQLite");
requireMatch("scripts/execute-private-kw-m1-dossier.ts", privateKwM1Dossier, /readOwnerLeadDetail/, "the M1 dossier must use the canonical owner detail reader");
requireMatch("scripts/execute-private-kw-m1-dossier.ts", privateKwM1Dossier, /buildPrivateKwAssessmentProgressInputForPersistedWebsiteCheckpoint/, "the M1 dossier must use the exact persisted-website assessment composition boundary");
requireMatch("scripts/execute-private-kw-m1-dossier.ts", privateKwM1Dossier, /writeOrVerifyPrivateKwJson/, "the M1 dossier must use exact replay-safe JSON outputs");
requireMatch("scripts/execute-private-kw-m1-dossier.ts", privateKwM1Dossier, /contactReview\.state !== \"NOT_RECORDED\"/, "the M1 dossier must preserve missing contact review explicitly");
requireMatch("src/lib/revenue-engine/private-kw-assessment-progress-proof.ts", privateKwAssessmentProgressProof, /requireCurrentPrivateKwWebsiteEvidenceEligibilityD1Result/, "persisted website assessment proof must require the exact trusted eligibility reload");
requireMatch("src/lib/revenue-engine/private-kw-assessment-progress-proof.ts", privateKwAssessmentProgressProof, /eligibility\.receiptRecordedAt/, "persisted website assessment proof must derive completion from durable eligibility");
forbidMatch("scripts/execute-private-kw-m1-dossier.ts", privateKwM1Dossier, /wrangler|--remote|deploy|fetch\s*\(|env\.[A-Z_]+|@cloudflare|R2Bucket|mailbox|\.send\s*\(|outreachAuthorized:\s*true|sendAuthorized:\s*true|providerOperationsAuthorized:\s*[1-9]|costAuthorizedUsd:\s*[1-9]/i, "the M1 dossier must remain local, offline, and before contact or provider action");
forbidMatch("scripts/execute-private-kw-m1-dossier.ts", privateKwM1Dossier, /--failure-after-stage|FAILURE_AFTER_STAGE|process\.env[^\n]*failureAfterStage/i, "the M1 interruption hook must not be reachable through CLI or environment parsing");
forbidMatch("src/engine/worker.ts", engineWorker, /private-kw-assessment-invocation|execute-private-kw-assessment/, "the inert engine must not wire owner-approved local assessment execution to runtime");
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
requireMatch("src/lib/revenue-engine/artifact-delivery-authorization.ts", artifactDeliveryAuthorization, /issuerKind:\s*z\.literal\("FIXTURE"\)/, "artifact delivery grants must remain fixture-issued");
requireMatch("src/lib/revenue-engine/artifact-delivery-authorization.ts", artifactDeliveryAuthorization, /ARTIFACT_DELIVERY_MAX_TTL_MS\s*=\s*5\s*\*\s*60\s*\*\s*1_000/, "artifact delivery grants must expire within five minutes");
requireMatch("src/lib/revenue-engine/artifact-delivery-authorization.ts", artifactDeliveryAuthorization, /authenticatedSessionRequired:\s*z\.literal\(true\)/, "artifact delivery must require an authenticated session");
requireMatch("src/lib/revenue-engine/artifact-delivery-authorization.ts", artifactDeliveryAuthorization, /exactDossierMatchRequired:\s*z\.literal\(true\)/, "artifact delivery must bind the exact dossier");
requireMatch("src/lib/revenue-engine/artifact-delivery-authorization.ts", artifactDeliveryAuthorization, /providerReadAuthorized:\s*z\.literal\(false\)/, "fixture artifact delivery must not authorize an R2 read");
requireMatch("src/lib/revenue-engine/artifact-delivery-authorization.ts", artifactDeliveryAuthorization, /runtimeConnected:\s*z\.literal\(false\)/, "artifact delivery must remain disconnected from runtime");
requireMatch("src/lib/revenue-engine/artifact-delivery-fixture.ts", artifactDeliveryFixture, /"Cache-Control":\s*z\.literal\("private, no-store, max-age=0"\)/, "artifact responses must be private and non-cacheable");
requireMatch("src/lib/revenue-engine/artifact-delivery-fixture.ts", artifactDeliveryFixture, /"Cross-Origin-Resource-Policy":\s*z\.literal\("same-origin"\)/, "artifact responses must remain same-origin");
forbidMatch("src/lib/revenue-engine/artifact-delivery-authorization.ts", artifactDeliveryAuthorization, /"DOM"|@cloudflare|env\.[A-Z_]+|D1Database|R2Bucket|fetch\s*\(|\.head\s*\(|\.put\s*\(|\.delete\s*\(|\.prepare\s*\(|\.batch\s*\(/, "grant authorization must exclude DOM rendering and provider, runtime, database, network, write, or deletion access");
forbidMatch("src/lib/revenue-engine/artifact-delivery-fixture.ts", artifactDeliveryFixture, /"DOM"|@cloudflare|env\.[A-Z_]+|D1Database|R2Bucket|fetch\s*\(|\.head\s*\(|\.put\s*\(|\.delete\s*\(|\.prepare\s*\(|\.batch\s*\(/, "fixture delivery must exclude DOM rendering and provider, runtime, database, network, write, or deletion access");
forbidMatch("src/engine/worker.ts", engineWorker, /artifact-delivery-(?:authorization|fixture)/, "the inert engine must not wire private artifact delivery to runtime");
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
requireMatch("src/lib/revenue-engine/website-audit.ts", websiteAudit, /DETERMINISTIC_WEBSITE_AUDIT_VERSION\s*=\s*"website-audit-deterministic-v4"/, "repeatable audit evidence must use the capture-aware v4 identity");
requireMatch("src/lib/revenue-engine/website-audit.ts", websiteAudit, /deterministicWebsiteAuditClaimId\(businessId:\s*string,\s*capturedAt:\s*string,\s*checkId:\s*string\)[\s\S]*?createHash\("sha256"\)[\s\S]*?\$\{capturedAt\}[\s\S]*?\$\{checkId\}/, "evidence claim identity must bind the capture time and check identity");
requireMatch("src/lib/revenue-engine/lead-assessment.ts", leadAssessment, /deterministicWebsiteAuditClaimId\(business\.id,\s*receipt\.audit\.capturedAt,\s*check\.checkId\)/, "assessment persistence must verify each deterministic evidence identity");
requireMatch("src/lib/revenue-engine/lead-assessment.ts", leadAssessment, /closureStatus:\s*z\.literal\("SEALED"\)/, "shadow assessment must require a sealed workflow receipt");
requireMatch("src/lib/revenue-engine/lead-assessment.ts", leadAssessment, /recommendedChannel:\s*z\.literal\("RESEARCH"\)/, "unverified reachability must remain a research route");
requireMatch("src/lib/revenue-engine/lead-assessment.ts", leadAssessment, /reachability:\s*0/, "audit persistence must not infer reachability");
requireMatch("src/lib/revenue-engine/lead-assessment.ts", leadAssessment, /runtimeConnected:\s*z\.literal\(false\)/, "assessment output must remain disconnected from runtime");
requireMatch("src/lib/revenue-engine/lead-assessment.ts", leadAssessment, /outreachAuthorized:\s*z\.literal\(false\)/, "assessment output must not authorize outreach");
requireMatch("src/lib/revenue-engine/lead-assessment.ts", leadAssessment, /sendAuthorized:\s*z\.literal\(false\)/, "assessment output must not authorize sending");
requireMatch("src/lib/revenue-engine/lead-assessment.ts", leadAssessment, /providerOperationsAuthorized:\s*z\.literal\(0\)/, "assessment output must not authorize provider operations");
forbidMatch("src/lib/revenue-engine/lead-assessment.ts", leadAssessment, /@cloudflare|env\.[A-Z_]+|D1Database|R2Bucket|fetch\s*\(|\.prepare\s*\(|\.batch\s*\(|\.put\s*\(|\.delete\s*\(/, "assessment construction must remain deterministic and provider-free");
requireMatch("src/lib/revenue-engine/contact-discovery.ts", contactDiscovery, /adapterKind:\s*z\.literal\("FIXTURE"\)/, "contact discovery must remain fixture-only");
requireMatch("src/lib/revenue-engine/contact-discovery.ts", contactDiscovery, /contactPersistenceAuthorized:\s*z\.literal\(false\)/, "contact discovery must not authorize persistence");
requireMatch("src/lib/revenue-engine/contact-discovery.ts", contactDiscovery, /verificationAuthorized:\s*z\.literal\(false\)/, "contact discovery must not authorize verification");
requireMatch("src/lib/revenue-engine/contact-discovery.ts", contactDiscovery, /outreachAuthorized:\s*z\.literal\(false\)/, "contact discovery must not authorize outreach");
requireMatch("src/lib/revenue-engine/contact-discovery.ts", contactDiscovery, /sendAuthorized:\s*z\.literal\(false\)/, "contact discovery must not authorize sending");
requireMatch("src/lib/revenue-engine/contact-discovery.ts", contactDiscovery, /maxProviderOperations:\s*z\.literal\(0\)/, "contact discovery must have zero provider-operation budget");
requireMatch("src/lib/revenue-engine/contact-discovery.ts", contactDiscovery, /maxCostUsd:\s*z\.literal\(0\)/, "contact discovery must have zero provider cost");
forbidMatch("src/lib/revenue-engine/contact-discovery.ts", contactDiscovery, /@cloudflare|env\.[A-Z_]+|D1Database|R2Bucket|fetch\s*\(|\.prepare\s*\(|\.batch\s*\(|\.put\s*\(|\.delete\s*\(/, "fixture contact discovery must not access providers, runtime bindings, network, or persistence");
requireMatch("src/lib/revenue-engine/contact-verification.ts", contactVerification, /verifierKind:\s*z\.literal\("FIXTURE"\)/, "contact verification must remain fixture-only");
requireMatch("src/lib/revenue-engine/contact-verification.ts", contactVerification, /verificationPersistenceAuthorized:\s*z\.literal\(false\)/, "contact verification must not authorize persistence");
requireMatch("src/lib/revenue-engine/contact-verification.ts", contactVerification, /qualificationPersistenceAuthorized:\s*z\.literal\(false\)/, "contact verification must not authorize qualification persistence");
requireMatch("src/lib/revenue-engine/contact-verification.ts", contactVerification, /autonomousEmailEligible:\s*z\.literal\(false\)/, "contact verification must never grant autonomous email authority");
requireMatch("src/lib/revenue-engine/contact-verification.ts", contactVerification, /outreachAuthorized:\s*z\.literal\(false\)/, "contact verification must not authorize outreach");
requireMatch("src/lib/revenue-engine/contact-verification.ts", contactVerification, /sendAuthorized:\s*z\.literal\(false\)/, "contact verification must not authorize sending");
requireMatch("src/lib/revenue-engine/contact-verification.ts", contactVerification, /maxProviderOperations:\s*z\.literal\(0\)/, "contact verification must have zero provider-operation budget");
requireMatch("src/lib/revenue-engine/contact-verification.ts", contactVerification, /maxCostUsd:\s*z\.literal\(0\)/, "contact verification must have zero provider cost");
forbidMatch("src/lib/revenue-engine/contact-verification.ts", contactVerification, /@cloudflare|env\.[A-Z_]+|D1Database|R2Bucket|fetch\s*\(|\.prepare\s*\(|\.batch\s*\(|\.put\s*\(|\.delete\s*\(/, "fixture contact verification must not access providers, runtime bindings, network, or persistence");
requireMatch("src/lib/revenue-engine/contact-persistence-plan.ts", contactPersistencePlan, /executorImplemented:\s*z\.literal\(false\)/, "contact persistence must remain planning-only");
requireMatch("src/lib/revenue-engine/contact-persistence-plan.ts", contactPersistencePlan, /REVENUE_CONTACT_PERSISTENCE_TARGET_SCHEMA_VERSION\s*=\s*"0063_harden_contact_record_lineage"/, "contact persistence must require the lineage-guarded schema");
requireMatch("src/lib/revenue-engine/contact-persistence-plan.ts", contactPersistencePlan, /databaseAccessAuthorized:\s*z\.literal\(false\)/, "contact persistence planning must not authorize database access");
requireMatch("src/lib/revenue-engine/contact-persistence-plan.ts", contactPersistencePlan, /mutationAuthorized:\s*z\.literal\(false\)/, "contact persistence planning must not authorize mutation");
requireMatch("src/lib/revenue-engine/contact-persistence-plan.ts", contactPersistencePlan, /consentRows:\s*z\.literal\(0\)/, "contact persistence must not infer consent rows");
requireMatch("src/lib/revenue-engine/contact-persistence-plan.ts", contactPersistencePlan, /providerOperationsAuthorized:\s*z\.literal\(0\)/, "contact persistence planning must authorize zero provider operations");
requireMatch("src/lib/revenue-engine/contact-persistence-plan.ts", contactPersistencePlan, /costAuthorizedUsd:\s*z\.literal\(0\)/, "contact persistence planning must authorize zero provider cost");
forbidMatch("src/lib/revenue-engine/contact-persistence-plan.ts", contactPersistencePlan, /@cloudflare|env\.[A-Z_]+|D1Database|R2Bucket|fetch\s*\(|\.prepare\s*\(|\.batch\s*\(|\.run\s*\(|\.put\s*\(|\.delete\s*\(/, "contact persistence planning must not access providers, runtime bindings, databases, network, or writes");
forbidMatch("src/lib/revenue-engine/contact-persistence-plan.ts", contactPersistencePlan, /LIMIT\s+1/i, "contact persistence collision preflights must inspect every matching identity");
forbidMatch("src/engine/worker.ts", engineWorker, /contact-(?:discovery|verification|persistence-plan)/, "the inert engine must not wire contact processing to runtime");
requireMatch("src/lib/revenue-engine/private-kw-source-workflow-materialization.ts", privateKwMaterialization, /PRIVATE_KW_SOURCE_WORKFLOW_TARGET_SCHEMA_VERSION\s*=\s*\n?\s*"0064_local_source_workflow_materializations"/, "private KW materialization must require the append-only receipt schema");
requireMatch("src/lib/revenue-engine/private-kw-source-workflow-materialization.ts", privateKwMaterialization, /auditWebsiteDeterministically\(input\.auditInput\)/, "private KW materialization must re-derive the deterministic audit from approved inputs");
requireMatch("src/lib/revenue-engine/private-kw-source-workflow-materialization.ts", privateKwMaterialization, /localSourceMutationAuthorized:\s*z\.literal\(true\)/, "only the explicit local materialization approval may authorize source mutation");
requireMatch("src/lib/revenue-engine/private-kw-source-workflow-materialization.ts", privateKwMaterialization, /localWorkflowMutationAuthorized:\s*z\.literal\(true\)/, "only the explicit local materialization approval may authorize workflow mutation");
for (const field of ["localAssessmentMutationAuthorized", "schemaMutationAuthorized", "captureAuthorized", "contactDiscoveryAuthorized", "contactVerificationAuthorized", "outreachAuthorized", "sendAuthorized"]) {
  requireMatch("src/lib/revenue-engine/private-kw-source-workflow-materialization.ts", privateKwMaterialization, new RegExp(`${field}:\\s*z\\.literal\\(false\\)`), `${field} must remain false in the local materialization contract`);
}
requireMatch("src/lib/revenue-engine/private-kw-source-workflow-materialization.ts", privateKwMaterialization, /providerOperationsAuthorized:\s*z\.literal\(0\)/, "local materialization must authorize zero provider operations");
requireMatch("src/lib/revenue-engine/private-kw-source-workflow-materialization.ts", privateKwMaterialization, /costAuthorizedUsd:\s*z\.literal\(0\)/, "local materialization must authorize zero provider cost");
requireMatch("src/lib/revenue-engine/private-kw-source-workflow-materialization.ts", privateKwMaterialization, /plan\.records\.at\(-1\)\?\.entity\s*!==\s*"MATERIALIZATION_RECEIPT"/, "the local materialization receipt must remain the final planned insert");
forbidMatch("src/lib/revenue-engine/private-kw-source-workflow-materialization.ts", privateKwMaterialization, /LIMIT\s+1/i, "local materialization collision preflights must inspect every matching identity");
forbidMatch("src/lib/revenue-engine/private-kw-source-workflow-materialization.ts", privateKwMaterialization, /@cloudflare|env\.[A-Z_]+|D1Database|R2Bucket|fetch\s*\(|\.prepare\s*\(|\.batch\s*\(|\.run\s*\(|\.put\s*\(|\.delete\s*\(/, "the materialization planner must not access runtime bindings, providers, network, or databases");
requireMatch("scripts/materialize-private-kw-source-workflow.ts", privateKwMaterializationCli, /execute\.immediate\(\)/, "local source and workflow rows must commit under one SQLite IMMEDIATE transaction");
requireMatch("scripts/materialize-private-kw-source-workflow.ts", privateKwMaterializationCli, /assertCanonicalPrivateKwRevenueSchema\(database\)/, "local materialization must verify the complete canonical Revenue schema before mutation");
requireMatch("scripts/materialize-private-kw-source-workflow.ts", privateKwMaterializationCli, /Committed private KW materialization row failed exact reload/, "local materialization must reload every exact row before commit");
requireMatch("scripts/materialize-private-kw-source-workflow.ts", privateKwMaterializationCli, /missing\.at\(-1\)\?\.entity\s*!==\s*"MATERIALIZATION_RECEIPT"/, "the local executor must commit its receipt last");
requireMatch("scripts/materialize-private-kw-source-workflow.ts", privateKwMaterializationCli, /inspectPrivateKwDatabase\(files\.database/, "the local executor must stay inside the guarded ignored database boundary");
forbidMatch("scripts/materialize-private-kw-source-workflow.ts", privateKwMaterializationCli, /@cloudflare|env\.[A-Z_]+|D1Database|R2Bucket|fetch\s*\(|wrangler|migrations apply|\.put\s*\(|\.delete\s*\(/i, "the local materialization executor must not access runtime bindings, providers, network, migration, or deployment paths");
forbidMatch("src/engine/worker.ts", engineWorker, /private-kw-source-workflow-materialization|materialize-private-kw-source-workflow/, "the inert engine must not wire the local materialization boundary to runtime");
requireMatch("src/lib/revenue-engine/private-kw-contact-persistence.ts", privateKwContactPersistence, /buildRevenueContactPersistencePlan\(\{ discovery, verifications \}\)/, "local contact persistence must re-derive the validation-only plan from exact results");
requireMatch("src/lib/revenue-engine/private-kw-contact-persistence.ts", privateKwContactPersistence, /PRIVATE_KW_CONTACT_PERSISTENCE_TARGET_SCHEMA_VERSION\s*=\s*\n?\s*"0066_harden_local_contact_persistence_receipts"/, "local contact persistence must require the hardened receipt schema");
requireMatch("src/lib/revenue-engine/private-kw-contact-persistence.ts", privateKwContactPersistence, /localContactMutationAuthorized:\s*z\.literal\(true\)/, "only the separate local contact approval may authorize contact mutation");
requireMatch("src/lib/revenue-engine/private-kw-contact-persistence.ts", privateKwContactPersistence, /localVerificationMutationAuthorized:\s*z\.literal\(true\)/, "only the separate local contact approval may authorize verification mutation");
for (const field of ["sourceMutationAuthorized", "workflowMutationAuthorized", "assessmentMutationAuthorized", "schemaMutationAuthorized", "captureAuthorized", "contactDiscoveryAuthorized", "contactVerificationAuthorized", "consentDecisionAuthorized", "qualificationAuthorized", "outreachAuthorized", "sendAuthorized"]) {
  requireMatch("src/lib/revenue-engine/private-kw-contact-persistence.ts", privateKwContactPersistence, new RegExp(`${field}:\\s*z\\.literal\\(false\\)`), `${field} must remain false in the local contact persistence contract`);
}
requireMatch("src/lib/revenue-engine/private-kw-contact-persistence.ts", privateKwContactPersistence, /providerOperationsAuthorized:\s*z\.literal\(0\)/, "local contact persistence must authorize zero provider operations");
requireMatch("src/lib/revenue-engine/private-kw-contact-persistence.ts", privateKwContactPersistence, /costAuthorizedUsd:\s*z\.literal\(0\)/, "local contact persistence must authorize zero provider cost");
requireMatch("src/lib/revenue-engine/private-kw-contact-persistence.ts", privateKwContactPersistence, /plan\.records\.at\(-1\)\?\.entity\s*!==\s*"MATERIALIZATION_RECEIPT"/, "the local contact materialization receipt must remain the final planned insert");
forbidMatch("src/lib/revenue-engine/private-kw-contact-persistence.ts", privateKwContactPersistence, /LIMIT\s+1/i, "local contact persistence collision preflights must inspect every identity");
forbidMatch("src/lib/revenue-engine/private-kw-contact-persistence.ts", privateKwContactPersistence, /@cloudflare|env\.[A-Z_]+|D1Database|R2Bucket|fetch\s*\(|\.prepare\s*\(|\.run\s*\(|\.put\s*\(|\.delete\s*\(/, "the local contact persistence planner must not access runtime bindings, providers, network, or databases");
requireMatch("scripts/private-kw-contact-persistence-executor.ts", privateKwContactPersistenceExecutor, /execute\.immediate\(\)/, "local contact persistence must commit under one SQLite IMMEDIATE transaction");
requireMatch("scripts/private-kw-contact-persistence-executor.ts", privateKwContactPersistenceExecutor, /assertCanonicalPrivateKwRevenueSchema\(database\)/, "local contact persistence must verify the complete canonical Revenue schema");
requireMatch("scripts/private-kw-contact-persistence-executor.ts", privateKwContactPersistenceExecutor, /buildPrivateKwContactPersistencePlan\(input\)/, "the executor must re-derive the trusted local contact plan from exact inputs");
requireMatch("scripts/private-kw-contact-persistence-executor.ts", privateKwContactPersistenceExecutor, /Committed private KW contact persistence row failed exact reload/, "local contact persistence must reload every row before commit");
requireMatch("scripts/private-kw-contact-persistence-executor.ts", privateKwContactPersistenceExecutor, /missing\.at\(-1\)\?\.entity\s*!==\s*"MATERIALIZATION_RECEIPT"/, "the local contact executor must commit its receipt last");
forbidMatch("scripts/private-kw-contact-persistence-executor.ts", privateKwContactPersistenceExecutor, /@cloudflare|env\.[A-Z_]+|D1Database|R2Bucket|fetch\s*\(|wrangler|migrations apply|readFile|writeFile|process\.argv|\.put\s*\(|\.delete\s*\(/i, "the proven local contact executor must remain disconnected from files, runtime, providers, migration, deployment, and CLI invocation");
forbidMatch("src/engine/worker.ts", engineWorker, /private-kw-contact-persistence|private-kw-contact-persistence-executor/, "the inert engine must not wire local contact persistence to runtime");
requireMatch("package.json", packageJson, /"kw:prepare-contact-review"\s*:\s*"tsx scripts\/prepare-private-kw-contact-review\.ts"/, "the read-only contact review command must remain explicit");
requireMatch("package.json", packageJson, /"kw:persist-contacts"\s*:\s*"tsx scripts\/persist-private-kw-contacts\.ts"/, "the separately approved contact invocation command must remain explicit");
requireMatch("scripts/private-kw-database.ts", privateKwDatabase, /PRIVATE_KW_CANONICAL_MIGRATION_RANGE\s*=\s*"0054-0068"/, "ignored-local execution must require the complete migration 0068 schema");
requireMatch("src/lib/revenue-engine/private-kw-contact-invocation.ts", privateKwContactInvocation, /review:\s*PrivateKwContactReviewSchema/, "the durable invocation must retain the complete human-reviewed packet");
requireMatch("src/lib/revenue-engine/private-kw-contact-invocation.ts", privateKwContactInvocation, /buildFixtureContactDiscoveryResult\(/, "contact review must reconstruct fixture discovery from reviewed observations");
requireMatch("src/lib/revenue-engine/private-kw-contact-invocation.ts", privateKwContactInvocation, /buildFixtureContactVerificationResult\(/, "contact review must reconstruct fixture verification from reviewed observations");
requireMatch("src/lib/revenue-engine/private-kw-contact-invocation.ts", privateKwContactInvocation, /buildPrivateKwContactPersistencePlan\(/, "contact invocation must bind the re-derived trusted contact materialization");
for (const field of ["contactDiscoveryExecutionAuthorized", "contactVerificationExecutionAuthorized", "consentDecisionAuthorized", "qualificationAuthorized", "outreachAuthorized", "sendAuthorized"]) {
  requireMatch("src/lib/revenue-engine/private-kw-contact-invocation.ts", privateKwContactInvocation, new RegExp(`${field}:\\s*z\\.literal\\(false\\)`), `${field} must remain false in reviewed contact invocation contracts`);
}
requireMatch("src/lib/revenue-engine/private-kw-contact-invocation.ts", privateKwContactInvocation, /providerOperationsAuthorized:\s*z\.literal\(0\)/, "reviewed contact invocation must authorize zero provider operations");
requireMatch("src/lib/revenue-engine/private-kw-contact-invocation.ts", privateKwContactInvocation, /costAuthorizedUsd:\s*z\.literal\(0\)/, "reviewed contact invocation must authorize zero provider cost");
forbidMatch("src/lib/revenue-engine/private-kw-contact-invocation.ts", privateKwContactInvocation, /@cloudflare|env\.[A-Z_]+|D1Database|R2Bucket|Database|fetch\s*\(|\.prepare\s*\(|\.run\s*\(|\.batch\s*\(|\.put\s*\(|\.delete\s*\(/, "review construction must remain a pure fixture-only zero-provider contract");
requireMatch("scripts/private-kw-contact-prerequisites.ts", privateKwContactPrerequisites, /buildRevenueLeadAssessment\(/, "contact invocation must independently reconstruct the persisted assessment");
requireMatch("scripts/private-kw-contact-prerequisites.ts", privateKwContactPrerequisites, /assertExactPrivateKwSourceMaterialization/, "contact invocation must require exact source materialization");
forbidMatch("scripts/private-kw-contact-prerequisites.ts", privateKwContactPrerequisites, /\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE)\b|\.run\s*\(|\.transaction\s*\(/i, "contact prerequisites must remain SELECT-only");
requireMatch("scripts/prepare-private-kw-contact-review.ts", privateKwContactReviewCli, /readonly:\s*true/, "contact review preparation must open the local database read-only");
requireMatch("scripts/prepare-private-kw-contact-review.ts", privateKwContactReviewCli, /loadExactPrivateKwLeadAssessment\(database, draft\.assessment\)/, "contact review must load the exact persisted assessment lineage");
requireMatch("scripts/prepare-private-kw-contact-review.ts", privateKwContactReviewCli, /writePrivateKwJson\(files\.output, review\)/, "contact review must use guarded no-overwrite ignored output");
forbidMatch("scripts/prepare-private-kw-contact-review.ts", privateKwContactReviewCli, /@cloudflare|env\.[A-Z_]+|D1Database|R2Bucket|fetch\s*\(|\.run\s*\(|\.transaction\s*\(|wrangler|migrations apply|contact-persistence-executor/i, "read-only contact review must not mutate, call providers, migrate, deploy, or invoke contact persistence");
requireMatch("scripts/persist-private-kw-contacts.ts", privateKwContactInvocationCli, /execute\.immediate\(\)/, "reviewed contact persistence must use one outer SQLite IMMEDIATE transaction");
requireMatch("scripts/persist-private-kw-contacts.ts", privateKwContactInvocationCli, /assertCanonicalPrivateKwRevenueSchema\(database\)/, "reviewed contact persistence must verify the complete canonical schema");
requireMatch("scripts/persist-private-kw-contacts.ts", privateKwContactInvocationCli, /executePrivateKwContactPersistenceForLocalDatabase\(database/, "reviewed contact persistence must reuse the proven contact executor");
requireMatch("scripts/persist-private-kw-contacts.ts", privateKwContactInvocationCli, /receiptBoundary\.insert\(database, expectedReceipt\)[\s\S]*?Committed local contact invocation receipt failed exact reload/, "the invocation receipt must be inserted last and reloaded inside the outer transaction");
requireMatch("scripts/persist-private-kw-contacts.ts", privateKwContactInvocationCli, /loadExactPrivateKwLeadAssessment\(database, review\.draft\.assessment\)/, "reviewed contact persistence must re-derive exact assessment lineage inside the transaction");
forbidMatch("scripts/persist-private-kw-contacts.ts", privateKwContactInvocationCli, /@cloudflare|env\.[A-Z_]+|D1Database|R2Bucket|fetch\s*\(|wrangler|migrations apply|\.put\s*\(|\.delete\s*\(/i, "reviewed contact persistence must remain local and provider/deployment-free");
forbidMatch("src/engine/worker.ts", engineWorker, /private-kw-contact-invocation|private-kw-contact-prerequisites|prepare-private-kw-contact-review|persist-private-kw-contacts/, "the inert engine must not wire reviewed local contact invocation to runtime");
requireMatch("package.json", packageJson, /"kw:prepare-owner-labeling"\s*:\s*"tsx scripts\/prepare-private-kw-owner-labeling\.ts"/, "the ignored-local owner-labeling preparation command must remain explicit");
requireMatch("package.json", packageJson, /"kw:record-owner-labels"\s*:\s*"tsx scripts\/record-private-kw-owner-labels\.ts"/, "the immutable owner-label checkpoint command must remain explicit");
for (const field of ["databaseMutationAuthorized", "sourceMutationAuthorized", "assessmentMutationAuthorized", "qualificationAuthorized", "consentDecisionAuthorized", "outreachAuthorized", "sendAuthorized"]) {
  requireMatch("src/lib/revenue-engine/private-kw-owner-labeling.ts", privateKwOwnerLabeling, new RegExp(`${field}:\\s*z\\.literal\\(false\\)`), `${field} must remain false in owner-labeling contracts`);
}
requireMatch("src/lib/revenue-engine/private-kw-owner-labeling.ts", privateKwOwnerLabeling, /parentPacketId:\s*packet\.packetId/, "owner labels must create a resumable immutable checkpoint chain");
requireMatch("src/lib/revenue-engine/private-kw-owner-labeling.ts", privateKwOwnerLabeling, /providerOperationsAuthorized:\s*z\.literal\(0\)/, "owner labeling must authorize zero provider operations");
requireMatch("src/lib/revenue-engine/private-kw-owner-labeling.ts", privateKwOwnerLabeling, /costAuthorizedUsd:\s*z\.literal\(0\)/, "owner labeling must authorize zero provider cost");
forbidMatch("src/lib/revenue-engine/private-kw-owner-labeling.ts", privateKwOwnerLabeling, /@cloudflare|env\.[A-Z_]+|D1Database|R2Bucket|Database|fetch\s*\(|\.prepare\s*\(|\.run\s*\(|\.batch\s*\(|\.put\s*\(|\.delete\s*\(/, "owner-labeling composition must remain pure and provider-free");
requireMatch("scripts/prepare-private-kw-owner-labeling.ts", privateKwOwnerLabelingPrepareCli, /readonly:\s*true/, "owner-labeling preparation must open the local database read-only");
requireMatch("scripts/prepare-private-kw-owner-labeling.ts", privateKwOwnerLabelingPrepareCli, /assertCanonicalPrivateKwRevenueSchema\(database\)/, "owner-labeling preparation must verify the complete canonical schema");
requireMatch("scripts/prepare-private-kw-owner-labeling.ts", privateKwOwnerLabelingPrepareCli, /loadExactPrivateKwLeadAssessment\(database/, "owner-labeling preparation must reconstruct exact persisted assessment lineage");
requireMatch("scripts/prepare-private-kw-owner-labeling.ts", privateKwOwnerLabelingPrepareCli, /assertCompletePrivateKwOwnerLabelingCohort\(source\.records\.length, rows\.length\)/, "owner decisions must wait for the fixed 50-business cohort and one exact assessment per business");
requireMatch("scripts/prepare-private-kw-owner-labeling.ts", privateKwOwnerLabelingPrepareCli, /writePrivateKwJson\(files\.output, packet\)/, "owner-labeling preparation must use guarded no-overwrite ignored output");
forbidMatch("scripts/prepare-private-kw-owner-labeling.ts", privateKwOwnerLabelingPrepareCli, /@cloudflare|env\.[A-Z_]+|D1Database|R2Bucket|fetch\s*\(|\.run\s*\(|\.transaction\s*\(|wrangler|migrations apply/i, "owner-labeling preparation must remain SELECT-only, local, provider-free, and deployment-free");
requireMatch("scripts/record-private-kw-owner-labels.ts", privateKwOwnerLabelingRecordCli, /applyPrivateKwOwnerLabels\(packet, submission\)/, "owner-label recording must revalidate and content-bind the exact checkpoint");
requireMatch("scripts/record-private-kw-owner-labels.ts", privateKwOwnerLabelingRecordCli, /writePrivateKwJson\(files\.output, next\)/, "owner-label recording must create a no-overwrite ignored checkpoint");
forbidMatch("scripts/record-private-kw-owner-labels.ts", privateKwOwnerLabelingRecordCli, /@cloudflare|env\.[A-Z_]+|D1Database|R2Bucket|Database|fetch\s*\(|\.prepare\s*\(|\.run\s*\(|\.batch\s*\(|\.put\s*\(|\.delete\s*\(/, "owner-label recording must not access a database, runtime, provider, or network");
forbidMatch("src/engine/worker.ts", engineWorker, /private-kw-owner-labeling|prepare-private-kw-owner-labeling|record-private-kw-owner-labels/, "the inert engine must not wire owner labeling to runtime");
requireMatch("src/lib/revenue-engine/owner-labeling-workspace.ts", ownerLabelingWorkspace, /entries:\s*z\.array\(WorkspaceEntrySchema\)\.length\(50\)/, "the owner workspace must require the fixed 50-business evaluation set");
for (const field of ["databaseMutationAuthorized", "qualificationAuthorized", "consentDecisionAuthorized", "outreachAuthorized", "sendAuthorized"]) {
  requireMatch("src/lib/revenue-engine/owner-labeling-workspace.ts", ownerLabelingWorkspace, new RegExp(`${field}:\\s*z\\.literal\\(false\\)`), `${field} must remain false in the owner workspace response`);
}
requireMatch("src/lib/revenue-engine/owner-labeling-workspace.ts", ownerLabelingWorkspace, /providerOperationsAuthorized:\s*z\.literal\(0\)/, "the owner workspace must authorize zero provider operations");
requireMatch("src/lib/revenue-engine/owner-labeling-workspace.ts", ownerLabelingWorkspace, /costAuthorizedUsd:\s*z\.literal\(0\)/, "the owner workspace must authorize zero spend");
forbidMatch("src/lib/revenue-engine/owner-labeling-workspace.ts", ownerLabelingWorkspace, /@cloudflare|env\.[A-Z_]+|D1Database|R2Bucket|fetch\s*\(|\.prepare\s*\(|\.run\s*\(|\.batch\s*\(|\.put\s*\(|\.delete\s*\(/, "owner workspace composition must remain pure and provider-free");
forbidMatch("src/lib/revenue-engine/owner-labeling-upload.ts", ownerLabelingUpload, /@cloudflare|env\.[A-Z_]+|D1Database|R2Bucket|fetch\s*\(|\.prepare\s*\(|\.run\s*\(|\.batch\s*\(|\.put\s*\(|\.delete\s*\(/, "owner checkpoint validation must not access providers, databases, or writes");
requireMatch("src/app/api/v1/leads/evaluation/validate/route.ts", ownerLabelingRoute, /requireApiSession\(request\)/, "owner checkpoint validation must require an authenticated session");
requireMatch("src/app/api/v1/leads/evaluation/validate/route.ts", ownerLabelingRoute, /export async function POST\(request:\s*Request\)/, "owner checkpoint validation must remain one explicit validation-only POST");
requireMatch("src/app/api/v1/leads/evaluation/validate/route.ts", ownerLabelingRoute, /readOwnerLabelingPacketRequest\(request\)/, "owner checkpoint validation must enforce the bounded upload parser");
requireMatch("src/app/api/v1/leads/evaluation/validate/route.ts", ownerLabelingRoute, /private, no-store/, "owner checkpoint validation responses must not be cached publicly");
forbidMatch("src/app/api/v1/leads/evaluation/validate/route.ts", ownerLabelingRoute, /getDatabase|D1Database|R2Bucket|\.run\s*\(|\.put\s*\(|\.delete\s*\(|export async function (?:GET|PUT|PATCH|DELETE)/, "owner checkpoint validation must not read or mutate a database, artifact store, or expose another method");
requireMatch("src/app/leads/evaluation/page.tsx", ownerLabelingPage, /await requireSession\(\)/, "the Quality Lab page must require an authenticated session");
forbidMatch("src/app/leads/evaluation/page.tsx", ownerLabelingPage, /getDatabase|fetch\s*\(|export async function (?:POST|PUT|PATCH|DELETE)|\.run\s*\(/, "the Quality Lab page must not read a database, self-fetch, or expose write methods");
requireMatch("src/components/leads/owner-lead-evaluation-workspace.tsx", ownerLabelingComponent, /fetch\("\/api\/v1\/leads\/evaluation\/validate"/, "the Quality Lab may call only its authenticated same-origin validation route");
if ((ownerLabelingComponent.match(/fetch\s*\(/g) || []).length !== 1) failures.push("src/components/leads/owner-lead-evaluation-workspace.tsx: exactly one same-origin validation fetch is allowed");
requireMatch("src/components/leads/owner-lead-evaluation-workspace.tsx", ownerLabelingComponent, /Review only · no outreach/, "the Quality Lab must state its review-only authority");
forbidMatch("src/components/leads/owner-lead-evaluation-workspace.tsx", ownerLabelingComponent, /mailto:|tel:|\/api\/outreach|\/api\/send|\.prepare\s*\(|\.run\s*\(|\.put\s*\(|\.delete\s*\(/, "the Quality Lab must not expose contact actions, mutation endpoints, or storage writes");
forbidMatch("src/engine/worker.ts", engineWorker, /owner-labeling-workspace|owner-labeling-upload|leads\/evaluation/, "the inert engine must not wire the owner Quality Lab to runtime execution");
for (const field of ["deploymentAuthorized", "databaseMigrationAuthorized", "engineDeploymentAuthorized"]) {
  requireMatch("src/lib/revenue-engine/staging-console-release.ts", stagingConsoleRelease, new RegExp(`${field}:\\s*z\\.literal\\(false\\)`), `${field} must remain false in every staging console packet`);
  requireMatch("docs/releases/staging/2026-08-28-owner-quality-lab.json", stagingConsoleReleasePacket, new RegExp(`"${field}"\\s*:\\s*false`), `${field} must remain false in the prepared packet`);
}
for (const field of ["providerOperationsAuthorized", "externalWebsiteRequestsAuthorized", "mailboxOperationsAuthorized", "prospectContactsAuthorized", "costAuthorizedCad"]) {
  requireMatch("src/lib/revenue-engine/staging-console-release.ts", stagingConsoleRelease, new RegExp(`${field}:\\s*z\\.literal\\(0\\)`), `${field} must remain zero in every staging console packet`);
  requireMatch("docs/releases/staging/2026-08-28-owner-quality-lab.json", stagingConsoleReleasePacket, new RegExp(`"${field}"\\s*:\\s*0`), `${field} must remain zero in the prepared packet`);
}
requireMatch("src/lib/revenue-engine/staging-console-release.ts", stagingConsoleRelease, /status:\s*z\.literal\("PENDING"\)[\s\S]*?readiness:\s*z\.literal\("PREPARED_NOT_APPROVED"\)/, "staging packets must require a separate approval and remain not approved");
requireMatch("src/lib/revenue-engine/staging-console-release.ts", stagingConsoleRelease, /providerSecretNames:\s*EmptyStringArraySchema[\s\S]*?serviceBindings:\s*EmptyStringArraySchema[\s\S]*?queueBindings:\s*EmptyStringArraySchema[\s\S]*?cronTriggers:\s*EmptyStringArraySchema/, "staging console packets must reject provider secrets, services, queues, and crons");
requireMatch("scripts/verify-staging-console-release.ts", stagingConsoleReleaseVerifier, /execFileSync\("git"/, "the staging packet verifier must use argument-safe Git calls");
requireMatch("scripts/verify-staging-console-release.ts", stagingConsoleReleaseVerifier, /resolve\(REPOSITORY_ROOT,\s*"docs",\s*"releases",\s*"staging"\)/, "the verifier must restrict packet files to committed staging-release storage");
requireMatch("scripts/verify-staging-console-release.ts", stagingConsoleReleaseVerifier, /\["ls-files",\s*"--error-unmatch",\s*"--",\s*repositoryPath\][\s\S]*?\["rev-parse",\s*`:\$\{repositoryPath\}`\][\s\S]*?\["hash-object",\s*"--",\s*repositoryPath\]/, "packet verification must require a tracked exact Git blob before trusting the release artifact");
forbidMatch("scripts/verify-staging-console-release.ts", stagingConsoleReleaseVerifier, /wrangler|https?:\/\/|fetch\s*\(|D1Database|R2Bucket|\.prepare\s*\(|\.run\s*\(|\.batch\s*\(|\.put\s*\(|\.delete\s*\(/i, "packet verification must not access Cloudflare, providers, databases, networks, or deployment commands");
requireMatch("package.json", packageJson, /"staging:verify-console-release"\s*:\s*"tsx scripts\/verify-staging-console-release\.ts"/, "the exact staging packet verifier must remain available to operators and CI");
requireMatch(".github/workflows/ci.yml", ci, /fetch-depth:\s*0[\s\S]*?npm run staging:verify-console-release -- docs\/releases\/staging\/2026-08-28-owner-quality-lab\.json/, "Linux CI must fetch exact history and verify the committed staging packet");
forbidMatch("src/engine/worker.ts", engineWorker, /staging-console-release|verify-staging-console-release/, "the inert engine must not wire staging release packets to runtime execution");
requireMatch("src/lib/revenue-engine/lead-assessment-d1.ts", leadAssessmentD1, /REVENUE_LEAD_ASSESSMENT_TARGET_SCHEMA_VERSION\s*=\s*"0061_shadow_lead_assessment_receipts"/, "the private assessment executor must require the append-only assessment schema");
requireMatch("src/lib/revenue-engine/lead-assessment-d1.ts", leadAssessmentD1, /Pick<D1Database,\s*"prepare"\s*\|\s*"batch">/, "the private assessment adapter must use the generated narrow D1 binding type");
requireMatch("src/lib/revenue-engine/lead-assessment-d1.ts", leadAssessmentD1, /FROM "RevenueWorkflowReceiptRevision" receipt[\s\S]*?JOIN "RevenueWorkflowAttemptClosure" closure[\s\S]*?closure\."terminalReceiptId" = receipt\."id"/, "assessment persistence must begin from the exact terminal workflow receipt");
requireMatch("src/lib/revenue-engine/lead-assessment-d1.ts", leadAssessmentD1, /boundary\.batch\(missingPlans\.map\(\(plan\) => plan\.insert\)\)/, "assessment records must commit through one D1 batch boundary");
requireMatch("src/lib/revenue-engine/lead-assessment-d1.ts", leadAssessmentD1, /strftime\('%Y-%m-%dT%H:%M:%fZ', 'now'\)[\s\S]*?assertFreshAssessmentClock\(databaseTimeResult, assessment\.assessedAt\)/, "fresh assessment time must be checked against the D1 clock");
requireMatch("src/lib/revenue-engine/lead-assessment-d1.ts", leadAssessmentD1, /reloadResults[\s\S]*?Committed assessment row failed exact reload/, "assessment persistence must reload and verify committed rows");
requireMatch("src/lib/revenue-engine/lead-assessment-d1.ts", leadAssessmentD1, /export async function loadPrivateRevenueLeadAssessmentD1[\s\S]*?ASSESSMENT_TRIGGER_STATEMENT[\s\S]*?DATABASE_TIME_STATEMENT[\s\S]*?durableAssessmentReceiptStatement/, "durable assessment reload must verify writer guards, database time, and the exact receipt identity");
requireMatch("src/lib/revenue-engine/lead-assessment-d1.ts", leadAssessmentD1, /REQUIRED_ASSESSMENT_TRIGGER_MARKERS[\s\S]*?RevenueWebsiteSnapshot_assessment_immutable_update[\s\S]*?RevenueLeadAssessmentReceipt_immutable_delete/, "durable assessment reload must retain every migration-0061 immutable writer guard");
requireMatch("src/lib/revenue-engine/lead-assessment-d1.ts", leadAssessmentD1, /const trustedAssessmentDurableReloads = new WeakSet<object>\(\)[\s\S]*?requireTrustedRevenueLeadAssessmentD1DurableReload[\s\S]*?trustedAssessmentDurableReloads\.has\(value\)/, "durable assessment trust must require the exact module-created in-process object");
requireMatch("src/lib/revenue-engine/lead-assessment-d1.ts", leadAssessmentD1, /export async function loadPrivateRevenueLeadAssessmentD1[\s\S]*?buildRevenueLeadAssessment\([\s\S]*?revenueLeadAssessmentCanonicalJson\(rebuilt\)[\s\S]*?classifyPreflight/, "durable assessment reload must rebuild from the sealed source and exactly reload every assessment row");
requireMatch("src/lib/revenue-engine/lead-assessment-d1.ts", leadAssessmentD1, /read:complete_assessment_evidence_claims[\s\S]*?WHERE "businessId" = \? AND "websiteSnapshotId" = \?[\s\S]*?not one exact complete set/, "durable assessment reload must reject extra or omitted evidence rows in the snapshot scope");
requireMatch("src/lib/revenue-engine/lead-assessment-d1.ts", leadAssessmentD1, /freshnessState:\s*z\.enum\(\["NOT_YET_CURRENT",\s*"CURRENT",\s*"STALE"\]\)[\s\S]*?requireCurrentRevenueLeadAssessmentD1DurableReload/, "durable assessment freshness must be classified from the database clock and required separately for current use");
requireMatch("src/lib/revenue-engine/private-kw-assessment-progress-proof.ts", privateKwAssessmentProgressProof, /requireCurrentRevenueLeadAssessmentD1DurableReload\(input\.assessmentDurableReloadValue\)/, "assessment progress proof must require the exact current durable assessment reload");
requireMatch("src/lib/revenue-engine/private-kw-assessment-progress-proof.ts", privateKwAssessmentProgressProof, /PRIVATE_KW_ASSESSMENT_PROGRESS_PROOF_VERSION\s*=\s*\"kw-assessment-progress-proof-v2\"/, "assessment progress proof schema changes must use the explicit v2 reconstruction-clock contract");
requireMatch("src/lib/revenue-engine/private-kw-assessment-progress-proof.ts", privateKwAssessmentProgressProof, /execution\.databaseNow/, "assessment progress proof must retain the observed durable database clock");
forbidMatch("src/lib/revenue-engine/private-kw-assessment-progress-proof.ts", privateKwAssessmentProgressProof, /RevenueLeadAssessmentD1ExecutionSchema|assessmentExecutionValue|preparedAt:\s*string/, "assessment progress proof must not trust schema-valid execution JSON or a caller clock");
forbidMatch("src/engine/worker.ts", engineWorker, /loadPrivateRevenueLeadAssessmentD1|private-kw-assessment-progress-proof/, "the inert engine must not wire durable assessment reload or progress proof to runtime execution");
requireMatch("src/lib/revenue-engine/lead-assessment-d1.ts", leadAssessmentD1, /runtimeConnected:\s*z\.literal\(false\)/, "the private assessment executor must remain disconnected from runtime");
requireMatch("src/lib/revenue-engine/lead-assessment-d1.ts", leadAssessmentD1, /outreachAuthorized:\s*z\.literal\(false\)/, "the private assessment executor must not authorize outreach");
requireMatch("src/lib/revenue-engine/lead-assessment-d1.ts", leadAssessmentD1, /sendAuthorized:\s*z\.literal\(false\)/, "the private assessment executor must not authorize sending");
requireMatch("src/lib/revenue-engine/lead-assessment-d1.ts", leadAssessmentD1, /providerOperationsAuthorized:\s*z\.literal\(0\)/, "the private assessment executor must not authorize provider operations");
requireMatch("src/lib/revenue-engine/lead-assessment-d1.ts", leadAssessmentD1, /costAuthorizedUsd:\s*z\.literal\(0\)/, "the private assessment executor must keep provider cost authority at zero");
forbidMatch("src/lib/revenue-engine/lead-assessment-d1.ts", leadAssessmentD1, /LIMIT\s+1/i, "assessment collision preflights must inspect every matching primary or alternate identity");
forbidMatch("src/lib/revenue-engine/lead-assessment-d1.ts", leadAssessmentD1, /env\.[A-Z_]+|R2Bucket|fetch\s*\(|\.head\s*\(|\.put\s*\(|\.delete\s*\(/, "the private assessment executor must not access runtime bindings, providers, network, or deletion paths");
forbidMatch("src/engine/worker.ts", engineWorker, /lead-assessment(?:-d1)?/, "the inert engine must not wire shadow assessment persistence to runtime");
requireMatch("migrations/0061_shadow_lead_assessment_receipts.sql", leadAssessmentMigration, /CREATE TABLE "RevenueLeadAssessmentReceipt"/, "the assessment receipt table must remain additive");
for (const column of ["outreachAuthorized", "sendAuthorized", "providerOperationsAuthorized", "costAuthorizedUsd"]) {
  requireMatch("migrations/0061_shadow_lead_assessment_receipts.sql", leadAssessmentMigration, new RegExp(`CHECK \\(\"${column}\" = 0\\)`), `${column} must be database constrained to zero`);
}
for (const table of ["RevenueWebsiteSnapshot", "RevenueEvidenceClaim", "RevenueQualificationSnapshot"]) {
  requireMatch("migrations/0061_shadow_lead_assessment_receipts.sql", leadAssessmentMigration, new RegExp(`CREATE TRIGGER \"${table}_assessment_immutable_update\"`), `${table} must reject updates`);
  requireMatch("migrations/0061_shadow_lead_assessment_receipts.sql", leadAssessmentMigration, new RegExp(`CREATE TRIGGER \"${table}_assessment_immutable_delete\"`), `${table} must reject deletes`);
}
requireMatch("migrations/0061_shadow_lead_assessment_receipts.sql", leadAssessmentMigration, /CREATE TRIGGER "RevenueLeadAssessmentReceipt_immutable_update"/, "assessment receipts must reject updates");
requireMatch("migrations/0061_shadow_lead_assessment_receipts.sql", leadAssessmentMigration, /CREATE TRIGGER "RevenueLeadAssessmentReceipt_immutable_delete"/, "assessment receipts must reject deletes");
if ((leadAssessmentMigration.match(/CREATE TRIGGER/g) || []).length !== 8) failures.push("migrations/0061_shadow_lead_assessment_receipts.sql: exactly 8 append-only triggers are required");
requireMatch("migrations/0061_shadow_lead_assessment_receipts.sql", leadAssessmentMigration, /REVENUE_LEAD_ASSESSMENT_APPEND_ONLY/, "assessment revisions must fail with a stable append-only error");
forbidMatch("migrations/0061_shadow_lead_assessment_receipts.sql", leadAssessmentMigration, /\b(?:INSERT\s+INTO|UPDATE\s+\"[^\"]+\"\s+SET|DELETE\s+FROM)\b/i, "assessment migration must not mutate existing rows");
for (const table of ["RevenueContactDiscoveryReceipt", "RevenueContactEvidenceClaim", "RevenueContactEvidenceUse"]) {
  requireMatch("migrations/0062_append_only_contact_verification_records.sql", contactPersistenceMigration, new RegExp(`CREATE TABLE \\"${table}\\"`), `${table} must remain an additive contact persistence table`);
}
for (const column of ["runtimeConnected", "sourceContactPersistenceAuthorized", "sourceVerificationAuthorized", "outreachAuthorized", "sendAuthorized", "providerOperationsAuthorized", "costAuthorizedUsd"]) {
  requireMatch("migrations/0062_append_only_contact_verification_records.sql", contactPersistenceMigration, new RegExp(`CHECK \\(\\"${column}\\" = 0\\)`), `${column} must be database constrained to zero`);
}
for (const trigger of ["RevenueContactPoint_contract_insert", "RevenueContactEvidenceUse_contract_insert", "RevenueVerificationResult_contract_insert"]) {
  requireMatch("migrations/0062_append_only_contact_verification_records.sql", contactPersistenceMigration, new RegExp(`CREATE TRIGGER \\"${trigger}\\"`), `${trigger} must enforce the versioned contact contract`);
}
if ((contactPersistenceMigration.match(/CREATE TRIGGER/g) || []).length !== 13) failures.push("migrations/0062_append_only_contact_verification_records.sql: exactly 13 contact contract and append-only triggers are required");
requireMatch("migrations/0062_append_only_contact_verification_records.sql", contactPersistenceMigration, /REVENUE_CONTACT_APPEND_ONLY/, "contact records must fail updates and deletes with a stable error");
requireMatch("migrations/0062_append_only_contact_verification_records.sql", contactPersistenceMigration, /REVENUE_CONTACT_CONTRACT_REQUIRED/, "loose future contact inserts must fail closed");
requireMatch("migrations/0062_append_only_contact_verification_records.sql", contactPersistenceMigration, /REVENUE_CONTACT_VERIFICATION_MISMATCH/, "forged verification projections must fail closed");
forbidMatch("migrations/0062_append_only_contact_verification_records.sql", contactPersistenceMigration, /\b(?:INSERT\s+INTO|UPDATE\s+\"[^\"]+\"\s+SET|DELETE\s+FROM)\b/i, "contact persistence migration must not mutate existing rows");
for (const trigger of ["RevenueContactDiscoveryReceipt_lineage_insert", "RevenueContactPoint_lineage_insert", "RevenueContactEvidenceUse_lineage_insert", "RevenueVerificationResult_payload_insert"]) {
  requireMatch("migrations/0063_harden_contact_record_lineage.sql", contactLineageMigration, new RegExp(`CREATE TRIGGER \\"${trigger}\\"`), `${trigger} must close direct-SQL lineage drift`);
}
if ((contactLineageMigration.match(/CREATE TRIGGER/g) || []).length !== 4) failures.push("migrations/0063_harden_contact_record_lineage.sql: exactly 4 additional lineage triggers are required");
for (const error of ["REVENUE_CONTACT_RECEIPT_MISMATCH", "REVENUE_CONTACT_LINEAGE_MISMATCH", "REVENUE_CONTACT_EVIDENCE_LINEAGE_MISMATCH", "REVENUE_CONTACT_VERIFICATION_PAYLOAD_MISMATCH"]) {
  requireMatch("migrations/0063_harden_contact_record_lineage.sql", contactLineageMigration, new RegExp(error), `${error} must remain a stable fail-closed lineage error`);
}
forbidMatch("migrations/0063_harden_contact_record_lineage.sql", contactLineageMigration, /\b(?:INSERT\s+INTO|UPDATE\s+\"[^\"]+\"\s+SET|DELETE\s+FROM|DROP\s+TRIGGER)\b/i, "contact lineage hardening must not mutate rows or remove existing guards");
requireMatch("migrations/0064_local_source_workflow_materializations.sql", privateKwMaterializationMigration, /CREATE TABLE "RevenuePrivateKwMaterializationReceipt"/, "the private KW materialization receipt table must remain additive");
for (const column of ["localAssessmentMutationAuthorized", "schemaMutationAuthorized", "captureAuthorized", "contactDiscoveryAuthorized", "contactVerificationAuthorized", "outreachAuthorized", "sendAuthorized", "providerOperationsAuthorized", "costAuthorizedUsd"]) {
  requireMatch("migrations/0064_local_source_workflow_materializations.sql", privateKwMaterializationMigration, new RegExp(`CHECK \\(\"${column}\" = 0\\)`), `${column} must be database constrained to zero`);
}
for (const column of ["localOnly", "localSourceMutationAuthorized", "localWorkflowMutationAuthorized"]) {
  requireMatch("migrations/0064_local_source_workflow_materializations.sql", privateKwMaterializationMigration, new RegExp(`CHECK \\(\"${column}\" = 1\\)`), `${column} must be database constrained to one`);
}
requireMatch("migrations/0064_local_source_workflow_materializations.sql", privateKwMaterializationMigration, /REVENUE_PRIVATE_KW_MATERIALIZATION_LINEAGE_MISMATCH/, "materialization receipts must require exact sealed workflow lineage");
requireMatch("migrations/0064_local_source_workflow_materializations.sql", privateKwMaterializationMigration, /REVENUE_PRIVATE_KW_MATERIALIZATION_APPEND_ONLY/, "materialization receipts must reject update and delete");
if ((privateKwMaterializationMigration.match(/CREATE TRIGGER/g) || []).length !== 3) failures.push("migrations/0064_local_source_workflow_materializations.sql: exactly 3 lineage and append-only triggers are required");
forbidMatch("migrations/0064_local_source_workflow_materializations.sql", privateKwMaterializationMigration, /\b(?:INSERT\s+INTO|UPDATE\s+\"[^\"]+\"\s+SET|DELETE\s+FROM|DROP\s+TRIGGER)\b/i, "the materialization migration must not mutate existing rows or remove guards");
requireMatch("migrations/0065_local_contact_persistence_receipts.sql", privateKwContactPersistenceMigration, /CREATE TABLE "RevenuePrivateKwContactPersistenceReceipt"/, "the local contact persistence receipt table must remain additive");
for (const column of ["sourceMutationAuthorized", "workflowMutationAuthorized", "assessmentMutationAuthorized", "schemaMutationAuthorized", "captureAuthorized", "contactDiscoveryAuthorized", "contactVerificationAuthorized", "consentDecisionAuthorized", "qualificationAuthorized", "outreachAuthorized", "sendAuthorized", "providerOperationsAuthorized", "costAuthorizedUsd", "consentRows"]) {
  requireMatch("migrations/0065_local_contact_persistence_receipts.sql", privateKwContactPersistenceMigration, new RegExp(`CHECK \\(\"${column}\" = 0\\)`), `${column} must be database constrained to zero`);
}
for (const column of ["localOnly", "localDatabaseAccessAuthorized", "localContactMutationAuthorized", "localVerificationMutationAuthorized"]) {
  requireMatch("migrations/0065_local_contact_persistence_receipts.sql", privateKwContactPersistenceMigration, new RegExp(`CHECK \\(\"${column}\" = 1\\)`), `${column} must be database constrained to one`);
}
requireMatch("migrations/0065_local_contact_persistence_receipts.sql", privateKwContactPersistenceMigration, /REVENUE_PRIVATE_KW_CONTACT_PERSISTENCE_LINEAGE_MISMATCH/, "contact materialization receipts must require the exact complete bundle");
requireMatch("migrations/0065_local_contact_persistence_receipts.sql", privateKwContactPersistenceMigration, /REVENUE_PRIVATE_KW_CONTACT_PERSISTENCE_APPEND_ONLY/, "contact materialization receipts must reject update and delete");
if ((privateKwContactPersistenceMigration.match(/CREATE TRIGGER/g) || []).length !== 3) failures.push("migrations/0065_local_contact_persistence_receipts.sql: exactly 3 lineage and append-only triggers are required");
forbidMatch("migrations/0065_local_contact_persistence_receipts.sql", privateKwContactPersistenceMigration, /\b(?:INSERT\s+INTO|UPDATE\s+\"[^\"]+\"\s+SET|DELETE\s+FROM|DROP\s+TRIGGER)\b/i, "the contact materialization migration must not mutate existing rows or remove guards");
requireMatch("migrations/0066_harden_local_contact_persistence_receipts.sql", privateKwContactPersistenceHardeningMigration, /CREATE TRIGGER "RevenuePrivateKwContactPersistenceReceipt_identity_insert"/, "the hardened local contact receipt must add its identity/set guard");
requireMatch("migrations/0066_harden_local_contact_persistence_receipts.sql", privateKwContactPersistenceHardeningMigration, /REVENUE_PRIVATE_KW_CONTACT_PERSISTENCE_IDENTITY_MISMATCH/, "contact receipt identity and verification-set drift must fail closed");
if ((privateKwContactPersistenceHardeningMigration.match(/CREATE TRIGGER/g) || []).length !== 1) failures.push("migrations/0066_harden_local_contact_persistence_receipts.sql: exactly 1 identity/set hardening trigger is required");
forbidMatch("migrations/0066_harden_local_contact_persistence_receipts.sql", privateKwContactPersistenceHardeningMigration, /\b(?:INSERT\s+INTO|UPDATE\s+\"[^\"]+\"\s+SET|DELETE\s+FROM|DROP\s+TRIGGER)\b/i, "the contact receipt hardening migration must not mutate rows or remove guards");
requireMatch("migrations/0067_local_contact_invocation_receipts.sql", privateKwContactInvocationMigration, /CREATE TABLE "RevenuePrivateKwContactInvocationReceipt"/, "the reviewed contact invocation receipt table must remain additive");
for (const column of ["sourceMutationAuthorized", "workflowMutationAuthorized", "assessmentMutationAuthorized", "schemaMutationAuthorized", "captureAuthorized", "contactDiscoveryExecutionAuthorized", "contactVerificationExecutionAuthorized", "consentDecisionAuthorized", "qualificationAuthorized", "outreachAuthorized", "sendAuthorized", "providerOperationsAuthorized", "costAuthorizedUsd"]) {
  requireMatch("migrations/0067_local_contact_invocation_receipts.sql", privateKwContactInvocationMigration, new RegExp(`CHECK \\(\"${column}\" = 0\\)`), `${column} must be database constrained to zero`);
}
for (const column of ["localOnly", "localContactMutationAuthorized", "localVerificationMutationAuthorized", "localInvocationReceiptAuthorized"]) {
  requireMatch("migrations/0067_local_contact_invocation_receipts.sql", privateKwContactInvocationMigration, new RegExp(`CHECK \\(\"${column}\" = 1\\)`), `${column} must be database constrained to one`);
}
requireMatch("migrations/0067_local_contact_invocation_receipts.sql", privateKwContactInvocationMigration, /FOREIGN KEY \("assessmentReceiptId"\) REFERENCES "RevenueLeadAssessmentReceipt"/, "contact invocation must bind the exact persisted assessment receipt");
requireMatch("migrations/0067_local_contact_invocation_receipts.sql", privateKwContactInvocationMigration, /FOREIGN KEY \("materializationReceiptId"\) REFERENCES "RevenuePrivateKwContactPersistenceReceipt"/, "contact invocation must bind the exact contact materialization receipt");
requireMatch("migrations/0067_local_contact_invocation_receipts.sql", privateKwContactInvocationMigration, /CHECK \("reviewId" = 'kw-contact-review:' \|\| "reviewDigest"\)/, "contact invocation review identity must bind its exact review digest");
requireMatch("migrations/0067_local_contact_invocation_receipts.sql", privateKwContactInvocationMigration, /json_extract\(NEW\."invocationJson", '\$\.review\.reviewId'\)/, "the stored invocation must retain and bind the complete review packet");
for (const column of ["localContactMutationAuthorized", "localVerificationMutationAuthorized", "localInvocationReceiptAuthorized"]) {
  requireMatch("migrations/0067_local_contact_invocation_receipts.sql", privateKwContactInvocationMigration, new RegExp(`json_extract\\(NEW\\.\"invocationJson\", '\\$\\.authority\\.${column}'\\) IS NOT 1`), `${column} must reject a missing or false invocation JSON authority`);
}
for (const column of ["sourceMutationAuthorized", "workflowMutationAuthorized", "assessmentMutationAuthorized", "schemaMutationAuthorized", "captureAuthorized", "contactDiscoveryExecutionAuthorized", "contactVerificationExecutionAuthorized", "consentDecisionAuthorized", "qualificationAuthorized", "outreachAuthorized", "sendAuthorized", "providerOperationsAuthorized", "costAuthorizedUsd"]) {
  requireMatch("migrations/0067_local_contact_invocation_receipts.sql", privateKwContactInvocationMigration, new RegExp(`json_extract\\(NEW\\.\"invocationJson\", '\\$\\.authority\\.${column}'\\) IS NOT 0`), `${column} must reject a missing or nonzero invocation JSON authority`);
}
requireMatch("migrations/0067_local_contact_invocation_receipts.sql", privateKwContactInvocationMigration, /REVENUE_PRIVATE_KW_CONTACT_INVOCATION_LINEAGE_MISMATCH/, "contact invocation receipts must enforce exact source, assessment, review, and contact lineage");
requireMatch("migrations/0067_local_contact_invocation_receipts.sql", privateKwContactInvocationMigration, /REVENUE_PRIVATE_KW_CONTACT_INVOCATION_APPEND_ONLY/, "contact invocation receipts must reject update and delete");
if ((privateKwContactInvocationMigration.match(/CREATE TRIGGER/g) || []).length !== 3) failures.push("migrations/0067_local_contact_invocation_receipts.sql: exactly 3 lineage and append-only triggers are required");
forbidMatch("migrations/0067_local_contact_invocation_receipts.sql", privateKwContactInvocationMigration, /\b(?:INSERT\s+INTO|UPDATE\s+\"[^\"]+\"\s+SET|DELETE\s+FROM|DROP\s+TRIGGER)\b/i, "the contact invocation migration must not mutate existing rows or remove guards");
requireMatch("migrations/0068_current_website_evidence_eligibility_receipts.sql", privateKwWebsiteEvidenceEligibilityMigration, /CREATE TABLE "RevenueCurrentWebsiteEvidenceEligibilityReceipt"/, "the durable website evidence eligibility table must remain additive");
for (const column of ["phaseInputCreationAuthorized", "progressReceiptCreationAuthorized", "phaseAdvancementAuthorized", "browserCaptureAuthorized", "artifactStorageAuthorized", "r2ReadAuthorized", "contactDiscoveryAuthorized", "qualificationAuthorized", "outreachAuthorized", "sendAuthorized", "deploymentAuthorized", "providerOperationsAuthorized", "costAuthorizedUsd"]) {
  requireMatch("migrations/0068_current_website_evidence_eligibility_receipts.sql", privateKwWebsiteEvidenceEligibilityMigration, new RegExp(`CHECK \\(\"${column}\" = 0\\)`), `${column} must be database constrained to zero`);
}
requireMatch("migrations/0068_current_website_evidence_eligibility_receipts.sql", privateKwWebsiteEvidenceEligibilityMigration, /REVENUE_WEBSITE_EVIDENCE_ELIGIBILITY_LINEAGE_MISMATCH/, "durable eligibility inserts must prove exact workflow, manifest, completeness, and R2 HEAD lineage");
requireMatch("migrations/0068_current_website_evidence_eligibility_receipts.sql", privateKwWebsiteEvidenceEligibilityMigration, /REVENUE_WEBSITE_EVIDENCE_ELIGIBILITY_APPEND_ONLY/, "durable eligibility receipts must reject update and delete");
if ((privateKwWebsiteEvidenceEligibilityMigration.match(/CREATE TRIGGER/g) || []).length !== 3) failures.push("migrations/0068_current_website_evidence_eligibility_receipts.sql: exactly 3 lineage and append-only triggers are required");
forbidMatch("migrations/0068_current_website_evidence_eligibility_receipts.sql", privateKwWebsiteEvidenceEligibilityMigration, /\b(?:UPDATE\s+\"[^\"]+\"\s+SET|DELETE\s+FROM|DROP\s+TRIGGER)\b/i, "the eligibility migration must not mutate existing rows or remove guards");
requireMatch("src/lib/revenue-engine/private-kw-current-website-evidence-eligibility-d1.ts", privateKwWebsiteEvidenceEligibilityD1, /requireInProcessPrivateKwCurrentWebsiteEvidenceEligibilityReceipt\(receiptValue\)/, "fresh eligibility persistence must require the exact in-process trust result");
requireMatch("src/lib/revenue-engine/private-kw-current-website-evidence-eligibility-d1.ts", privateKwWebsiteEvidenceEligibilityD1, /read:eligibility_writer_guards/, "durable eligibility must verify the migration writer guards inside every batch");
requireMatch("src/lib/revenue-engine/private-kw-current-website-evidence-eligibility-d1.ts", privateKwWebsiteEvidenceEligibilityD1, /ELIGIBILITY_WRITER_GUARD_PREDICATE/, "fresh eligibility insertion must remain SQL-gated on every exact migration writer guard");
requireMatch("src/lib/revenue-engine/private-kw-current-website-evidence-eligibility-d1.ts", privateKwWebsiteEvidenceEligibilityD1, /instr\("sql", \?\) > 0/, "fresh eligibility insertion must verify each stable writer-guard marker before mutation");
requireMatch("src/lib/revenue-engine/private-kw-current-website-evidence-eligibility-d1.ts", privateKwWebsiteEvidenceEligibilityD1, /REVENUE_WEBSITE_EVIDENCE_ELIGIBILITY_LINEAGE_MISMATCH/, "durable eligibility must require the exact lineage trigger marker");
requireMatch("src/lib/revenue-engine/private-kw-current-website-evidence-eligibility-d1.ts", privateKwWebsiteEvidenceEligibilityD1, /REVENUE_WEBSITE_EVIDENCE_ELIGIBILITY_APPEND_ONLY/, "durable eligibility must require the append-only trigger markers");
requireMatch("src/lib/revenue-engine/private-kw-current-website-evidence-eligibility-d1.ts", privateKwWebsiteEvidenceEligibilityD1, /freshnessState:\s*z\.enum\(\["NOT_YET_CURRENT", "CURRENT", "STALE"\]\)/, "durable eligibility reloads must distinguish current from historical evidence");
requireMatch("src/lib/revenue-engine/private-kw-current-website-evidence-eligibility-d1.ts", privateKwWebsiteEvidenceEligibilityD1, /phaseInputCreationAuthorized:\s*z\.literal\(false\)/, "durable eligibility must not create a phase input");
requireMatch("src/lib/revenue-engine/private-kw-current-website-evidence-eligibility-d1.ts", privateKwWebsiteEvidenceEligibilityD1, /phaseAdvancementAuthorized:\s*z\.literal\(false\)/, "durable eligibility must not advance progress");
requireMatch("src/lib/revenue-engine/private-kw-current-website-evidence-eligibility-d1.ts", privateKwWebsiteEvidenceEligibilityD1, /providerOperationsAuthorized:\s*z\.literal\(0\)/, "durable eligibility must not authorize provider work");
forbidMatch("src/lib/revenue-engine/private-kw-current-website-evidence-eligibility-d1.ts", privateKwWebsiteEvidenceEligibilityD1, /@cloudflare|env\.[A-Z_]+|R2Bucket|fetch\s*\(|\.head\s*\(|\.put\s*\(|\.delete\s*\(/, "durable eligibility must stay disconnected from runtime bindings and providers");
forbidMatch("src/engine/worker.ts", engineWorker, /private-kw-current-website-evidence-eligibility-d1/, "the inert engine must not connect durable eligibility persistence");
requireMatch("src/lib/revenue-engine/private-kw-current-website-evidence-progress.ts", privateKwWebsiteEvidenceProgress, /requireCurrentPrivateKwWebsiteEvidenceEligibilityD1Result\(\s*input\.currentEligibilityResultValue,?\s*\)/, "website evidence progress input must require the exact current trusted D1 eligibility result");
requireMatch("src/lib/revenue-engine/private-kw-current-website-evidence-progress.ts", privateKwWebsiteEvidenceProgress, /eligibility\.executionPath !== "DURABLE_RELOAD"/, "website evidence progress input must accept durable reloads only");
requireMatch("src/lib/revenue-engine/private-kw-current-website-evidence-progress.ts", privateKwWebsiteEvidenceProgress, /const trustedProgressInputs = new WeakSet<object>\(\)/, "website evidence phase inputs must retain module-private in-process trust");
requireMatch("src/lib/revenue-engine/private-kw-current-website-evidence-progress.ts", privateKwWebsiteEvidenceProgress, /trustedProgressInputs\.has\(value\)/, "website evidence phase input consumers must reject copied JSON");
requireMatch("src/lib/revenue-engine/private-kw-current-website-evidence-progress.ts", privateKwWebsiteEvidenceProgress, /trustedProgressInputContexts\.set\(trusted,\s*\{/, "website evidence phase inputs must bind their exact derivation context privately");
requireMatch("src/lib/revenue-engine/private-kw-current-website-evidence-progress.ts", privateKwWebsiteEvidenceProgress, /parentCheckpointId !== previousProgress\.checkpointId/, "website evidence phase inputs must reject a changed parent checkpoint");
requireMatch("src/lib/revenue-engine/private-kw-current-website-evidence-progress.ts", privateKwWebsiteEvidenceProgress, /authority:\s*privateKwShadowSliceProgressAuthority\(\)/, "website evidence phase input must preserve the zero-authority progress contract");
forbidMatch("src/lib/revenue-engine/private-kw-current-website-evidence-progress.ts", privateKwWebsiteEvidenceProgress, /appendPrivateKwShadowSliceProgress|buildPrivateKwShadowSlicePhaseReceipt/, "the validation-only website evidence adapter must not create progress receipts or checkpoints");
forbidMatch("src/lib/revenue-engine/private-kw-current-website-evidence-progress.ts", privateKwWebsiteEvidenceProgress, /@cloudflare|env\.[A-Z_]+|D1Database|R2Bucket|fetch\s*\(|\.head\s*\(|\.prepare\s*\(|\.batch\s*\(|\.run\s*\(|\.put\s*\(|\.delete\s*\(/, "website evidence phase input derivation must stay disconnected from runtime bindings, databases, providers, and mutations");
forbidMatch("src/engine/worker.ts", engineWorker, /private-kw-current-website-evidence-progress/, "the inert engine must not connect website evidence progress input derivation");
requireMatch("src/lib/revenue-engine/private-kw-current-website-evidence-progress-append.ts", privateKwWebsiteEvidenceProgressAppend, /requireInProcessPrivateKwCurrentWebsiteEvidenceProgressInputForParent\(/, "guarded website evidence append must require the exact parent-bound in-process input");
requireMatch("src/lib/revenue-engine/private-kw-current-website-evidence-progress-append.ts", privateKwWebsiteEvidenceProgressAppend, /appendPrivateKwShadowSliceProgress\(/, "guarded website evidence append must use the canonical progress appender");
requireMatch("src/lib/revenue-engine/private-kw-current-website-evidence-progress-append.ts", privateKwWebsiteEvidenceProgressAppend, /const appendedCheckpointsByInput = new WeakMap<object,/, "guarded website evidence append must cache exact in-process retries");
requireMatch("src/lib/revenue-engine/private-kw-current-website-evidence-progress-append.ts", privateKwWebsiteEvidenceProgressAppend, /return cached\.checkpoint;/, "guarded website evidence append must return the same checkpoint on an exact retry");
requireMatch("src/lib/revenue-engine/private-kw-current-website-evidence-progress-append.ts", privateKwWebsiteEvidenceProgressAppend, /const trusted = deepFreeze\(nextProgress\)/, "guarded website evidence append must freeze its result before granting in-process trust");
forbidMatch("src/lib/revenue-engine/private-kw-current-website-evidence-progress-append.ts", privateKwWebsiteEvidenceProgressAppend, /@cloudflare|env\.[A-Z_]+|D1Database|R2Bucket|node:fs|readFile|writeFile|fetch\s*\(|\.head\s*\(|\.prepare\s*\(|\.batch\s*\(|\.run\s*\(|\.put\s*\(|\.delete\s*\(/, "guarded website evidence append must stay disconnected from files, runtime bindings, databases, providers, and mutations");
forbidMatch("scripts/record-private-kw-shadow-progress.ts", privateKwShadowSliceProgressCli, /private-kw-current-website-evidence-progress-append/, "the generic operator recorder must not import the in-process website evidence append boundary");
forbidMatch("src/engine/worker.ts", engineWorker, /private-kw-current-website-evidence-progress-append/, "the inert engine must not connect guarded website evidence progress append");
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
requireMatch("src/app/leads/page.tsx", ownerLeadsPage, /await requireSession\(\)/, "owner Leads page must require an authenticated session before reading data");
requireMatch("src/app/leads/page.tsx", ownerLeadsPage, /readOwnerLeadList\(getDatabase\(\)/, "owner Leads page must use the versioned bounded read model directly");
forbidMatch("src/app/leads/page.tsx", ownerLeadsPage, /fetch\s*\(|export async function (?:POST|PUT|PATCH|DELETE)|\.run\s*\(/, "owner Leads page must not self-fetch, mutate, or expose write methods");
requireMatch("src/components/leads/owner-lead-list.tsx", ownerLeadList, /Read-only shadow view/, "owner Leads UI must state that it is a read-only shadow view");
requireMatch("src/components/leads/owner-lead-list.tsx", ownerLeadList, /No email, call, form, or social action can start here/, "owner Leads UI must state that no channel action can start from the list");
forbidMatch("src/components/leads/owner-lead-list.tsx", ownerLeadList, /fetch\s*\(|onClick\s*=|<button|<form|mailto:|tel:/, "owner Leads list must not add client actions, provider calls, or direct contact links");
requireMatch("src/lib/revenue-engine/owner-lead-detail-read-model.ts", ownerLeadDetailReadModel, /OWNER_LEAD_DETAIL_QUERY\s*=\s*`\s*SELECT/, "owner lead detail D1 access must begin from an explicit exact SELECT contract");
requireMatch("src/lib/revenue-engine/owner-lead-detail-read-model.ts", ownerLeadDetailReadModel, /OWNER_LEAD_CONTACT_REVIEW_QUERY\s*=\s*`\s*SELECT/, "owner contact-review visibility must use an explicit read-only SELECT contract");
requireMatch("src/lib/revenue-engine/owner-lead-detail-read-model.ts", ownerLeadDetailReadModel, /PrivateKwContactInvocationSchema\.parse/, "owner contact-review visibility must validate the complete content-derived invocation receipt");
requireMatch("src/lib/revenue-engine/owner-lead-detail-read-model.ts", ownerLeadDetailReadModel, /consentBasis:\s*z\.literal\("UNASSESSED"\)/, "owner contact review must keep consent explicitly unassessed");
requireMatch("src/lib/revenue-engine/owner-lead-detail-read-model.ts", ownerLeadDetailReadModel, /V2_SHADOW_ONLY/, "owner lead history must disclose its v2-only scope");
requireMatch("src/lib/revenue-engine/owner-lead-detail-read-model.ts", ownerLeadDetailReadModel, /sendAuthorized:\s*z\.literal\(false\)/, "owner lead detail responses must not authorize sending");
forbidMatch("src/lib/revenue-engine/owner-lead-detail-read-model.ts", ownerLeadDetailReadModel, /@cloudflare|env\.[A-Z_]+|R2Bucket|fetch\s*\(|\.run\s*\(|\.put\s*\(|\.delete\s*\(/, "owner lead detail reader must not access providers, runtime bindings, or mutation methods");
requireMatch("src/app/api/v1/leads/[businessId]/route.ts", ownerLeadDetailRoute, /requireApiSession\(request\)/, "owner lead detail API must require an authenticated session");
requireMatch("src/app/api/v1/leads/[businessId]/route.ts", ownerLeadDetailRoute, /export async function GET\(/, "owner lead detail API must remain read-only GET");
requireMatch("src/app/api/v1/leads/[businessId]/route.ts", ownerLeadDetailRoute, /private, no-store/, "owner lead detail API responses must not be cached publicly");
forbidMatch("src/app/api/v1/leads/[businessId]/route.ts", ownerLeadDetailRoute, /export async function (?:POST|PUT|PATCH|DELETE)|\.run\s*\(|fetch\s*\(/, "owner lead detail API must not expose mutations or provider requests");
requireMatch("src/app/leads/[businessId]/page.tsx", ownerLeadDetailPage, /await requireSession\(\)/, "owner lead detail page must require an authenticated session before reading data");
requireMatch("src/app/leads/[businessId]/page.tsx", ownerLeadDetailPage, /readOwnerLeadDetail\(getDatabase\(\)/, "owner lead detail page must use the exact versioned read model directly");
forbidMatch("src/app/leads/[businessId]/page.tsx", ownerLeadDetailPage, /fetch\s*\(|export async function (?:POST|PUT|PATCH|DELETE)|\.run\s*\(/, "owner lead detail page must not self-fetch, mutate, or expose write methods");
requireMatch("src/components/leads/owner-lead-detail.tsx", ownerLeadDetail, /This dossier is read-only/, "owner lead detail UI must state its read-only authority");
requireMatch("src/components/leads/owner-lead-detail.tsx", ownerLeadDetail, /Preview unavailable until private evidence storage is enabled/, "owner lead detail UI must not pretend opaque artifact references are viewable screenshots");
requireMatch("src/components/leads/owner-lead-detail.tsx", ownerLeadDetail, /Missing sales history is labelled instead of guessed/, "owner lead detail UI must explain unavailable v2 sales history");
forbidMatch("src/components/leads/owner-lead-detail.tsx", ownerLeadDetail, /fetch\s*\(|onClick\s*=|<button|<form|mailto:|tel:/, "owner lead detail must not add client actions, provider calls, or direct contact links");
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

requireMatch("src/lib/revenue-engine/private-kw-m2-html-evidence-workflow.ts", privateKwM2HtmlWorkflow, /PRIVATE_KW_M2_HTML_EVIDENCE_WORKFLOW_VERSION\s*=\s*[\"']kw-m2-html-evidence-workflow-v1/, "Task4 must expose its versioned HTML-only workflow contract");
requireMatch("src/lib/revenue-engine/private-kw-m2-html-evidence-workflow.ts", privateKwM2HtmlWorkflow, /assertPrivateKwM2ApprovalChain/, "Task4 must revalidate the canonical Task1 approval chain before requests");
requireMatch("src/lib/revenue-engine/private-kw-m2-html-evidence-workflow.ts", privateKwM2HtmlWorkflow, /createPrivateKwPublicHttpTransport/, "Task4 must use the address-pinned public transport adapter");
requireMatch("src/lib/revenue-engine/private-kw-m2-html-evidence-workflow.ts", privateKwM2HtmlWorkflow, /networkRequestCap/, "Task4 must enforce the approved shared request cap");
requireMatch("src/lib/revenue-engine/private-kw-m2-html-evidence-workflow.ts", privateKwM2HtmlWorkflow, /writePrivateKwHtmlEvidence|writePrivateKwDerivedFacts/, "Task4 must route retention through the canonical local evidence store");
requireMatch("src/lib/revenue-engine/private-kw-m2-html-evidence-workflow.ts", privateKwM2HtmlWorkflow, /transportReceipts:\s*z\.array\(PrivateKwPublicHttpTransportReceiptSchema\)/, "Task4 receipt must persist the complete transport receipt chain");
requireMatch("src/lib/revenue-engine/private-kw-m2-html-evidence-workflow.ts", privateKwM2HtmlWorkflow, /validateSealedReplay/, "Task4 replay must reload and validate the complete sealed receipt before returning");
forbidMatch("src/lib/revenue-engine/private-kw-m2-html-evidence-workflow.ts", privateKwM2HtmlWorkflow, /rootPath/, "Task4 workflow must not expose a caller-controlled sealed-receipt root");
requireMatch("src/lib/revenue-engine/private-kw-m2-html-evidence-workflow.ts", privateKwM2HtmlWorkflow, /providerOperations:\s*0|costAuthorizedUsd:\s*0/, "Task4 receipt must report zero provider and cost authority");
forbidMatch("src/lib/revenue-engine/private-kw-m2-html-evidence-workflow.ts", privateKwM2HtmlWorkflow, /globalThis\.fetch|@cloudflare|D1Database|R2Bucket|better-sqlite3|website-audit-assembly|process\.env|\.prepare\s*\(|\.run\s*\(/i, "Task4 workflow must stay disconnected from providers, databases, runtime fetch, and generic audit assembly");
requireMatch("src/lib/revenue-engine/private-kw-m2-html-audit.ts", privateKwM2HtmlAudit, /assemblerKind:\s*z\.literal\("HTML_ONLY"\)/, "Task4 audit must carry an explicit HTML-only assembler identity");
requireMatch("src/lib/revenue-engine/private-kw-m2-html-audit.ts", privateKwM2HtmlAudit, /conversionCritical:\s*z\.literal\(false\)/, "Task4 availability proof must never be conversion-critical");
requireMatch("src/lib/revenue-engine/private-kw-m2-html-audit.ts", privateKwM2HtmlAudit, /visibleText:\s*""|visibleText:\s*''/, "Task4 audit snapshots must not persist page text");
forbidMatch("src/lib/revenue-engine/private-kw-m2-html-audit.ts", privateKwM2HtmlAudit, /classification\s*:\s*z\.enum|rebuildNeedScore\s*:\s*z\.(number|string)|evidenceConfidence\s*:\s*z\.(number|string)/, "Task4 HTML-only audit must not expose ordinary classification or score authority");
requireMatch("src/lib/revenue-engine/private-kw-m2-html-evidence-receipt.ts", privateKwM2HtmlReceipt, /open\(file,\s*[\"']wx[\"']\)/, "Task4 sealed receipt publication must be exclusive and no-overwrite");
requireMatch("src/lib/revenue-engine/private-kw-m2-html-evidence-receipt.ts", privateKwM2HtmlReceipt, /PRIVATE_KW_EVIDENCE_ROOT/, "Task4 sealed receipts must use the approved ignored evidence root");
requireMatch("src/lib/revenue-engine/private-kw-m2-html-evidence-receipt.ts", privateKwM2HtmlReceipt, /UUID/, "Task4 sealed receipt paths must validate canonical operation IDs");
requireMatch("src/lib/revenue-engine/private-kw-m2-html-evidence-receipt.ts", privateKwM2HtmlReceipt, /SEALED_RECEIPT_DIGEST_MISMATCH/, "Task4 sealed receipt loader must verify the canonical operation digest");
forbidMatch("src/lib/revenue-engine/private-kw-m2-html-evidence-receipt.ts", privateKwM2HtmlReceipt, /fetch\s*\(|@cloudflare|D1Database|R2Bucket|\.rename\s*\(/i, "Task4 sealed receipts must remain local and provider-free");

if (failures.length > 0) {
  console.error("Safety configuration check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Safety configuration check passed: autonomous work defaults off and production shortcuts are guarded.");
}
