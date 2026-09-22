import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { getCloudflareBindings } from "@/lib/cloudflare";
import { LocalM2OwnerConsoleSchema, type LocalM2OwnerConsoleResult } from "./m2-owner-console-contract";
export type { LocalM2OwnerConsoleResult } from "./m2-owner-console-contract";

const execute = promisify(execFile);
const RUN_PATH = /^data\/kw-evaluation\/[A-Za-z0-9._-]+\.json$/;

/** Server-only local bridge. The authenticated page calls this; the browser supplies no paths,
 * report JSON, commands or approvals. Cloudflare/D1 never adopts a local SQLite capability. */
export async function readLocalM2OwnerConsole(): Promise<LocalM2OwnerConsoleResult> {
  if (getCloudflareBindings() !== null || process.env.AXIOM_M2_LOCAL_REVIEW_ENABLED !== "1") {
    return { status: "UNAVAILABLE", reason: "Local M2 review is not enabled on this server." };
  }
  const runPath = process.env.AXIOM_M2_LOCAL_REVIEW_RUN;
  if (!runPath || !RUN_PATH.test(runPath)) {
    return { status: "UNAVAILABLE", reason: "A valid local M2 run has not been configured." };
  }
  try {
    const { stdout } = await execute(process.execPath, ["--import", "tsx",
      path.join(process.cwd(), "scripts", "execute-private-kw-m2-html-assessment.ts"), runPath, "--inspect"],
    { cwd: process.cwd(), windowsHide: true, timeout: 120_000, maxBuffer: 8 * 1024 * 1024, encoding: "utf8" });
    return LocalM2OwnerConsoleSchema.parse(JSON.parse(stdout));
  } catch {
    return { status: "UNAVAILABLE", reason: "The local evidence could not be verified. Check the configured run, saved evidence and operation lock before retrying." };
  }
}
