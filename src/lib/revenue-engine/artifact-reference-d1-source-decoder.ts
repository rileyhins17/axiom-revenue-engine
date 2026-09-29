import { z } from "zod";

import {
  ArtifactEvidenceUseSchema,
  ArtifactManifestSchema,
  ArtifactPromotionPlanSchema,
  ArtifactPromotionReceiptSchema,
} from "@/lib/revenue-engine/artifact-lifecycle";
import {
  ArtifactManifestAvailabilityReceiptSchema,
  selectFreshR2ManifestAvailability,
} from "@/lib/revenue-engine/artifact-manifest-availability";
import {
  ARTIFACT_REFERENCE_SOURCE_SET_ORDER,
  ArtifactReferenceAtomicObservationSchema,
  ArtifactReferenceAtomicPlanSchema,
  ArtifactReferenceUntrustedSourceProofSchema,
  buildUntrustedArtifactReferenceSourceProof,
  type ArtifactReferenceSourceSetName,
} from "@/lib/revenue-engine/artifact-reference-atomic-snapshot";
import {
  ArtifactEvidenceUseEndRecordSchema,
  ArtifactManifestEvidenceUseLinkSchema,
  artifactReferenceCanonicalJson,
  artifactReferenceDigest,
} from "@/lib/revenue-engine/artifact-reference-projection";
import {
  decodeArtifactAvailabilityRow,
  decodeArtifactEvidenceUseEndRow,
  decodeArtifactEvidenceUseRow,
  decodeArtifactManifestItemRow,
  decodeArtifactManifestRow,
  decodeArtifactManifestUseRow,
  decodeArtifactPromotionRow,
  decodeArtifactPromotionUseRow,
  decodeWorkflowAttemptClosureRow,
  decodeWorkflowAttemptRow,
  decodeWorkflowDefinitionRow,
  decodeWorkflowDeliveryRow,
  decodeWorkflowLeaseRow,
  decodeWorkflowReceiptRevisionRow,
  decodeWorkflowRunRow,
} from "@/lib/revenue-engine/artifact-reference-d1-source-rows";
import {
  FixtureWebsiteEvidenceDefinitionDescriptorSchema,
  FixtureWebsiteEvidenceResumePlanSchema,
  FixtureWorkflowAttemptSnapshotSchema,
  FixtureWorkflowDeliveryRecordSchema,
  FixtureWorkflowLeaseClaimSchema,
  FixtureWorkflowReceiptRevisionSchema,
  buildFixtureWebsiteEvidenceResumePlan,
  currentFixtureWebsiteEvidenceDefinition,
} from "@/lib/revenue-engine/fixture-website-evidence-resume-plan";
import {
  FixtureWebsiteEvidenceWorkflowReceiptSchema,
  FixtureWebsiteEvidenceWorkflowRequestSchema,
} from "@/lib/revenue-engine/fixture-website-evidence-workflow";

export const ARTIFACT_REFERENCE_D1_SOURCE_DECODER_VERSION = "artifact-reference-d1-source-decoder-v1";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const PromotionBundleSchema = z.object({
  plan: ArtifactPromotionPlanSchema,
  receipt: ArtifactPromotionReceiptSchema,
}).strict();

const DecodedReferenceFactsSchema = z.object({
  workflowRun: z.object({
    workflowRunId: z.string().uuid(), businessId: z.string().trim().min(1), workflowKind: z.literal("WEBSITE_EVIDENCE"),
    workflowVersion: z.string().trim().min(1), requestDigest: Sha256Schema,
  }).strict(),
  manifests: z.array(ArtifactManifestSchema).min(1).max(100),
  promotions: z.array(PromotionBundleSchema).max(200),
  evidenceUses: z.array(ArtifactEvidenceUseSchema).max(1_000),
  manifestEvidenceUses: z.array(ArtifactManifestEvidenceUseLinkSchema).max(1_000),
  evidenceUseEnds: z.array(ArtifactEvidenceUseEndRecordSchema).max(1_000),
  availability: z.array(ArtifactManifestAvailabilityReceiptSchema).min(1).max(100),
}).strict();

const SourceCountsSchema = z.record(z.enum(ARTIFACT_REFERENCE_SOURCE_SET_ORDER), z.number().int().nonnegative().max(5_000));

