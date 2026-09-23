import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { classifyEngineLead, ENGINE_LEAD_RULES_VERSION, evaluationSplit } from "../src/lib/revenue-engine/engine-lead-rules";
import type { EngineSiteSignals } from "../src/lib/revenue-engine/engine-site-capture";

type Row = { reviewId: string; answerLabel: "STRONG" | "WEAK" | "WRONG"; engineLabel: string; signals: EngineSiteSignals | null };

/** Grades the v5 rule experiment on the latest saved capture, split into tuning and holdout. */
export async function regradeEngineLeadRules(currentYear = new Date().getUTCFullYear()) {
  const dir = path.join("data", "kw-evaluation");
  const latest = (await readdir(dir)).filter((name) => /^engine-grade-.*\.json$/.test(name)).sort().at(-1);
  if (!latest) throw new Error("Run scripts/grade-engine-website-check.ts first.");
  const grade = JSON.parse(await readFile(path.join(dir, latest), "utf8")) as { rows: (Row & { signals: EngineSiteSignals | null })[] };
  const rows = grade.rows.map((row) => {
    const v5 = row.signals ? classifyEngineLead(row.signals.finalUrl, row.signals, currentYear) : { label: "NOT_CHECKED" as const, reasons: [] };
    return { reviewId: row.reviewId, split: evaluationSplit(row.reviewId), answer: row.answerLabel, v4: row.engineLabel, v5: v5.label, reasons: v5.reasons };
  });
  const score = (subset: typeof rows, key: "v4" | "v5") => {
    const checked = subset.filter((row) => row[key] !== "NOT_CHECKED");
    const agree = checked.filter((row) => row[key] === row.answer).length;
    const perClass = (["STRONG", "WEAK", "WRONG"] as const).map((label) => {
      const actual = checked.filter((row) => row.answer === label).length;
      const predicted = checked.filter((row) => row[key] === label).length;
      const hit = checked.filter((row) => row.answer === label && row[key] === label).length;
      return { label, actual, predicted, hit };
    });
    return { agree, checked: checked.length, notChecked: subset.length - checked.length, perClass };
  };
  const tune = rows.filter((row) => row.split === "TUNE");
  const holdout = rows.filter((row) => row.split === "HOLDOUT");
  return {
    rulesVersion: ENGINE_LEAD_RULES_VERSION, capture: latest,
    holdoutCaveat: "The v5 author saw all 50 captured signal rows before writing the rules, so the holdout is not pristine.",
    v4: { tune: score(tune, "v4"), holdout: score(holdout, "v4") },
    v5: { tune: score(tune, "v5"), holdout: score(holdout, "v5") },
    misses: rows.filter((row) => row.v5 !== row.answer && row.v5 !== "NOT_CHECKED").map(({ reviewId, split, answer, v5 }) => ({ reviewId, split, answer, v5 })),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  regradeEngineLeadRules().then((result) => console.log(JSON.stringify(result, null, 1))).catch((error) => { console.error(error); process.exitCode = 1; });
}
