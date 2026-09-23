import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { getCloudflareBindings } from "@/lib/cloudflare";

import { businessDisplayName } from "./engine-site-capture";

export type EngineProspect = { key: string; name: string; websiteUrl: string; city: string; niche: string; reasons: string[] };
export type EngineRunReview =
  | { status: "READY"; finishedAt: string; source: string; counts: Record<string, number>; prospects: EngineProspect[] }
  | { status: "NONE" };

const RUNS_DIR = path.join("data", "kw-evaluation", "engine-runs");

/** Local-only: the newest engine run's prospects. Display only; grants no contact authority. */
export async function readLatestEngineRun(root = process.cwd()): Promise<EngineRunReview> {
  if (getCloudflareBindings() !== null) return { status: "NONE" };
  try {
    const dir = path.join(root, RUNS_DIR);
    const latest = (await readdir(dir)).filter((name) => /^run-[\w-]+\.json$/.test(name)).sort().at(-1);
    if (!latest) return { status: "NONE" };
    const run = JSON.parse(await readFile(path.join(dir, latest), "utf8")) as {
      finishedAt: string; source: string; counts: Record<string, number>;
      results: { placeId: string; label: string; name: string | null; siteName?: string | null; websiteUrl: string | null; city: string; niche: string; reasons: string[] }[];
    };
    const prospects = run.results.filter((result) => result.label === "STRONG" && result.websiteUrl).map((result) => ({
      key: result.placeId, name: businessDisplayName(result.websiteUrl!, result.name, result.siteName),
      websiteUrl: result.websiteUrl!, city: result.city, niche: result.niche, reasons: result.reasons,
    }));
    return { status: "READY", finishedAt: run.finishedAt, source: run.source, counts: run.counts, prospects };
  } catch {
    return { status: "NONE" };
  }
}
