import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { splitPrivateKwOwnerLabelingFile } from "./split-private-kw-owner-labeling";
import { buildCompleteOwnerLabelingPacketFixture } from "../src/lib/revenue-engine/test-support/owner-labeling-fixture";

const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const PRIVATE_ROOT = path.join(REPOSITORY_ROOT, "data", "kw-evaluation");

async function withPrivateFiles<T>(run: (file: (name: string) => string) => Promise<T>) {
  await mkdir(PRIVATE_ROOT, { recursive: true });
  const stem = `split-test-${randomUUID()}`;
  const file = (name: string) => path.join(PRIVATE_ROOT, `${stem}-${name}`);
  try {
    return await run(file);
  } finally {
    await Promise.all(["input.json", "blind.json", "assessment.json"].map((name) => rm(file(name), { force: true })));
  }
}

function relative(file: string) {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
}

test("CLI splits a full private checkpoint into separate blind and assessment files", async () => {
  await withPrivateFiles(async (getFile) => {
    const packetPath = getFile("input.json");
    const blindPath = getFile("blind.json");
    const assessmentPath = getFile("assessment.json");
    await writeFile(packetPath, JSON.stringify(buildCompleteOwnerLabelingPacketFixture()), "utf8");

    const result = await splitPrivateKwOwnerLabelingFile([
      "--packet", relative(packetPath),
      "--blind-output", relative(blindPath),
      "--assessment-output", relative(assessmentPath),
    ]);

    assert.equal(result.written, 2);
    const blind = JSON.parse(await readFile(blindPath, "utf8")) as Record<string, unknown>;
    const sidecar = JSON.parse(await readFile(assessmentPath, "utf8")) as Record<string, unknown>;
    assert.equal(blind.targetSize, 50);
    assert.equal("engineAssessment" in ((blind.entries as Array<Record<string, unknown>>)[0] ?? {}), false);
    assert.equal("summary" in sidecar, true);
    assert.equal((sidecar.entries as Array<Record<string, unknown>>).length, 50);
  });
});

test("CLI refuses either existing output before creating or replacing either artifact", async () => {
  await withPrivateFiles(async (getFile) => {
    const packetPath = getFile("input.json");
    const blindPath = getFile("blind.json");
    const assessmentPath = getFile("assessment.json");
    const original = JSON.stringify(buildCompleteOwnerLabelingPacketFixture());
    await writeFile(packetPath, original, "utf8");
    await writeFile(assessmentPath, "preserve-me", "utf8");

    await assert.rejects(splitPrivateKwOwnerLabelingFile([
      "--packet", relative(packetPath),
      "--blind-output", relative(blindPath),
      "--assessment-output", relative(assessmentPath),
    ]), /already exists/i);

    assert.equal(await readFile(assessmentPath, "utf8"), "preserve-me");
    await assert.rejects(readFile(blindPath), { code: "ENOENT" });
    assert.equal(await readFile(packetPath, "utf8"), original);
  });
});

test("CLI rejects an invalid full checkpoint before publishing either output", async () => {
  await withPrivateFiles(async (getFile) => {
    const packetPath = getFile("input.json");
    const blindPath = getFile("blind.json");
    const assessmentPath = getFile("assessment.json");
    await writeFile(packetPath, JSON.stringify({ packetVersion: "wrong" }), "utf8");

    await assert.rejects(splitPrivateKwOwnerLabelingFile([
      "--packet", relative(packetPath),
      "--blind-output", relative(blindPath),
      "--assessment-output", relative(assessmentPath),
    ]));

    await assert.rejects(readFile(blindPath), { code: "ENOENT" });
    await assert.rejects(readFile(assessmentPath), { code: "ENOENT" });
  });
});
