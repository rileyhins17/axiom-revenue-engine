import { lstat } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { PrivateKwOwnerLabelingPacketSchema } from "../src/lib/revenue-engine/private-kw-owner-labeling";
import { splitOwnerLabelingPacket } from "../src/lib/revenue-engine/owner-labeling-blind";
import { readPrivateKwJson, resolvePrivateKwDataPath, writePrivateKwJson } from "./private-kw-files";

const MAX_PRIVATE_LABELING_BYTES = 50_000_000;

function parseArgs(args: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error("Usage: npm run kw:split-owner-labeling -- --packet data/kw-evaluation/owner-labeling.json --blind-output data/kw-evaluation/owner-labeling-blind.json --assessment-output data/kw-evaluation/owner-labeling-assessments.json");
    }
    if (values.has(name)) throw new Error(`Duplicate argument ${name}.`);
    values.set(name, value);
  }
  if (values.size !== 3 || !values.has("--packet") || !values.has("--blind-output") || !values.has("--assessment-output")) {
    throw new Error("Exactly --packet, --blind-output, and --assessment-output are required.");
  }
  return {
    packet: resolvePrivateKwDataPath(values.get("--packet")!),
    blindOutput: resolvePrivateKwDataPath(values.get("--blind-output")!),
    assessmentOutput: resolvePrivateKwDataPath(values.get("--assessment-output")!),
  };
}

async function assertOutputDoesNotExist(file: string) {
  try {
    await lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error("A requested split output already exists; choose new ignored-local filenames.");
}

export async function splitPrivateKwOwnerLabelingFile(args: string[]) {
  const files = parseArgs(args);
  if (new Set([files.packet, files.blindOutput, files.assessmentOutput]).size !== 3) {
    throw new Error("The input and both owner-labeling outputs must use different files.");
  }

  const input = await readPrivateKwJson(files.packet, MAX_PRIVATE_LABELING_BYTES);
  const packet = PrivateKwOwnerLabelingPacketSchema.parse(input.value);
  const { blindPacket, assessmentSidecar } = splitOwnerLabelingPacket(packet);

  await Promise.all([
    assertOutputDoesNotExist(files.blindOutput),
    assertOutputDoesNotExist(files.assessmentOutput),
  ]);
  const blindOutput = await writePrivateKwJson(files.blindOutput, blindPacket);
  const assessmentOutput = await writePrivateKwJson(files.assessmentOutput, assessmentSidecar);
  return { blindOutput, assessmentOutput, written: 2 as const };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  splitPrivateKwOwnerLabelingFile(process.argv.slice(2))
    .then((result) => {
      console.log("Wrote the blind owner-review packet and the separate assessment sidecar.");
      console.log(`Ignored outputs: ${result.blindOutput} and ${result.assessmentOutput}`);
      console.log("The split changed no database, provider, qualification, outreach, send, or spend state.");
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "Private KW owner-labeling split failed.");
      process.exitCode = 1;
    });
}
