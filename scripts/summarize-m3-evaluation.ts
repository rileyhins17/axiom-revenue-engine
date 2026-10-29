import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { currentM2WebsiteNeedAssessments, listM2WebsiteNeedAssessments } from "../src/lib/revenue-engine/m2-website-need-local-store";
import { M3ReviewerLabelsSchema, parseM3Selection, summarizeM3Evaluation, type M3Case } from "../src/lib/revenue-engine/m3-website-need-evaluation";
import { currentM2Targets, M3_SELECTION_PATH } from "./record-m2-website-need";

const DATA = path.join("data", "kw-evaluation");
const M2_MANIFEST = path.join(DATA, "m2-codex-delegated-manifest-2026-09-23.json");
const LABELS = path.join(DATA, "m3-reviewer-labels-2026-09-23.json");

/** Builds the fixed 50-case evaluation from sealed assessments and the reviewer labels. */
export async function buildM3Evaluation() {
  const targets = await currentM2Targets();
  const current = currentM2WebsiteNeedAssessments(await listM2WebsiteNeedAssessments(), targets);
  const labels = M3ReviewerLabelsSchema.parse(JSON.parse(await readFile(LABELS, "utf8")));
  const selection = parseM3Selection(await readFile(M3_SELECTION_PATH));
  const manifest = JSON.parse(await readFile(M2_MANIFEST, "utf8")) as { records: { businessName: string; city: M3Case["city"]; niche: M3Case["niche"] }[] };
  const place = new Map<string, { city: M3Case["city"]; niche: M3Case["niche"] }>([
    ...manifest.records.map((record) => [record.businessName, { city: record.city, niche: record.niche }] as const),
    ...selection.entries.map((entry) => [entry.businessName, { city: entry.city, niche: entry.niche }] as const),
  ]);
  const cases: M3Case[] = targets.map((target) => {
    const assessment = current.get(target.reviewId);
    const label = labels.labels[target.reviewId];
    const location = place.get(target.businessName);
    if (!assessment || !label || !location) throw new Error(`${target.reviewId} is missing an assessment, label or location.`);
    return { reviewId: target.reviewId, businessName: target.businessName, ...location, assessment, reviewerLabel: label.label };
  });
  return { summary: summarizeM3Evaluation(cases), cases };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildM3Evaluation()
    .then(({ summary }) => console.log(JSON.stringify(summary, null, 2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "The M3 evaluation could not be built.");
      process.exitCode = 1;
    });
}
