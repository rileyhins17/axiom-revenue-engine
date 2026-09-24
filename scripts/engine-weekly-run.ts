import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { z } from "zod";

import { classifyEngineLead, ENGINE_LEAD_RULES_VERSION } from "../src/lib/revenue-engine/engine-lead-rules";
import { captureAndAuditSite, ENGINE_SITE_CAPTURE_VERSION } from "../src/lib/revenue-engine/engine-site-capture";
import {
  discoverBusinesses, DiscoveryCitySchema, DiscoveryNicheSchema, PLACES_DISCOVERY_VERSION,
  type DiscoveredBusiness, type PlacesTransport, type PlacesUsageLedger,
} from "../src/lib/revenue-engine/places-discovery";

/**
 * The engine's weekly loop: discover -> check each website -> sort -> short list.
 * No contact, form, email, provider write or deployment happens here. The owner
 * list stores only derived website findings plus the Places ID.
 *
 *   npx tsx scripts/engine-weekly-run.ts --places            (needs the owner-created key)
 *   npx tsx scripts/engine-weekly-run.ts --candidates <file> (offline input for testing the loop)
 */
export const ENGINE_RUNS_DIR = path.join("data", "kw-evaluation", "engine-runs");
const LEDGER_PATH = path.join("data", "kw-evaluation", "places-usage-ledger.json");
const CELLS = DiscoveryCitySchema.options.flatMap((city) => DiscoveryNicheSchema.options.map((niche) => ({ city, niche })));
const CandidateFileSchema = z.object({ candidates: z.array(z.object({
  websiteUrl: z.string().url(), city: DiscoveryCitySchema, niche: DiscoveryNicheSchema,
}).passthrough()).max(200) }).passthrough();

const fetchTransport: PlacesTransport = async (request) => {
  const response = await fetch(request.url, { method: "POST", headers: request.headers, body: request.body, signal: AbortSignal.timeout(15_000) });
  return { status: response.status, json: await response.json().catch(() => null) };
};

async function readLedger(): Promise<PlacesUsageLedger> {
  try { return JSON.parse(await readFile(LEDGER_PATH, "utf8")) as PlacesUsageLedger; }
  catch { return { month: "", requests: 0 }; }
}

/** Loads the ignored local env file when present; values are never printed. */
function loadLocalEnv() {
  try { process.loadEnvFile(".env.local"); } catch { /* No local env file; discovery stays off. */ }
}

export async function engineWeeklyRun(args: string[], env = process.env) {
  let source: string;
  let discovered: DiscoveredBusiness[];
  let discovery: Record<string, unknown> = {};
  if (args[0] === "--places" && args.length === 1) {
    const result = await discoverBusinesses({
      apiKey: env.AXIOM_GOOGLE_PLACES_KEY?.trim() || undefined, enabled: env.AXIOM_PLACES_DISCOVERY_ENABLED?.trim() === "1", cells: CELLS, transport: fetchTransport,
      ledger: await readLedger(), saveLedger: (ledger) => writeFile(LEDGER_PATH, JSON.stringify(ledger) + "\n"),
    });
    source = PLACES_DISCOVERY_VERSION;
    discovered = result.businesses;
    discovery = { requestsThisRun: result.requestsThisRun, monthRequests: result.ledger.requests, worstCaseUsdThisRun: result.worstCaseUsdThisRun, stops: result.stops };
  } else if (args[0] === "--candidates" && args.length === 2) {
    const file = CandidateFileSchema.parse(JSON.parse(await readFile(args[1]!, "utf8")));
    source = `candidate-file:${path.basename(args[1]!)}`;
    discovered = file.candidates.map((candidate, index) => ({ placeId: `offline-${index}`, city: candidate.city, niche: candidate.niche, websiteUrl: candidate.websiteUrl, displayName: "", addressMentionsCity: false }));
  } else {
    throw new Error("Usage: engine-weekly-run --places | --candidates <file.json>");
  }

  const startedAt = new Date();
  type RunResult = {
    placeId: string; city: string; niche: string; websiteUrl: string | null; name: string | null; siteName?: string | null;
    label: "STRONG" | "WEAK" | "WRONG" | "NO_WEBSITE" | "NOT_CHECKED"; reasons: string[]; codes?: string[];
    auditClassification?: string; capturedAt?: string;
  };
  const results: RunResult[] = [];
  const browser = await chromium.launch();
  try {
    for (const business of discovered) {
      if (!business.websiteUrl) {
        results.push({ placeId: business.placeId, city: business.city, niche: business.niche, websiteUrl: null, name: null, label: "NO_WEBSITE" as const, reasons: ["No website listed; a possible new-build lead that needs manual research."] });
        continue;
      }
      const capture = await captureAndAuditSite(browser, { businessId: business.placeId, businessName: business.placeId, niche: business.niche, websiteUrl: business.websiteUrl })
        .catch(() => null);
      if (!capture || capture.status !== "CAPTURED") {
        results.push({ placeId: business.placeId, city: business.city, niche: business.niche, websiteUrl: business.websiteUrl, name: null, label: "NOT_CHECKED" as const, reasons: ["The website could not be loaded automatically."] });
        continue;
      }
      const decision = classifyEngineLead(business.websiteUrl, capture.signals, startedAt.getUTCFullYear());
      results.push({
        placeId: business.placeId, city: business.city, niche: business.niche, websiteUrl: capture.signals.finalUrl,
        name: capture.signals.siteTitle ?? null, siteName: capture.signals.siteName ?? null, label: decision.label, reasons: decision.reasons, codes: decision.codes,
        auditClassification: capture.audit.classification, capturedAt: capture.audit.capturedAt,
      });
    }
  } finally { await browser.close(); }

  const count = (label: string) => results.filter((result) => result.label === label).length;
  const run = {
    runVersion: "engine-weekly-run-v1", startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(),
    source, discovery, versions: { capture: ENGINE_SITE_CAPTURE_VERSION, rules: ENGINE_LEAD_RULES_VERSION },
    counts: { discovered: discovered.length, prospects: count("STRONG"), fine: count("WEAK"), notTargets: count("WRONG"), noWebsite: count("NO_WEBSITE"), notChecked: count("NOT_CHECKED") },
    authority: { contactAuthorized: false, outreachAuthorized: false, sendAuthorized: false },
    results,
  };
  await mkdir(ENGINE_RUNS_DIR, { recursive: true });
  const out = path.join(ENGINE_RUNS_DIR, `run-${run.startedAt.replace(/[:.]/g, "-")}.json`);
  await writeFile(out, JSON.stringify(run, null, 2) + "\n", { flag: "wx" });
  return { out, counts: run.counts, discovery };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadLocalEnv();
  engineWeeklyRun(process.argv.slice(2))
    .then((summary) => console.log(JSON.stringify(summary, null, 2)))
    .catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
