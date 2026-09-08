import { pathToFileURL } from "node:url";

import {
  PrivateKwOwnerLabelSubmissionSchema,
  PrivateKwOwnerLabelingPacketSchema,
  applyPrivateKwOwnerLabels,
} from "../src/lib/revenue-engine/private-kw-owner-labeling";
import {
  readPrivateKwJson,
  resolvePrivateKwDataPath,
  writePrivateKwJson,
} from "./private-kw-files";

const MAX_PRIVATE_LABELING_BYTES = 50_000_000;
const MAX_PRIVATE_REVIEW_BYTES = 500_000;

function parseArgs(args: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error("Usage: npm run kw:record-owner-labels -- --packet data/kw-evaluation/owner-labeling.json --reviews data/kw-evaluation/owner-reviews.json --output data/kw-evaluation/owner-labeling-next.json");
    }
    if (values.has(name)) throw new Error(`Duplicate argument ${name}.`);
    values.set(name, value);
  }
  if (values.size !== 3 || !values.has("--packet") || !values.has("--reviews") || !values.has("--output")) {
    throw new Error("Exactly --packet, --reviews, and --output are required.");
  }
  return {
    packet: resolvePrivateKwDataPath(values.get("--packet")!),
    reviews: resolvePrivateKwDataPath(values.get("--reviews")!),
    output: resolvePrivateKwDataPath(values.get("--output")!),
  };
}

export async function recordPrivateKwOwnerLabelsFile(args: string[]) {
  const files = parseArgs(args);
  if (new Set([files.packet, files.reviews, files.output]).size !== 3) {
    throw new Error("Owner-labeling packet, review input, and output must be different files.");
  }
  const [packetRead, reviewRead] = await Promise.all([
    readPrivateKwJson(files.packet, MAX_PRIVATE_LABELING_BYTES),
    readPrivateKwJson(files.reviews, MAX_PRIVATE_REVIEW_BYTES),
  ]);
  const packet = PrivateKwOwnerLabelingPacketSchema.parse(packetRead.value);
  const submission = PrivateKwOwnerLabelSubmissionSchema.parse(reviewRead.value);
  const next = applyPrivateKwOwnerLabels(packet, submission);
  const output = await writePrivateKwJson(files.output, next);
  return {
    output,
    packetId: next.packetId,
    parentPacketId: next.parentPacketId,
    summary: next.summary,
    databaseMutationPerformed: false as const,
    qualificationAuthorized: false as const,
    outreachAuthorized: false as const,
    sendAuthorized: false as const,
    providerOperationsAuthorized: 0 as const,
    costAuthorizedUsd: 0 as const,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  recordPrivateKwOwnerLabelsFile(process.argv.slice(2))
    .then((result) => {
      console.log(`Recorded immutable owner-labeling checkpoint: ${result.packetId}`);
      console.log(`${result.summary.reviewed}/${result.summary.targetSize} leads reviewed; agreement ${result.summary.agreementPercent}%.`);
      console.log(`Ignored output: ${result.output}`);
      console.log("The checkpoint changed no database, score, qualification, provider, outreach, send, or spend state.");
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "Private KW owner-labeling checkpoint failed.");
      process.exitCode = 1;
    });
}