export const ArtifactReferenceDecodedSnapshotSchema = z.object({
  decoderVersion: z.literal(ARTIFACT_REFERENCE_D1_SOURCE_DECODER_VERSION),
  planDigest: Sha256Schema,
  sourceBaseRowsDigest: Sha256Schema,
  snapshotCapturedAt: z.string().datetime({ offset: true }),
  workflowHistory: z.object({
    request: FixtureWebsiteEvidenceWorkflowRequestSchema,
    definition: FixtureWebsiteEvidenceDefinitionDescriptorSchema,
    deliveries: z.array(FixtureWorkflowDeliveryRecordSchema).min(1).max(100),
    attempts: z.array(FixtureWorkflowAttemptSnapshotSchema).min(1).max(100),
    leases: z.array(FixtureWorkflowLeaseClaimSchema).min(1).max(200),
    receiptRevisions: z.array(FixtureWorkflowReceiptRevisionSchema).min(1).max(100),
    terminalReceipt: FixtureWebsiteEvidenceWorkflowReceiptSchema,
    terminalResumePlan: FixtureWebsiteEvidenceResumePlanSchema,
  }).strict(),
  workflowForest: z.object({
    rootManifestIds: z.array(z.string().uuid()).min(1).max(100),
    manifestIds: z.array(z.string().uuid()).min(1).max(100),
    forestDigest: Sha256Schema,
  }).strict(),
  selectedLineage: z.object({
    rootManifestId: z.string().uuid(),
    manifestIds: z.array(z.string().uuid()).min(1).max(100),
    disconnectedRootManifestIds: z.array(z.string().uuid()).max(99),
    facts: DecodedReferenceFactsSchema,
    sourceFactsDigest: Sha256Schema,
  }).strict(),
  selectedAvailabilityFreshUntil: z.string().datetime({ offset: true }),
  sourceCounts: SourceCountsSchema,
  decodedFactsDigest: Sha256Schema,
  structurallyValid: z.literal(true),
  transactionallyTrusted: z.literal(false),
  snapshotComplete: z.literal(false),
  trustBlocker: z.literal("TRUSTED_D1_COMMIT_AND_RELOAD_EXECUTOR_NOT_IMPLEMENTED"),
  retentionConclusionAuthorized: z.literal(false),
  projectionPersistenceAuthorized: z.literal(false),
  releaseAuthorized: z.literal(false),
  deletionAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict().superRefine((snapshot, context) => {
  const { decodedFactsDigest: _digest, ...core } = snapshot;
  void _digest;
  if (snapshot.decodedFactsDigest !== artifactReferenceDigest(core)) {
    context.addIssue({ code: "custom", message: "Decoded snapshot digest must bind the complete validation-only result.", path: ["decodedFactsDigest"] });
  }
  if (snapshot.selectedLineage.sourceFactsDigest !== artifactReferenceDigest(snapshot.selectedLineage.facts)) {
    context.addIssue({ code: "custom", message: "Selected lineage digest must bind its exact decoded facts.", path: ["selectedLineage", "sourceFactsDigest"] });
  }
});

export type ArtifactReferenceDecodedSnapshot = z.infer<typeof ArtifactReferenceDecodedSnapshotSchema>;

function exact(value: unknown) {
  return artifactReferenceCanonicalJson(value);
}

function ensureUnique<T>(items: T[], identity: (item: T) => string, label: string) {
  const identities = items.map(identity);
  if (new Set(identities).size !== identities.length) throw new Error(`${label} contains an alternate-identity collision.`);
}

function ensureAtOrBefore(timestamp: string, boundary: string, label: string) {
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time) || time > Date.parse(boundary)) throw new Error(`${label} is later than the snapshot boundary.`);
}

function equalSets(actual: Iterable<string>, expected: Iterable<string>, label: string) {
  const left = [...new Set(actual)].sort((a, b) => a.localeCompare(b, "en-CA"));
  const right = [...new Set(expected)].sort((a, b) => a.localeCompare(b, "en-CA"));
  if (exact(left) !== exact(right)) throw new Error(`${label} is missing required rows or contains surplus rows.`);
}

function sourceRows(
  observation: z.infer<typeof ArtifactReferenceAtomicObservationSchema>,
  name: ArtifactReferenceSourceSetName,
) {
  const source = observation.sourceSets.find((set) => set.setName === name);
  if (!source) throw new Error(`Atomic observation is missing ${name}.`);
  return source.rows;
}

