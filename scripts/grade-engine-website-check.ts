import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

import { captureAndAuditSite, ENGINE_SITE_CAPTURE_VERSION } from "../src/lib/revenue-engine/engine-site-capture";
import { buildM3Evaluation } from "./summarize-m3-evaluation";

/**
 * Runs the automatic website check on every answer-key business and grades it.
 * Local only: one desktop and one phone homepage view per business, no forms,
 * no provider accounts, no spend. Only derived results are written.
 */
export async function gradeEngineWebsiteCheck() {
  const { cases } = await buildM3Evaluation();
  const browser = await chromium.launch();
  const rows = [];
  try {
    for (const item of cases) {
      const capture = await captureAndAuditSite(browser, {
        businessId: item.reviewId, businessName: item.businessName, niche: item.niche, websiteUrl: item.assessment.approvedWebsiteUrl,
      }).catch((error: unknown) => ({ status: "ERROR" as const, reason: error instanceof Error ? error.message.split("\n")[0]!.slice(0, 200) : "capture failed" }));
      // An unreachable or failed capture is "could not check", never evidence of rebuild need.
      const engineNeed = capture.status === "CAPTURED" ? capture.audit.classification : "NOT_CHECKED";
      rows.push({
        reviewId: item.reviewId, city: item.city, niche: item.niche,
        answerNeed: item.assessment.websiteNeed, answerLabel: item.reviewerLabel,
        engineNeed, engineLabel: engineNeed === "REBUILD" ? "STRONG" : engineNeed === "NOT_CHECKED" ? "NOT_CHECKED" : "WEAK",
        rebuildNeedScore: capture.status === "CAPTURED" ? capture.audit.rebuildNeedScore : null,
        failedChecks: capture.status !== "CAPTURED" ? [] : capture.audit.checks.filter((check) => check.outcome === "FAIL").map((check) => check.checkId),
        signals: capture.status === "CAPTURED" ? capture.signals : null,
        reason: capture.status === "CAPTURED" ? null : capture.reason,
      });
      process.stderr.write(`${item.reviewId} ${engineNeed}\n`);
    }
  } finally { await browser.close(); }
  const agree = rows.filter((row) => row.engineLabel === row.answerLabel).length;
  const strong = rows.filter((row) => row.answerLabel === "STRONG");
  const flagged = rows.filter((row) => row.engineLabel === "STRONG");
  const result = {
    gradeVersion: "engine-website-check-grade-v1", captureVersion: ENGINE_SITE_CAPTURE_VERSION, gradedAt: new Date().toISOString(),
    total: rows.length,
    labelAgreement: { agree, total: rows.length, percent: Math.round((agree / rows.length) * 100) },
    strong: { answerKey: strong.length, flaggedByEngine: flagged.length, caught: strong.filter((row) => row.engineLabel === "STRONG").length },
    engineNeed: rows.reduce<Record<string, number>>((acc, row) => { acc[row.engineNeed] = (acc[row.engineNeed] ?? 0) + 1; return acc; }, {}),
    rows,
  };
  const out = path.join("data", "kw-evaluation", `engine-grade-${result.gradedAt.replace(/[:.]/g, "-")}.json`);
  await writeFile(out, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  return { out, ...result, rows: undefined };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  gradeEngineWebsiteCheck()
    .then((summary) => console.log(JSON.stringify(summary, null, 2)))
    .catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
