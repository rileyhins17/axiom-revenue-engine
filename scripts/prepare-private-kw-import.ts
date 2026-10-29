import { pathToFileURL } from "node:url";

import {
  preparePrivateKwImport,
  type PrivateKwImportInput,
} from "../src/lib/revenue-engine/private-kw-import";
import {
  readPrivateKwJson,
  resolvePrivateKwDataPath,
  writePrivateKwJson,
} from "./private-kw-files";

const MAX_PRIVATE_INPUT_BYTES = 2_000_000;
export { resolvePrivateKwDataPath } from "./private-kw-files";

function parseArgs(args: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error("Usage: npm run kw:prepare-import -- --input data/kw-evaluation/input.json --output data/kw-evaluation/plan.json");
    }
    if (values.has(name)) throw new Error(`Duplicate argument ${name}.`);
    values.set(name, value);
  }
  if (values.size !== 2 || !values.has("--input") || !values.has("--output")) {
    throw new Error("Exactly --input and --output are required.");
  }
  return {
    input: resolvePrivateKwDataPath(values.get("--input")!),
    output: resolvePrivateKwDataPath(values.get("--output")!),
  };
}

export async function preparePrivateKwImportFile(args: string[]) {
  const files = parseArgs(args);
  if (files.input === files.output) throw new Error("Input and output files must be different.");
  const input = await readPrivateKwJson(files.input, MAX_PRIVATE_INPUT_BYTES);
  const plan = preparePrivateKwImport(input.value as PrivateKwImportInput);
  const output = await writePrivateKwJson(files.output, plan);
  return { output, summary: plan.summary };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  preparePrivateKwImportFile(process.argv.slice(2))
    .then((result) => {
      console.log(`Prepared private KW import: ${result.summary.loaded} loaded, ${result.summary.remaining} remaining.`);
      console.log(`Ignored output: ${result.output}`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "Private KW import failed.");
      process.exitCode = 1;
    });
}
