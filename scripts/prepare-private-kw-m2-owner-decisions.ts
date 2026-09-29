import { pathToFileURL } from "node:url";

import {
  PrivateKwM2CodexDelegatedOwnerDecisionsSchema,
  buildPrivateKwM2OwnerDecisionSelection,
} from "../src/lib/revenue-engine/private-kw-m2-owner-decisions";
import {
  readPrivateKwJson,
  resolvePrivateKwDataPath,
  writePrivateKwJson,
} from "./private-kw-files";

const MAX_RESEARCH_REVIEW_BYTES = 5_000_000;
const MAX_SOURCE_PLAN_BYTES = 5_000_000;
const MAX_DECISIONS_BYTES = 1_000_000;

function parseArgs(args: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error("Usage: npm run kw:prepare-m2-owner-decisions -- --research-review data/kw-evaluation/review.json --source-plan data/kw-evaluation/plan.json --decisions data/kw-evaluation/owner-decisions.json --output data/kw-evaluation/selection.json");
    }
    if (values.has(name)) throw new Error(`Duplicate argument ${name}.`);
    values.set(name, value);
  }
  const required = ["--research-review", "--source-plan", "--decisions", "--output"];
  if (values.size !== required.length || required.some((name) => !values.has(name))) {
    throw new Error("Exactly --research-review, --source-plan, --decisions, and --output are required.");
  }
  const files = Object.fromEntries(required.map((name) => [name.slice(2).replaceAll("-", ""), resolvePrivateKwDataPath(values.get(name)!)]));
  if (new Set(Object.values(files)).size !== required.length) {
    throw new Error("Research review, source plan, owner decisions, and selection output must be different files.");
  }
  return {
    researchReview: files.researchreview!,
    sourcePlan: files.sourceplan!,
    decisions: files.decisions!,
    output: files.output!,
  };
}

export async function preparePrivateKwM2OwnerDecisionSelectionFile(args: string[], now = new Date()) {
  const files = parseArgs(args);
  if (!Number.isFinite(now.getTime())) throw new Error("Owner-decision preparation requires a valid clock.");
  const [researchReviewRead, sourcePlanRead, decisionsRead] = await Promise.all([
    readPrivateKwJson(files.researchReview, MAX_RESEARCH_REVIEW_BYTES),
    readPrivateKwJson(files.sourcePlan, MAX_SOURCE_PLAN_BYTES),
    readPrivateKwJson(files.decisions, MAX_DECISIONS_BYTES),
  ]);
  const selection = buildPrivateKwM2OwnerDecisionSelection({
    researchReview: researchReviewRead.value,
    researchReviewBytes: researchReviewRead.bytes,
    sourcePlan: sourcePlanRead.value,
    decisions: decisionsRead.value,
    createdAt: now.toISOString(),
  });
  const delegated = PrivateKwM2CodexDelegatedOwnerDecisionsSchema.safeParse(decisionsRead.value);
  const output = await writePrivateKwJson(files.output, selection);
  return {
    output,
    selectedBusinesses: selection.selections.length,
    ...(delegated.success
      ? {
        reviewer: delegated.data.reviewer,
        delegatedBy: delegated.data.delegatedBy,
        medium: delegated.data.medium,
        conversationRef: delegated.data.conversationRef,
        scope: delegated.data.scope,
      }
      : { reviewedBy: (decisionsRead.value as { reviewedBy: string }).reviewedBy }),
    reviewedAt: (decisionsRead.value as { reviewedAt: string }).reviewedAt,
    planOnly: selection.authority.planOnly,
    providerOperationsAuthorized: selection.authority.providerOperationsAuthorized,
    costAuthorizedUsd: selection.authority.costAuthorizedUsd,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  preparePrivateKwM2OwnerDecisionSelectionFile(process.argv.slice(2))
    .then((result) => {
      if ("reviewer" in result) {
        console.log(`Prepared ${result.selectedBusinesses} M2 identities reviewed by ${result.reviewer} under delegation from ${result.delegatedBy}: ${result.output}`);
        console.log(`Delegation source: ${result.medium} ${result.conversationRef}; scope: ${result.scope}.`);
      } else {
        console.log(`Prepared ${result.selectedBusinesses} owner-confirmed M2 identities: ${result.output}`);
      }
      console.log("This selection grants no capture, artifact storage, database, provider, contact, qualification, outreach, deployment, send, or spend authority.");
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "M2 owner-decision selection preparation failed.");
      process.exitCode = 1;
    });
}
