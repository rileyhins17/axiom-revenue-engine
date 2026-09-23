import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";

import type { M2ManualWebsiteObservationTarget } from "./m2-manual-website-observation";
import {
  buildM2WebsiteNeedAssessment,
  M2WebsiteNeedCommandSchema,
  verifyM2WebsiteNeedAssessment,
  type M2WebsiteNeedAssessment,
} from "./m2-website-need-assessment";

export const M2_WEBSITE_NEED_DEFAULT_ROOT = path.join(process.cwd(), "data", "kw-evaluation", "m2-website-need");
const MAX_RECORD_BYTES = 32_768;
const FILENAME = /^(M2-(?:0[1-9]|10))-([a-f0-9]{64})\.json$/;

async function safeRoot(rootDir: string) {
  await mkdir(rootDir, { recursive: true });
  const root = await lstat(rootDir);
  if (root.isSymbolicLink() || !root.isDirectory()) throw new Error("Private website-need storage is unsafe.");
}

/** Reads every sealed assessment; any tampered, renamed or unsupported record stops the read. */
export async function listM2WebsiteNeedAssessments(rootDir = M2_WEBSITE_NEED_DEFAULT_ROOT): Promise<M2WebsiteNeedAssessment[]> {
  await safeRoot(rootDir);
  const records: M2WebsiteNeedAssessment[] = [];
  for (const name of (await readdir(rootDir)).filter((entry) => entry.endsWith(".json")).sort()) {
    const match = FILENAME.exec(name);
    if (!match) throw new Error("A malformed website-need filename exists.");
    const file = path.join(rootDir, name);
    const info = await lstat(file);
    if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_RECORD_BYTES) throw new Error("A website-need record is unsafe or oversized.");
    const record = verifyM2WebsiteNeedAssessment(JSON.parse(await readFile(file, "utf8")) as unknown);
    if (record.reviewId !== match[1] || record.assessmentId !== `m2-website-need:${match[2]}`) {
      throw new Error("A website-need record does not match its filename.");
    }
    records.push(record);
  }
  return records.sort((left, right) => left.reviewId.localeCompare(right.reviewId, "en") || Date.parse(right.assessedAt) - Date.parse(left.assessedAt));
}

/** The newest assessment per business that still matches the current saved identity. */
export function currentM2WebsiteNeedAssessments(records: M2WebsiteNeedAssessment[], targets: M2ManualWebsiteObservationTarget[]) {
  const current = new Map<string, M2WebsiteNeedAssessment>();
  for (const target of targets) {
    const matching = records
      .filter((record) => record.reviewId === target.reviewId && record.businessIdentityDigest === target.businessIdentityDigest)
      .sort((left, right) => Date.parse(right.assessedAt) - Date.parse(left.assessedAt));
    if (matching[0]) current.set(target.reviewId, matching[0]);
  }
  return current;
}

export async function saveM2WebsiteNeedAssessment(
  commandInput: unknown,
  target: M2ManualWebsiteObservationTarget,
  options: { rootDir?: string; clock?: () => Date } = {},
): Promise<{ status: "SAVED" | "ALREADY_SAVED"; assessment: M2WebsiteNeedAssessment }> {
  const command = M2WebsiteNeedCommandSchema.parse(commandInput);
  const rootDir = path.resolve(options.rootDir ?? M2_WEBSITE_NEED_DEFAULT_ROOT);
  const prior = (await listM2WebsiteNeedAssessments(rootDir)).find((record) => record.commandId === command.commandId);
  if (prior) {
    const { noCopiedOrPersonalData: _declared, ...content } = command;
    void _declared;
    const same = prior.reviewId === target.reviewId && prior.businessIdentityDigest === target.businessIdentityDigest
      && Object.entries(content).every(([key, value]) => JSON.stringify(prior[key as keyof M2WebsiteNeedAssessment]) === JSON.stringify(value));
    if (!same) throw new Error("This command ID already belongs to a different website-need assessment.");
    return { status: "ALREADY_SAVED", assessment: prior };
  }
  const now = options.clock?.() ?? new Date();
  const assessment = buildM2WebsiteNeedAssessment(command, target, now.toISOString());
  const destination = path.join(rootDir, `${assessment.reviewId}-${assessment.assessmentId.slice("m2-website-need:".length)}.json`);
  const temp = path.join(rootDir, `.website-need-${randomUUID()}.partial`);
  const handle = await open(temp, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(assessment, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally { await handle.close(); }
  try {
    await link(temp, destination);
  } finally {
    await unlink(temp).catch(() => undefined);
  }
  return { status: "SAVED", assessment };
}
