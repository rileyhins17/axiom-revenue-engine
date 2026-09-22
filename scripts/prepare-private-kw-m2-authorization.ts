import { pathToFileURL } from "node:url";
import { z } from "zod";

import {
  buildPrivateKwM2AssessmentMappingPolicy,
  buildPrivateKwM2ExecutionAuthorization,
  buildPrivateKwM2OwnerApprovalCandidate,
  buildPrivateKwM2ResearchPacket,
  PrivateKwM2ResearchPolicySchema,
} from "../src/lib/revenue-engine/private-kw-m2-authorization";
import { PrivateKwImportPlanSchema } from "../src/lib/revenue-engine/private-kw-import";
import { PrivateKwShadowSliceManifestSchema } from "../src/lib/revenue-engine/private-kw-shadow-slice";
import {
  readPrivateKwJson,
  resolvePrivateKwDataPath,
  writePrivateKwJson,
} from "./private-kw-files";

const MAX_PRIVATE_SOURCE_BYTES = 5_000_000;
const MAX_PRIVATE_MANIFEST_BYTES = 2_000_000;
const ReviewPolicySchema = z.object({
  reviewVersion: z.literal("kw-m2-authorization-review-v1"),
  preparedAt: z.string().datetime({ offset: true }),
  websitePolicy: z.object({ version: z.string().trim().min(1).max(80), networkRequestCap: z.number().int().min(1).max(100), expiresAt: z.string().datetime({ offset: true }) }).strict(),
  researchPolicy: PrivateKwM2ResearchPolicySchema,
}).strict();

function parseArgs(args: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error("Usage: npm run kw:prepare-m2-authorization -- --source-plan data/kw-evaluation/source.json --manifest data/kw-evaluation/manifest.json --research-packet data/kw-evaluation/packet.json --authorization data/kw-evaluation/authorization.json --owner-approval data/kw-evaluation/owner-candidate.json --mapping-policy data/kw-evaluation/mapping-policy.json --review-policy data/kw-evaluation/review-policy.json");
    }
    if (values.has(name)) throw new Error(`Duplicate argument ${name}.`);
    values.set(name, value);
  }
  const required = [
    "--source-plan",
    "--manifest",
    "--research-packet",
    "--authorization",
    "--owner-approval",
    "--mapping-policy",
    "--review-policy",
  ];
  if (values.size !== required.length || required.some((name) => !values.has(name))) {
    throw new Error("Exactly --source-plan, --manifest, --research-packet, --authorization, --owner-approval, --mapping-policy, and --review-policy are required.");
  }
  const files = Object.fromEntries(required.map((name) => [name.slice(2).replaceAll("-", ""), resolvePrivateKwDataPath(values.get(name)!)]));
  if (new Set(Object.values(files)).size !== required.length) {
    throw new Error("Every M2 authorization input and output must be a different file.");
  }
  return {
    sourcePlan: files.sourceplan,
    manifest: files.manifest,
    researchPacket: files.researchpacket,
    authorization: files.authorization,
    ownerApproval: files.ownerapproval,
    mappingPolicy: files.mappingpolicy,
    reviewPolicy: files.reviewpolicy,
  };
}

export async function preparePrivateKwM2AuthorizationFiles(args: string[], now = new Date()) {
  const files = parseArgs(args);
  const [sourceRead, manifestRead, reviewRead] = await Promise.all([
    readPrivateKwJson(files.sourcePlan, MAX_PRIVATE_SOURCE_BYTES),
    readPrivateKwJson(files.manifest, MAX_PRIVATE_MANIFEST_BYTES),
    readPrivateKwJson(files.reviewPolicy, MAX_PRIVATE_MANIFEST_BYTES),
  ]);
  const sourcePlan = PrivateKwImportPlanSchema.parse(sourceRead.value);
  const manifest = PrivateKwShadowSliceManifestSchema.parse(manifestRead.value);
  const review = ReviewPolicySchema.parse(reviewRead.value);
  if (!Number.isFinite(now.getTime())) throw new Error("Authorization preparation requires a valid clock.");
  const preparedAt = Date.parse(review.preparedAt);
  const expiresAt = Date.parse(review.websitePolicy.expiresAt);
  if (preparedAt > now.getTime()) throw new Error("Authorization preparation cannot be dated in the future.");
  if (expiresAt <= preparedAt || expiresAt <= now.getTime()) throw new Error("Execution authorization must expire after preparation and remain current.");
  if (review.researchPolicy.decisions.some((decision) => Date.parse(decision.retentionReviewDate) < now.getTime())) {
    throw new Error("Research policy contains an expired retention review date.");
  }
  const researchPacket = buildPrivateKwM2ResearchPacket({
    manifest,
    sourcePlan,
    reviewedAt: review.preparedAt,
    policyDecisions: review.researchPolicy.decisions,
  });
  const authorization = buildPrivateKwM2ExecutionAuthorization({
    researchPacket,
    manifest,
    sourcePlan,
    websitePolicy: {
      ...review.websitePolicy,
    },
    researchPolicy: review.researchPolicy,
  });
  const ownerApproval = buildPrivateKwM2OwnerApprovalCandidate({
    researchPacket,
    authorization,
    manifest,
    sourcePlan,
    researchPolicy: review.researchPolicy,
  });
  if (ownerApproval.status !== "PENDING") {
    throw new Error("M2 authorization preparation cannot emit an APPROVED owner envelope.");
  }
  const mappingPolicy = buildPrivateKwM2AssessmentMappingPolicy({
    fieldNames: ["websiteOutcome", "limitations", "sourceProvenance"],
    outcomeVocabulary: ["COMPLETE", "PARTIAL", "BLOCKED", "RESEARCH_REQUIRED"],
    limitationVocabulary: ["NO_BROWSER", "NO_R2", "NO_CONTACT"],
  });
  const [packetFile, authorizationFile, ownerApprovalFile, mappingFile] = await Promise.all([
    writePrivateKwJson(files.researchPacket, researchPacket),
    writePrivateKwJson(files.authorization, authorization),
    writePrivateKwJson(files.ownerApproval, ownerApproval),
    writePrivateKwJson(files.mappingPolicy, mappingPolicy),
  ]);
  return {
    researchPacket: packetFile,
    authorization: authorizationFile,
    ownerApproval: ownerApprovalFile,
    mappingPolicy: mappingFile,
    status: authorization.status,
    ownerApprovalStatus: ownerApproval.status,
    fixtureOnly: mappingPolicy.fixtureOnly,
    providerOperationsAuthorized: 0 as const,
    costAuthorizedUsd: 0 as const,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  preparePrivateKwM2AuthorizationFiles(process.argv.slice(2))
    .then((result) => {
      console.log(`Prepared M2 authorization chain: ${result.researchPacket}`);
      console.log(`Pending execution authorization: ${result.authorization}`);
      console.log(`Pending owner decision candidate: ${result.ownerApproval}`);
      console.log(`Policy-neutral fixture mapping: ${result.mappingPolicy}`);
      console.log("No approved envelope, assessment approval, database, network, provider, contact, deployment, or spend authority was created.");
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "Private KW M2 authorization preparation failed.");
      process.exitCode = 1;
    });
}
