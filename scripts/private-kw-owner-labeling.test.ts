import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCompletePrivateKwOwnerLabelingCohort,
  preparePrivateKwOwnerLabelingFile,
} from "./prepare-private-kw-owner-labeling";
import { recordPrivateKwOwnerLabelsFile } from "./record-private-kw-owner-labels";

test("owner-labeling preparation keeps source, database, and output in separate ignored local files", async () => {
  await assert.rejects(
    () => preparePrivateKwOwnerLabelingFile([
      "--source-plan", "data/kw-evaluation/owner-labeling.json",
      "--database", "data/kw-evaluation/shadow.sqlite",
      "--output", "data/kw-evaluation/owner-labeling.json",
    ]),
    /must be different files/i,
  );
  await assert.rejects(
    () => preparePrivateKwOwnerLabelingFile([
      "--source-plan", "data/kw-evaluation/../../source.json",
      "--database", "data/kw-evaluation/shadow.sqlite",
      "--output", "data/kw-evaluation/owner-labeling.json",
    ]),
    /must stay inside/i,
  );
});

test("owner-label checkpointing requires three distinct ignored JSON files", async () => {
  await assert.rejects(
    () => recordPrivateKwOwnerLabelsFile([
      "--packet", "data/kw-evaluation/owner-labeling.json",
      "--reviews", "data/kw-evaluation/owner-labeling.json",
      "--output", "data/kw-evaluation/owner-labeling-next.json",
    ]),
    /must be different files/i,
  );
  await assert.rejects(
    () => recordPrivateKwOwnerLabelsFile([
      "--packet", "data/kw-evaluation/owner-labeling.json",
      "--reviews", "data/kw-evaluation/owner-reviews.txt",
      "--output", "data/kw-evaluation/owner-labeling-next.json",
    ]),
    /\.json extension/i,
  );
});

test("owner-label commands reject missing, duplicate, and invented arguments before file access", async () => {
  await assert.rejects(
    () => preparePrivateKwOwnerLabelingFile(["--source-plan", "data/kw-evaluation/plan.json"]),
    /exactly --source-plan, --database, and --output/i,
  );
  await assert.rejects(
    () => recordPrivateKwOwnerLabelsFile([
      "--packet", "data/kw-evaluation/owner-labeling.json",
      "--packet", "data/kw-evaluation/other.json",
      "--output", "data/kw-evaluation/owner-labeling-next.json",
    ]),
    /duplicate argument/i,
  );
});

test("owner decisions cannot begin until the fixed 50-business cohort has one exact assessment each", () => {
  assert.throws(() => assertCompletePrivateKwOwnerLabelingCohort(49, 49), /fixed 50-business source cohort/i);
  assert.throws(() => assertCompletePrivateKwOwnerLabelingCohort(50, 49), /one current exact assessment for all 50/i);
  assert.doesNotThrow(() => assertCompletePrivateKwOwnerLabelingCohort(50, 50));
});
