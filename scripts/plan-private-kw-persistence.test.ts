import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  PRIVATE_KW_IMPORT_VERSION,
  preparePrivateKwImport,
} from "../src/lib/revenue-engine/private-kw-import";
import {
  resolvePrivateKwDataPath,
} from "./private-kw-files";
import {
  planPrivateKwPersistenceFile,
} from "./plan-private-kw-persistence";

test("persistence CLI writes a validation-only ignored plan and never overwrites", async () => {
  const suffix = randomUUID();
  const inputRelative = `data/kw-evaluation/test-source-plan-${suffix}.json`;
  const outputRelative = `data/kw-evaluation/test-persistence-plan-${suffix}.json`;
  const input = resolvePrivateKwDataPath(inputRelative);
  const output = resolvePrivateKwDataPath(outputRelative);
  const source = preparePrivateKwImport({
    importVersion: PRIVATE_KW_IMPORT_VERSION,
    importId: `test-persistence-${suffix}`,
    adapter: "MANUAL_RESEARCH",
    queryText: "Synthetic persistence CLI fixture",
    filters: { synthetic: true },
    capturedAt: "2026-08-22T21:00:00.000Z",
    costUsd: 0,
    records: [{
      sourceOwnedId: "synthetic-1",
      sourceEvidenceUrl: "https://example.com/source/1",
      businessName: "Synthetic Landscape QA",
      city: "CAMBRIDGE",
      region: "ON",
      country: "CA",
      niche: "LANDSCAPING",
      websiteUrl: null,
      phone: null,
      addressLine: null,
      postalCode: null,
      independenceStatus: "UNKNOWN",
      capturedAt: "2026-08-22T20:55:00.000Z",
      sourcePayload: { synthetic: true },
    }],
  });

  try {
    await mkdir(path.dirname(input), { recursive: true });
    await writeFile(input, `${JSON.stringify(source)}\n`, { encoding: "utf8", flag: "wx" });
    const result = await planPrivateKwPersistenceFile(["--input", inputRelative, "--output", outputRelative]);
    assert.equal(result.mutationAuthorized, false);
    assert.equal(result.summary.totalStatements, 4);
    const saved = JSON.parse(await readFile(output, "utf8")) as {
      mutationAuthorized: boolean;
      summary: { qualificationRows: number; outreachRows: number };
    };
    assert.equal(saved.mutationAuthorized, false);
    assert.equal(saved.summary.qualificationRows, 0);
    assert.equal(saved.summary.outreachRows, 0);
    await assert.rejects(
      planPrivateKwPersistenceFile(["--input", inputRelative, "--output", outputRelative]),
      /EEXIST/,
    );
  } finally {
    await rm(input, { force: true });
    await rm(output, { force: true });
  }
});