function descendants(rootId: string, children: Map<string, string[]>) {
  const visited = new Set<string>();
  const pending = [rootId];
  while (pending.length > 0) {
    const id = pending.shift();
    if (!id) continue;
    if (visited.has(id)) throw new Error(`Artifact lineage contains a cycle at manifest ${id}.`);
    visited.add(id);
    pending.push(...(children.get(id) ?? []));
  }
  return visited;
}

function replacementClosure(seedIds: Set<string>, endings: Map<string, z.infer<typeof ArtifactEvidenceUseEndRecordSchema>>) {
  const included = new Set(seedIds);
  const pending = [...seedIds];
  while (pending.length > 0) {
    const id = pending.shift();
    if (!id) continue;
    const replacement = endings.get(id)?.replacementEvidenceUseId;
    if (replacement && !included.has(replacement)) {
      included.add(replacement);
      pending.push(replacement);
    }
  }
  return included;
}

export function decodeArtifactReferenceD1SourceSnapshot(
  planValue: unknown,
  observationValue: unknown,
): ArtifactReferenceDecodedSnapshot {
  const plan = ArtifactReferenceAtomicPlanSchema.parse(planValue);
  const observation = ArtifactReferenceAtomicObservationSchema.parse(observationValue);
  const proof = ArtifactReferenceUntrustedSourceProofSchema.parse(
    buildUntrustedArtifactReferenceSourceProof(plan, observation),
  );
  const snapshotAt = observation.snapshotCapturedAt;

  const runs = sourceRows(observation, "WORKFLOW_RUNS").map(decodeWorkflowRunRow);
  if (runs.length !== 1) throw new Error("Atomic workflow scope requires one exact workflow run and no alternate idempotency collision.");
  const run = runs[0];
  if (
    run.row.id !== plan.attempt.workflowRunId || run.row.businessId !== plan.attempt.businessId
    || run.request.workflowId !== plan.attempt.workflowRunId || run.request.businessId !== plan.attempt.businessId
  ) throw new Error("Workflow run does not match the atomic snapshot scope.");
  ensureAtOrBefore(run.request.requestedAt, snapshotAt, "Workflow request");

  const definitions = sourceRows(observation, "WORKFLOW_DEFINITIONS").map(decodeWorkflowDefinitionRow);
  if (definitions.length !== 1) throw new Error("Atomic workflow history requires one exact current definition.");
  const definition = definitions[0].definition;
  if (exact(definition) !== exact(currentFixtureWebsiteEvidenceDefinition())) {
    throw new Error("Workflow definition is not the current fixture evidence definition.");
  }

  const deliveries = sourceRows(observation, "WORKFLOW_DELIVERIES").map(decodeWorkflowDeliveryRow)
    .sort((left, right) => left.delivery.deliveryId.localeCompare(right.delivery.deliveryId, "en-CA"));
  if (deliveries.length === 0) throw new Error("Atomic workflow history requires at least one delivery.");
  for (const { delivery } of deliveries) {
    if (
      delivery.workflowId !== run.request.workflowId || delivery.workflowVersion !== run.request.workflowVersion
      || delivery.definitionDigest !== definition.definitionDigest || delivery.requestDigest !== run.row.requestDigest
      || delivery.payloadDigest !== run.row.requestDigest
    ) throw new Error(`Workflow delivery ${delivery.deliveryId} is outside the exact workflow identity.`);
    ensureAtOrBefore(delivery.receivedAt, snapshotAt, `Workflow delivery ${delivery.deliveryId}`);
  }

  const attemptRows = sourceRows(observation, "WORKFLOW_ATTEMPTS").map(decodeWorkflowAttemptRow);
  const closureRows = sourceRows(observation, "WORKFLOW_ATTEMPT_CLOSURES").map(decodeWorkflowAttemptClosureRow);
  const closuresByAttempt = new Map(closureRows.map((item) => [item.closure.attemptId, item]));
  ensureUnique(closureRows, (item) => item.closure.attemptId, "Workflow attempt closures");
  const attempts = attemptRows.map(({ identity }) => {
    const closure = closuresByAttempt.get(identity.attemptId)?.closure;
    return FixtureWorkflowAttemptSnapshotSchema.parse({
      ...identity,
      status: closure?.status ?? "RUNNING",
      endedAt: closure?.endedAt ?? null,
      terminalReceiptId: closure?.terminalReceiptId ?? null,
    });
  }).sort((left, right) => left.attemptNumber - right.attemptNumber);
  if (attempts.length === 0) throw new Error("Atomic workflow history requires at least one durable attempt.");
  ensureUnique(attempts, (attempt) => String(attempt.attemptNumber), "Workflow attempt numbers");
  ensureUnique(attempts, (attempt) => String(attempt.fencingToken), "Workflow attempt fences");
  equalSets(closureRows.map((item) => item.closure.attemptId), attempts.filter((attempt) => attempt.status !== "RUNNING").map((attempt) => attempt.attemptId), "Workflow closure set");
  for (const [index, attempt] of attempts.entries()) {
    if (
      attempt.attemptNumber !== index + 1 || (index > 0 && attempt.fencingToken <= attempts[index - 1].fencingToken)
      || attempt.workflowId !== run.request.workflowId || attempt.workflowVersion !== run.request.workflowVersion
      || attempt.definitionDigest !== definition.definitionDigest || attempt.requestDigest !== run.row.requestDigest
      || !deliveries.some(({ delivery }) => delivery.deliveryId === attempt.deliveryId)
    ) throw new Error(`Workflow attempt ${attempt.attemptId} breaks the contiguous fenced history.`);
    ensureAtOrBefore(attempt.startedAt, snapshotAt, `Workflow attempt ${attempt.attemptId}`);
    if (attempt.endedAt) {
      ensureAtOrBefore(attempt.endedAt, snapshotAt, `Workflow attempt closure ${attempt.attemptId}`);
      if (Date.parse(attempt.endedAt) < Date.parse(attempt.startedAt)) throw new Error(`Workflow attempt ${attempt.attemptId} ends before it starts.`);
    }
  }

  const leases = sourceRows(observation, "WORKFLOW_LEASES").map(decodeWorkflowLeaseRow).map((item) => item.lease)
    .sort((left, right) => left.attemptNumber - right.attemptNumber || left.leaseId.localeCompare(right.leaseId, "en-CA"));
  ensureUnique(leases, (lease) => lease.attemptId, "Workflow leases by attempt");
  ensureUnique(leases, (lease) => String(lease.fencingToken), "Workflow lease fences");
  equalSets(leases.map((lease) => lease.attemptId), attempts.map((attempt) => attempt.attemptId), "Workflow lease set");
  for (const lease of leases) {
    const attempt = attempts.find((candidate) => candidate.attemptId === lease.attemptId);
    if (
      !attempt || lease.workflowId !== run.request.workflowId || lease.workflowVersion !== run.request.workflowVersion
      || lease.definitionDigest !== definition.definitionDigest || lease.requestDigest !== run.row.requestDigest
      || lease.attemptNumber !== attempt.attemptNumber || lease.deliveryId !== attempt.deliveryId
      || lease.fencingToken !== attempt.fencingToken || Date.parse(lease.acquiredAt) < Date.parse(attempt.startedAt)
    ) throw new Error(`Workflow lease ${lease.leaseId} is not the exact claim for its attempt.`);
    ensureAtOrBefore(lease.acquiredAt, snapshotAt, `Workflow lease ${lease.leaseId}`);
  }

  const revisions = sourceRows(observation, "WORKFLOW_RECEIPT_REVISIONS")
    .map(decodeWorkflowReceiptRevisionRow).map((item) => item.revision)
    .sort((left, right) => left.receiptId.localeCompare(right.receiptId, "en-CA"));
  ensureUnique(revisions, (revision) => revision.attemptId, "Workflow receipt revisions by attempt");
  ensureUnique(revisions, (revision) => revision.receiptDigest, "Workflow receipt revision digests");
  for (const revision of revisions) {
    const attempt = attempts.find((candidate) => candidate.attemptId === revision.attemptId);
    if (
      !attempt || revision.workflowId !== run.request.workflowId || revision.workflowVersion !== run.request.workflowVersion
      || revision.definitionDigest !== definition.definitionDigest || revision.requestDigest !== run.row.requestDigest
      || revision.attemptNumber !== attempt.attemptNumber
    ) throw new Error(`Workflow receipt revision ${revision.receiptId} is outside its attempt identity.`);
    ensureAtOrBefore(revision.recordedAt, snapshotAt, `Workflow receipt revision ${revision.receiptId}`);
  }

  const latestDelivery = [...deliveries].sort((left, right) => (
    Date.parse(right.delivery.receivedAt) - Date.parse(left.delivery.receivedAt)
    || right.delivery.deliveryId.localeCompare(left.delivery.deliveryId, "en-CA")
  ))[0]?.delivery;
  if (!latestDelivery) throw new Error("Atomic workflow history has no current delivery.");
  const terminalResumePlan = buildFixtureWebsiteEvidenceResumePlan({
    resumePlanVersion: "fixture-website-evidence-resume-plan-v1",
    plannedAt: snapshotAt,
    mode: "SHADOW",
    plannerKind: "FIXTURE",
    maxCostUsd: 0,
    workflowRequest: run.request,
    definition,
    currentDelivery: latestDelivery,
    persistedDeliveries: deliveries.map((item) => item.delivery),
    attempts,
    leases,
    receiptRevisions: revisions,
    checkpoints: [],
    artifactRecoveries: [],
  });
  if (terminalResumePlan.decision !== "RETURN_TERMINAL" || !terminalResumePlan.terminalReceiptId) {
    throw new Error(`Workflow history is not sealed to one terminal business result: ${terminalResumePlan.reasonCode}.`);
  }
  const terminalRevision = revisions.find((revision) => revision.receiptId === terminalResumePlan.terminalReceiptId);
  if (!terminalRevision) throw new Error("Sealed terminal workflow receipt is missing from decoded history.");
  const terminalReceipt = FixtureWebsiteEvidenceWorkflowReceiptSchema.parse(terminalRevision.receipt);
  const terminalAttempt = attempts.find((attempt) => attempt.attemptId === terminalRevision.attemptId);
  if (
    !terminalAttempt?.endedAt
    || terminalReceipt.requestedAt !== run.request.requestedAt
    || Date.parse(terminalReceipt.completedAt) < Date.parse(terminalAttempt.startedAt)
    || Date.parse(terminalReceipt.completedAt) > Date.parse(terminalAttempt.endedAt)
    || Date.parse(terminalRevision.recordedAt) < Date.parse(terminalReceipt.completedAt)
  ) throw new Error("Sealed terminal workflow receipt falls outside its exact request, attempt, closure, or recording boundary.");

  const manifestRows = sourceRows(observation, "MANIFESTS").map(decodeArtifactManifestRow);
  const manifests = manifestRows.map((item) => item.manifest).sort((left, right) => left.manifestId.localeCompare(right.manifestId, "en-CA"));
  if (manifests.length === 0 || manifests.some((manifest) => manifest.workflowId !== run.request.workflowId)) {
    throw new Error("Artifact manifest forest must be non-empty and belong to the exact workflow.");
  }
  ensureUnique(manifests, (manifest) => `${manifest.provenance.receiptType}:${manifest.provenance.receiptId}`, "Artifact manifest provenance");
  for (const manifest of manifests) ensureAtOrBefore(manifest.verifiedAt, snapshotAt, `Artifact manifest ${manifest.manifestId}`);
  const manifestsById = new Map(manifests.map((manifest) => [manifest.manifestId, manifest]));
  const root = manifestsById.get(plan.attempt.lineageRootManifestId);
  if (!root || root.provenance.receiptType !== "ARTIFACT_WRITE") {
    throw new Error("Requested lineage root must be an exact ARTIFACT_WRITE manifest in the workflow forest.");
  }

  const manifestItems = sourceRows(observation, "MANIFEST_ITEMS").map(decodeArtifactManifestItemRow);
  ensureUnique(manifestItems, (item) => `${item.row.manifestId}:${item.row.kind}`, "Artifact manifest-item pairs");
  for (const manifest of manifests) {
    const rows = manifestItems.filter((item) => item.row.manifestId === manifest.manifestId).map((item) => item.item)
      .sort((left, right) => left.kind.localeCompare(right.kind, "en-CA"));
    const expected = [...manifest.items].sort((left, right) => left.kind.localeCompare(right.kind, "en-CA"));
    if (exact(rows) !== exact(expected)) throw new Error(`Manifest ${manifest.manifestId} item rows do not exactly match its canonical manifest.`);
  }
  if (manifestItems.some((item) => !manifestsById.has(item.row.manifestId))) throw new Error("Manifest-item source rows include an unknown manifest.");

  const terminalWriteManifests = terminalReceipt.artifactManifests;
  const writeRoots = manifests.filter((manifest) => manifest.provenance.receiptType === "ARTIFACT_WRITE");
  equalSets(writeRoots.map((manifest) => manifest.manifestId), terminalWriteManifests.map((manifest) => manifest.manifestId), "Terminal workflow write-manifest set");
  for (const terminalManifest of terminalWriteManifests) {
    const persisted = manifestsById.get(terminalManifest.manifestId);
    if (!persisted || exact(persisted) !== exact(terminalManifest)) throw new Error(`Terminal manifest ${terminalManifest.manifestId} differs from its persisted row.`);
  }

  const promotions = sourceRows(observation, "PROMOTIONS").map(decodeArtifactPromotionRow)
    .sort((left, right) => left.plan.promotionId.localeCompare(right.plan.promotionId, "en-CA"));
  ensureUnique(promotions, (promotion) => promotion.plan.promotionId, "Artifact promotion identities");
  const children = new Map<string, string[]>();
  const promotedManifestIds = new Set<string>();
  for (const promotion of promotions) {
    const { plan: promotionPlan, receipt } = promotion;
    const source = manifestsById.get(promotionPlan.sourceManifest.manifestId);
    if (
      promotionPlan.workflowId !== run.request.workflowId || promotionPlan.businessId !== run.request.businessId
      || !source || exact(source) !== exact(promotionPlan.sourceManifest)
    ) throw new Error(`Promotion ${promotionPlan.promotionId} is outside the exact workflow forest.`);
    ensureAtOrBefore(receipt.completedAt, snapshotAt, `Artifact promotion ${promotionPlan.promotionId}`);
    if (receipt.outcome === "COMPLETED") {
      const result = manifestsById.get(receipt.resultManifest.manifestId);
      if (!result || exact(result) !== exact(receipt.resultManifest)) throw new Error(`Promotion ${promotionPlan.promotionId} result manifest is missing or drifted.`);
      if (result.manifestId !== source.manifestId) {
        if (result.provenance.receiptType !== "ARTIFACT_PROMOTION" || result.provenance.receiptId !== promotionPlan.promotionId) {
          throw new Error(`Promotion ${promotionPlan.promotionId} result lacks exact promotion provenance.`);
        }
        if (promotedManifestIds.has(result.manifestId)) throw new Error(`Promoted manifest ${result.manifestId} has more than one parent.`);
        promotedManifestIds.add(result.manifestId);
        children.set(source.manifestId, [...(children.get(source.manifestId) ?? []), result.manifestId]);
      }
    }
  }
  equalSets(
    manifests.filter((manifest) => manifest.provenance.receiptType === "ARTIFACT_PROMOTION").map((manifest) => manifest.manifestId),
    promotedManifestIds,
    "Promoted-manifest provenance set",
  );
  const rootManifestIds = writeRoots.map((manifest) => manifest.manifestId).sort((left, right) => left.localeCompare(right, "en-CA"));
  const fullReachable = new Set<string>();
  for (const rootId of rootManifestIds) for (const id of descendants(rootId, children)) fullReachable.add(id);
  equalSets(fullReachable, manifestsById.keys(), "Workflow artifact forest");
  const selectedManifestIds = descendants(root.manifestId, children);

  const promotionUseRows = sourceRows(observation, "PROMOTION_USES").map(decodeArtifactPromotionUseRow);
  ensureUnique(promotionUseRows, (row) => `${row.promotionId}:${row.evidenceUseId}`, "Artifact promotion-use pairs");
  const expectedPromotionUsePairs = promotions.flatMap((promotion) => promotion.plan.evidenceUses
    .map((use) => `${promotion.plan.promotionId}:${use.useId}`));
  equalSets(promotionUseRows.map((row) => `${row.promotionId}:${row.evidenceUseId}`), expectedPromotionUsePairs, "Artifact promotion-use set");

  const decodedUses = sourceRows(observation, "EVIDENCE_USES").map(decodeArtifactEvidenceUseRow);
  const uses = decodedUses.map((item) => item.use).sort((left, right) => left.useId.localeCompare(right.useId, "en-CA"));
  const usesById = new Map(uses.map((use) => [use.useId, use]));
  if (uses.some((use) => use.businessId !== run.request.businessId)) throw new Error("Evidence-use source rows cross the workflow business boundary.");
  for (const use of uses) ensureAtOrBefore(use.recordedAt, snapshotAt, `Evidence use ${use.useId}`);
  for (const promotion of promotions) {
    for (const embedded of promotion.plan.evidenceUses) {
      const persisted = usesById.get(embedded.useId);
      if (!persisted || exact(persisted) !== exact(embedded)) throw new Error(`Promotion ${promotion.plan.promotionId} embeds a missing or drifted evidence use.`);
    }
  }

  const manifestUseRaw = sourceRows(observation, "MANIFEST_USES");
  const manifestUses = manifestUseRaw.map((value) => {
    const raw = value as Record<string, unknown>;
    const use = typeof raw.evidenceUseId === "string" ? usesById.get(raw.evidenceUseId) : undefined;
    if (!use) throw new Error("Manifest-use row references an unknown evidence use.");
    return decodeArtifactManifestUseRow(value, use);
  }).sort((left, right) => left.link.linkId.localeCompare(right.link.linkId, "en-CA"));
  ensureUnique(manifestUses, (item) => `${item.row.manifestId}:${item.row.evidenceUseId}`, "Artifact manifest-use pairs");
  const expectedManifestUsePairs: string[] = [];
  for (const promotion of promotions) {
    if (promotion.receipt.outcome !== "COMPLETED") continue;
    const resultManifestId = promotion.receipt.resultManifest.manifestId;
    for (const use of promotion.plan.evidenceUses) {
      expectedManifestUsePairs.push(`${resultManifestId}:${use.useId}`);
      const link = manifestUses.find((item) => item.row.manifestId === resultManifestId && item.row.evidenceUseId === use.useId);
      if (!link || link.row.viaPromotionId !== promotion.plan.promotionId || link.row.linkedAt !== promotion.receipt.completedAt) {
        throw new Error(`Promotion ${promotion.plan.promotionId} lacks its exact result-manifest evidence-use link.`);
      }
    }
  }
  equalSets(manifestUses.map((item) => `${item.row.manifestId}:${item.row.evidenceUseId}`), expectedManifestUsePairs, "Artifact manifest-use set");

  const decodedEnds = sourceRows(observation, "USE_ENDS").map(decodeArtifactEvidenceUseEndRow);
  const endings = decodedEnds.map((item) => item.record).sort((left, right) => left.endId.localeCompare(right.endId, "en-CA"));
  ensureUnique(endings, (ending) => ending.evidenceUseId, "Evidence-use endings by use");
  ensureUnique(endings, (ending) => ending.endDigest, "Evidence-use ending digests");
  const endingsByUse = new Map(endings.map((ending) => [ending.evidenceUseId, ending]));
  for (const ending of endings) {
    const endedUse = usesById.get(ending.evidenceUseId);
    if (!endedUse || ending.businessId !== endedUse.businessId || ending.useType !== endedUse.useType || ending.useDigest !== artifactReferenceDigest(endedUse)) {
      throw new Error(`Evidence-use ending ${ending.endId} does not bind its exact ended use.`);
    }
    if (Date.parse(ending.endedAt) < Date.parse(endedUse.recordedAt)) throw new Error(`Evidence-use ending ${ending.endId} predates its use.`);
    ensureAtOrBefore(ending.recordedAt, snapshotAt, `Evidence-use ending ${ending.endId}`);
    if (ending.replacementEvidenceUseId) {
      const replacement = usesById.get(ending.replacementEvidenceUseId);
      if (
        !replacement || replacement.businessId !== endedUse.businessId
        || replacement.recordVersion !== ending.replacementEvidenceUseVersion
        || artifactReferenceDigest(replacement) !== ending.replacementEvidenceUseDigest
        || Date.parse(replacement.recordedAt) > Date.parse(ending.endedAt)
      ) throw new Error(`Evidence-use ending ${ending.endId} has an invalid replacement closure.`);
    }
  }
  for (const use of uses) {
    const visited = new Set<string>();
    let current: string | null = use.useId;
    while (current) {
      if (visited.has(current)) throw new Error(`Evidence-use replacement closure contains a cycle at ${current}.`);
      visited.add(current);
      current = endingsByUse.get(current)?.replacementEvidenceUseId ?? null;
    }
  }
  const seedUseIds = new Set([
    ...promotionUseRows.map((row) => row.evidenceUseId),
    ...manifestUses.map((item) => item.row.evidenceUseId),
  ]);
  equalSets(replacementClosure(seedUseIds, endingsByUse), usesById.keys(), "Recursive evidence-use source closure");

  const availabilityReceipts = sourceRows(observation, "AVAILABILITY")
    .map(decodeArtifactAvailabilityRow).map((item) => item.receipt);
  ensureUnique(availabilityReceipts, (receipt) => `${receipt.manifestId}:${receipt.checkedAt}:${receipt.checkerKind}`, "Availability observation identities");
  ensureUnique(availabilityReceipts, (receipt) => receipt.receiptDigest, "Availability receipt digests");
  const availability = selectFreshR2ManifestAvailability({ manifests, receipts: availabilityReceipts, snapshotCapturedAt: snapshotAt });

  const selectedPromotions = promotions.filter((promotion) => (
    selectedManifestIds.has(promotion.plan.sourceManifest.manifestId)
    || (promotion.receipt.outcome === "COMPLETED" && selectedManifestIds.has(promotion.receipt.resultManifest.manifestId))
  ));
  const selectedManifestUses = manifestUses.filter((item) => selectedManifestIds.has(item.row.manifestId));
  const selectedSeedUses = new Set([
    ...selectedPromotions.flatMap((promotion) => promotion.plan.evidenceUses.map((use) => use.useId)),
    ...selectedManifestUses.map((item) => item.row.evidenceUseId),
  ]);
  const selectedUseIds = replacementClosure(selectedSeedUses, endingsByUse);
  const selectedFacts = DecodedReferenceFactsSchema.parse({
    workflowRun: {
      workflowRunId: run.row.id, businessId: run.row.businessId, workflowKind: run.row.workflowKind,
      workflowVersion: run.row.workflowVersion, requestDigest: run.row.requestDigest,
    },
    manifests: manifests.filter((manifest) => selectedManifestIds.has(manifest.manifestId)),
    promotions: selectedPromotions.map(({ plan: promotionPlan, receipt }) => ({ plan: promotionPlan, receipt })),
    evidenceUses: uses.filter((use) => selectedUseIds.has(use.useId)),
    manifestEvidenceUses: selectedManifestUses.map((item) => item.link),
    evidenceUseEnds: endings.filter((ending) => selectedUseIds.has(ending.evidenceUseId)),
    availability: availability.selected.filter((receipt) => selectedManifestIds.has(receipt.manifestId)),
  });
  const selectedFreshUntil = selectedFacts.availability.reduce((earliest, receipt) => {
    const boundary = receipt.expiresAt && Date.parse(receipt.expiresAt) < Date.parse(receipt.validThrough)
      ? receipt.expiresAt : receipt.validThrough;
    return !earliest || Date.parse(boundary) < Date.parse(earliest) ? boundary : earliest;
  }, null as string | null);
  if (!selectedFreshUntil) throw new Error("Selected lineage has no availability freshness boundary.");

  const sourceCounts = Object.fromEntries(ARTIFACT_REFERENCE_SOURCE_SET_ORDER.map((name) => [
    name, sourceRows(observation, name).length,
  ])) as z.infer<typeof SourceCountsSchema>;
  const forestCore = {
    rootManifestIds,
    manifestIds: manifests.map((manifest) => manifest.manifestId),
  };
  const selectedLineage = {
    rootManifestId: root.manifestId,
    manifestIds: [...selectedManifestIds].sort((left, right) => left.localeCompare(right, "en-CA")),
    disconnectedRootManifestIds: rootManifestIds.filter((id) => id !== root.manifestId),
    facts: selectedFacts,
    sourceFactsDigest: artifactReferenceDigest(selectedFacts),
  };
  const core = {
    decoderVersion: ARTIFACT_REFERENCE_D1_SOURCE_DECODER_VERSION,
    planDigest: plan.planDigest,
    sourceBaseRowsDigest: proof.sourceBaseRowsDigest,
    snapshotCapturedAt: snapshotAt,
    workflowHistory: {
      request: run.request,
      definition,
      deliveries: deliveries.map((item) => item.delivery),
      attempts,
      leases,
      receiptRevisions: revisions,
      terminalReceipt,
      terminalResumePlan,
    },
    workflowForest: { ...forestCore, forestDigest: artifactReferenceDigest({ ...forestCore, manifests, promotions: promotions.map(({ plan: promotionPlan, receipt }) => ({ plan: promotionPlan, receipt })) }) },
    selectedLineage,
    selectedAvailabilityFreshUntil: selectedFreshUntil,
    sourceCounts,
    structurallyValid: true as const,
    transactionallyTrusted: false as const,
    snapshotComplete: false as const,
    trustBlocker: "TRUSTED_D1_COMMIT_AND_RELOAD_EXECUTOR_NOT_IMPLEMENTED" as const,
    retentionConclusionAuthorized: false as const,
    projectionPersistenceAuthorized: false as const,
    releaseAuthorized: false as const,
    deletionAuthorized: false as const,
    providerOperationsAuthorized: 0 as const,
    costAuthorizedUsd: 0 as const,
  };
  return ArtifactReferenceDecodedSnapshotSchema.parse({ ...core, decodedFactsDigest: artifactReferenceDigest(core) });
}
