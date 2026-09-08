import { pathToFileURL } from "node:url";

import {
  PrivateKwImportPlanSchema,
} from "../src/lib/revenue-engine/private-kw-import";
import {
  PrivateKwShadowSliceInputSchema,
  buildPrivateKwShadowSliceManifest,
} from "../src/lib/revenue-engine/private-kw-shadow-slice";
import {
  readPrivateKwJson,
  resolvePrivateKwDataPath,
  writePrivateKwJson,
} from "./private-kw-files";

const MAX_PRIVATE_SOURCE_BYTES = 5_000_000;
const MAX_PRIVATE_SELECTION_BYTES = 1_000_000;

function parseArgs(args: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error("Usage: npm run kw:prepare-shadow-slice -- --source-plan data/kw-evaluation/plan.json --selection data/kw-evaluation/shadow-slice-selection.json --output data/kw-evaluation/shadow-slice-manifest.json");
    }
    if (values.has(name)) throw new Error(`Duplicate argument ${name}.`);
    values.set(name, value);
  }
  if (
    values.size !== 3
    || !values.has("--source-plan")
    || !values.has("--selection")
    || !values.has("--output")
  ) {
    throw new Error("Exactly --source-plan, --selection, and --output are required.");
  }
  return {
    sourcePlan: resolvePrivateKwDataPath(values.get("--source-plan")!),
    selection: resolvePrivateKwDataPath(values.get("--selection")!),
    output: resolvePrivateKwDataPath(values.get("--output")!),
  };
}

export async function preparePrivateKwShadowSliceFile(args: string[]) {
  const files = parseArgs(args);
  if (new Set(Object.values(files)).size !== 3) {
    throw new Error("Source plan, selection, and manifest output must be different files.");
  }
  const [sourceRead, selectionRead] = await Promise.all([
    readPrivateKwJson(files.sourcePlan, MAX_PRIVATE_SOURCE_BYTES),
    readPrivateKwJson(files.selection, MAX_PRIVATE_SELECTION_BYTES),
  ]);
  const source = PrivateKwImportPlanSchema.parse(sourceRead.value);
  const selection = PrivateKwShadowSliceInputSchema.parse(selectionRead.value);
  const manifest = buildPrivateKwShadowSliceManifest(source, selection);
  const output = await writePrivateKwJson(files.output, manifest);
  return {
    output,
    manifestId: manifest.manifestId,
    summary: manifest.summary,
    planOnly: true as const,
    providerOperationsAuthorized: 0 as const,
    costAuthorizedUsd: 0 as const,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  preparePrivateKwShadowSliceFile(process.argv.slice(2))
    .then((result) => {
      console.log(`Prepared bounded KW shadow slice: ${result.manifestId}`);
      console.log(`${result.summary.selectedBusinesses} manually reviewed independent businesses; next gate: ${result.summary.nextRequiredGate}.`);
      console.log(`Ignored output: ${result.output}`);
      console.log("This manifest authorizes no source, capture, provider, database, consent, outreach, deployment, or send action.");
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "Private KW shadow-slice preparation failed.");
      process.exitCode = 1;
    });
}
