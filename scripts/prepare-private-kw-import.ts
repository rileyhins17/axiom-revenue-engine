import { lstat, mkdir, open, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  preparePrivateKwImport,
  type PrivateKwImportInput,
} from "../src/lib/revenue-engine/private-kw-import";

const MAX_PRIVATE_INPUT_BYTES = 2_000_000;
const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const PRIVATE_DATA_ROOT = path.resolve(REPOSITORY_ROOT, "data", "kw-evaluation");

function isInside(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function resolvePrivateKwDataPath(value: string) {
  const resolved = path.resolve(REPOSITORY_ROOT, value);
  if (!isInside(PRIVATE_DATA_ROOT, resolved)) {
    throw new Error("Private KW import files must stay inside data/kw-evaluation/.");
  }
  if (path.dirname(resolved) !== PRIVATE_DATA_ROOT) {
    throw new Error("Private KW import files must be direct children of data/kw-evaluation/.");
  }
  if (path.extname(resolved).toLocaleLowerCase("en-CA") !== ".json") {
    throw new Error("Private KW import files must use the .json extension.");
  }
  return resolved;
}

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
  await mkdir(PRIVATE_DATA_ROOT, { recursive: true });
  if ((await lstat(PRIVATE_DATA_ROOT)).isSymbolicLink() || (await lstat(files.input)).isSymbolicLink()) {
    throw new Error("Private KW import directories and input files cannot be symbolic links.");
  }
  const inputStats = await stat(files.input);
  if (!inputStats.isFile() || inputStats.size > MAX_PRIVATE_INPUT_BYTES) {
    throw new Error("The private KW input must be a JSON file no larger than 2 MB.");
  }

  const raw = await readFile(files.input, "utf8");
  const parsed = JSON.parse(raw) as PrivateKwImportInput;
  const plan = preparePrivateKwImport(parsed);
  const output = `${JSON.stringify(plan, null, 2)}\n`;

  const handle = await open(files.output, "wx");
  try {
    await handle.writeFile(output, "utf8");
  } finally {
    await handle.close();
  }
  return { output: files.output, summary: plan.summary };
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
