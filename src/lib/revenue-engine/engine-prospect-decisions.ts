import { randomUUID } from "node:crypto";
import { link, mkdir, open, readdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

/**
 * An owner's call on one engine prospect. Append-only: a later decision for the
 * same website supersedes an earlier one, and nothing is ever edited in place.
 * These decisions are the owners' labels for re-grading the engine. They grant
 * no contact authority.
 */
export const ENGINE_PROSPECT_DECISION_VERSION = "engine-prospect-decision-v1" as const;
export const ENGINE_DECISIONS_DIR = path.join("data", "kw-evaluation", "engine-decisions");

const ReasonSchema = z.enum(["WEBSITE_ALREADY_FINE", "NOT_LOCAL_OR_CHAIN", "WRONG_TRADE", "ALREADY_A_CUSTOMER_OR_CONTACTED", "OTHER"]).nullable();

export const ProspectDecisionCommandSchema = z.object({
  commandId: z.string().uuid(),
  websiteUrl: z.string().url().max(300),
  decision: z.enum(["WORTH_A_CALL", "NOT_A_FIT"]),
  reason: ReasonSchema,
}).strict().superRefine((value, ctx) => {
  if (value.decision === "NOT_A_FIT" && value.reason === null) ctx.addIssue({ code: "custom", path: ["reason"], message: "Say why it is not a fit." });
  if (value.decision === "WORTH_A_CALL" && value.reason !== null) ctx.addIssue({ code: "custom", path: ["reason"], message: "A worth-a-call decision has no rejection reason." });
});
export type ProspectDecisionCommand = z.infer<typeof ProspectDecisionCommandSchema>;

export const ProspectDecisionSchema = z.object({
  version: z.literal(ENGINE_PROSPECT_DECISION_VERSION),
  commandId: z.string().uuid(),
  websiteKey: z.string().min(1).max(253),
  websiteUrl: z.string().url(),
  decision: z.enum(["WORTH_A_CALL", "NOT_A_FIT"]),
  reason: ReasonSchema,
  decidedBy: z.enum(["RILEY", "AIDAN"]),
  decidedAt: z.string().datetime({ offset: true }),
  contactAuthorized: z.literal(false),
}).strict();
export type ProspectDecision = z.infer<typeof ProspectDecisionSchema>;

export function websiteKey(url: string) {
  return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
}

/** The newest decision per website. */
export function latestProspectDecisions(decisions: ProspectDecision[]) {
  const latest = new Map<string, ProspectDecision>();
  for (const decision of [...decisions].sort((left, right) => Date.parse(left.decidedAt) - Date.parse(right.decidedAt))) latest.set(decision.websiteKey, decision);
  return latest;
}

export async function listProspectDecisions(root = process.cwd()): Promise<ProspectDecision[]> {
  const dir = path.join(root, ENGINE_DECISIONS_DIR);
  let names: string[];
  try { names = await readdir(dir); } catch { return []; }
  const decisions: ProspectDecision[] = [];
  for (const name of names.filter((entry) => /^[a-z0-9.-]+-[0-9a-f-]{36}\.json$/.test(entry))) {
    decisions.push(ProspectDecisionSchema.parse(JSON.parse(await readFile(path.join(dir, name), "utf8"))));
  }
  return decisions;
}

export async function saveProspectDecision(
  commandInput: unknown,
  decidedBy: "RILEY" | "AIDAN",
  options: { root?: string; now?: () => Date } = {},
): Promise<{ status: "SAVED" | "ALREADY_SAVED"; decision: ProspectDecision }> {
  const command = ProspectDecisionCommandSchema.parse(commandInput);
  const root = options.root ?? process.cwd();
  const existing = (await listProspectDecisions(root)).find((decision) => decision.commandId === command.commandId);
  if (existing) {
    if (existing.websiteUrl !== command.websiteUrl || existing.decision !== command.decision || existing.reason !== command.reason || existing.decidedBy !== decidedBy) {
      throw new Error("This retry key already belongs to a different decision.");
    }
    return { status: "ALREADY_SAVED", decision: existing };
  }
  const decision = ProspectDecisionSchema.parse({
    version: ENGINE_PROSPECT_DECISION_VERSION, commandId: command.commandId, websiteKey: websiteKey(command.websiteUrl),
    websiteUrl: command.websiteUrl, decision: command.decision, reason: command.reason, decidedBy,
    decidedAt: (options.now?.() ?? new Date()).toISOString(), contactAuthorized: false,
  });
  const dir = path.join(root, ENGINE_DECISIONS_DIR);
  await mkdir(dir, { recursive: true });
  const temp = path.join(dir, `.decision-${randomUUID()}.partial`);
  const handle = await open(temp, "wx", 0o600);
  try { await handle.writeFile(`${JSON.stringify(decision, null, 2)}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
  try { await link(temp, path.join(dir, `${decision.websiteKey}-${decision.commandId}.json`)); } finally { await unlink(temp).catch(() => undefined); }
  return { status: "SAVED", decision };
}
