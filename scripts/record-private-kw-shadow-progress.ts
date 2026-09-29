import { pathToFileURL } from "node:url";

import { PrivateKwShadowSliceManifestSchema } from "../src/lib/revenue-engine/private-kw-shadow-slice";
import {
  PrivateKwShadowSlicePhaseReceiptInputSchema,
  PrivateKwShadowSliceProgressCheckpointSchema,
  appendPrivateKwShadowSliceProgress,
  buildInitialPrivateKwShadowSliceProgress,
} from "../src/lib/revenue-engine/private-kw-shadow-slice-progress";
import {
  readPrivateKwJson,
  resolvePrivateKwDataPath,
  writePrivateKwJson,
} from "./private-kw-files";

const MAX_MANIFEST_BYTES = 5_000_000;
const MAX_PROGRESS_BYTES = 10_000_000;
const MAX_RECEIPT_BYTES = 1_000_000;

function usage() {
  return "Usage: npm run kw:record-shadow-progress -- --manifest data/kw-evaluation/shadow-slice-manifest.json [--previous data/kw-evaluation/shadow-progress-current.json] --receipt data/kw-evaluation/shadow-phase-receipt.json --output data/kw-evaluation/shadow-progress-next.json";
}

function parseArgs(args: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--")) throw new Error(usage());
    if (values.has(name)) throw new Error(`Duplicate argument ${name}.`);
    values.set(name, value);
  }
  const allowed = new Set(["--manifest", "--previous", "--receipt", "--output"]);
  if (
    [...values.keys()].some((name) => !allowed.has(name))
    || !values.has("--manifest")
    || !values.has("--receipt")
    || !values.has("--output")
  ) {
    throw new Error(usage());
  }
  const files = {
    manifest: resolvePrivateKwDataPath(values.get("--manifest")!),
    previous: values.has("--previous") ? resolvePrivateKwDataPath(values.get("--previous")!) : null,
    receipt: resolvePrivateKwDataPath(values.get("--receipt")!),
    output: resolvePrivateKwDataPath(values.get("--output")!),
  };
  const paths = [files.manifest, files.receipt, files.output, ...(files.previous ? [files.previous] : [])];
  if (new Set(paths).size !== paths.length) {
    throw new Error("Manifest, prior checkpoint, phase receipt, and next checkpoint must be different files.");
  }
  return files;
}

export async function recordPrivateKwShadowProgressFile(args: string[]) {
  const files = parseArgs(args);
  const [manifestRead, receiptRead, previousRead] = await Promise.all([
    readPrivateKwJson(files.manifest, MAX_MANIFEST_BYTES),
    readPrivateKwJson(files.receipt, MAX_RECEIPT_BYTES),
    files.previous ? readPrivateKwJson(files.previous, MAX_PROGRESS_BYTES) : Promise.resolve(null),
  ]);
  const manifest = PrivateKwShadowSliceManifestSchema.parse(manifestRead.value);
  const receipt = PrivateKwShadowSlicePhaseReceiptInputSchema.parse(receiptRead.value);
  const previous = previousRead
    ? PrivateKwShadowSliceProgressCheckpointSchema.parse(previousRead.value)
    : buildInitialPrivateKwShadowSliceProgress(manifest);
  const checkpoint = appendPrivateKwShadowSliceProgress(manifest, previous, receipt);
  const output = await writePrivateKwJson(files.output, checkpoint);
  const record = checkpoint.records.find((candidate) => candidate.businessId === receipt.businessId)!;
  return {
    output,
    checkpointId: checkpoint.checkpointId,
    parentCheckpointId: checkpoint.parentCheckpoint?.checkpointId ?? null,
    businessId: record.businessId,
    currentCheckpoint: record.currentCheckpoint,
    nextRequiredGate: record.nextRequiredGate,
    completedPhaseReceipts: checkpoint.summary.completedPhaseReceipts,
    fullyCompletedBusinesses: checkpoint.summary.fullyCompletedBusinesses,
    progressRecordingOnly: true as const,
    phaseExecutionAuthorized: false as const,
    providerOperationsAuthorized: 0 as const,
    costAuthorizedUsd: 0 as const,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  recordPrivateKwShadowProgressFile(process.argv.slice(2))
    .then((result) => {
      console.log(`Recorded immutable shadow progress: ${result.checkpointId}`);
      console.log(`Business ${result.businessId}: ${result.currentCheckpoint}; next gate: ${result.nextRequiredGate ?? "COMPLETE"}.`);
      console.log(`Ignored output: ${result.output}`);
      console.log("This checkpoint records proof only; it authorizes no phase execution, provider, database, outreach, deployment, send, or spend action.");
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "Private KW shadow progress recording failed.");
      process.exitCode = 1;
    });
}
