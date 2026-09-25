import { pathToFileURL } from "node:url";

import {
  PrivateKwImportPlanSchema,
} from "../src/lib/revenue-engine/private-kw-import";
import {
  buildPrivateKwPersistencePlan,
} from "../src/lib/revenue-engine/private-kw-persistence-plan";
import {
  readPrivateKwJson,
  resolvePrivateKwDataPath,
  writePrivateKwJson,
} from "./private-kw-files";

const MAX_PRIVATE_PLAN_BYTES = 5_000_000;

function parseArgs(args: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error("Usage: npm run kw:plan-persistence -- --input data/kw-evaluation/plan.json --output data/kw-evaluation/persistence.json");
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

export async function planPrivateKwPersistenceFile(args: string[]) {
  const files = parseArgs(args);
  if (files.input === files.output) throw new Error("Input and output files must be different.");
  const input = await readPrivateKwJson(files.input, MAX_PRIVATE_PLAN_BYTES);
  const source = PrivateKwImportPlanSchema.parse(input.value);
  const plan = buildPrivateKwPersistencePlan(source);
  const output = await writePrivateKwJson(files.output, plan);
  return { output, summary: plan.summary, mutationAuthorized: plan.mutationAuthorized };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  planPrivateKwPersistenceFile(process.argv.slice(2))
    .then((result) => {
      console.log(`Prepared validation-only persistence plan with ${result.summary.totalStatements} statements.`);
      console.log(`Mutation authorized: ${String(result.mutationAuthorized)}.`);
      console.log(`Ignored output: ${result.output}`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "Private KW persistence planning failed.");
      process.exitCode = 1;
    });
}
