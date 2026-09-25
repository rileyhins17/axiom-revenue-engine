import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  preparePrivateKwImportFile,
  resolvePrivateKwDataPath,
} from "./prepare-private-kw-import";

test("private KW import paths stay in ignored evaluation storage", () => {
  const input = resolvePrivateKwDataPath("data/kw-evaluation/input.json");
  assert.match(input.replaceAll("\\", "/"), /\/data\/kw-evaluation\/input\.json$/);
  assert.throws(() => resolvePrivateKwDataPath("docs/prospects.json"), /must stay inside/);
  assert.throws(() => resolvePrivateKwDataPath("data/kw-evaluation/../../prospects.json"), /must stay inside/);
  assert.throws(() => resolvePrivateKwDataPath("data/kw-evaluation/input.csv"), /\.json extension/);
  assert.throws(() => resolvePrivateKwDataPath("data/kw-evaluation.json"), /must stay inside/);
  assert.throws(() => resolvePrivateKwDataPath("data/kw-evaluation/nested/input.json"), /direct children/);
});

test("the private CLI creates one ignored plan and refuses to overwrite it", async () => {
  const suffix = randomUUID();
  const inputRelative = `data/kw-evaluation/test-input-${suffix}.json`;
  const outputRelative = `data/kw-evaluation/test-plan-${suffix}.json`;
  const input = resolvePrivateKwDataPath(inputRelative);
  const output = resolvePrivateKwDataPath(outputRelative);
  const fixture = {
    importVersion: "kw-private-seed-v1",
    importId: `test-${suffix}`,
    adapter: "MANUAL_RESEARCH",
    queryText: "Synthetic import test only",
    filters: { synthetic: true },
    capturedAt: "2026-08-22T19:00:00.000Z",
    costUsd: 0,
    records: [{
      sourceOwnedId: "synthetic-1",
      sourceEvidenceUrl: "https://example.com/source/1",
      businessName: "Synthetic Roofing QA",
      city: "KITCHENER",
      region: "ON",
      country: "CA",
      niche: "ROOFING",
      websiteUrl: "https://example.com",
      phone: null,
      addressLine: null,
      postalCode: null,
      independenceStatus: "UNKNOWN",
      capturedAt: "2026-08-22T18:55:00.000Z",
      sourcePayload: { synthetic: true },
    }],
  };

  try {
    await mkdir(path.dirname(input), { recursive: true });
    await writeFile(input, `${JSON.stringify(fixture)}\n`, { encoding: "utf8", flag: "wx" });
    const result = await preparePrivateKwImportFile(["--input", inputRelative, "--output", outputRelative]);
    assert.equal(result.summary.loaded, 1);
    assert.equal(result.summary.outreachAuthorized, false);
    const saved = JSON.parse(await readFile(output, "utf8")) as { summary: { providerCallsMade: number } };
    assert.equal(saved.summary.providerCallsMade, 0);
    await assert.rejects(
      preparePrivateKwImportFile(["--input", inputRelative, "--output", outputRelative]),
      /EEXIST/,
    );
  } finally {
    await rm(input, { force: true });
    await rm(output, { force: true });
  }
});
