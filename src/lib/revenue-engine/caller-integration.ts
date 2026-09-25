import { z } from "zod";

import { nextInQueue, recordProspectActivity, type ProspectDb, type ProspectOutcome, type ProspectRow } from "./engine-prospects-d1";

/**
 * Bridge to the Axiom Caller browser extension (github.com/Mageester/axiom-caller).
 * The extension pulls callable businesses in its own LeadInput shape and posts each
 * saved call back, which lands in the same append-only call log as the app.
 */
export type CallerActor = { actor: "RILEY" | "AIDAN"; actorUserId: string };

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createCallerToken(db: ProspectDb, owner: CallerActor, label: string) {
  const token = `axc_${[...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  await db.prepare(`INSERT INTO "CallerToken" ("tokenHash","actor","actorUserId","label") VALUES (?,?,?,?)`)
    .bind(await sha256(token), owner.actor, owner.actorUserId, label.trim().slice(0, 80) || "Axiom Caller").run();
  return token;
}

export async function listCallerTokens(db: ProspectDb, actor: "RILEY" | "AIDAN") {
  return (await db.prepare(`SELECT substr("tokenHash",1,8) AS id, "label", "createdAt", "lastUsedAt", "revokedAt" FROM "CallerToken" WHERE "actor" = ? ORDER BY "createdAt" DESC LIMIT 20`)
    .bind(actor).all<{ id: string; label: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }>()).results;
}

export async function revokeCallerToken(db: ProspectDb, actor: "RILEY" | "AIDAN", id: string) {
  if (!/^[0-9a-f]{8}$/.test(id)) return;
  await db.prepare(`UPDATE "CallerToken" SET "revokedAt" = COALESCE("revokedAt", ?) WHERE "actor" = ? AND substr("tokenHash",1,8) = ?`).bind(new Date().toISOString(), actor, id).run();
}

export async function authenticateCaller(db: ProspectDb, authorization: string | null): Promise<CallerActor | null> {
  const token = authorization?.match(/^Bearer\s+(axc_[0-9a-f]{64})$/i)?.[1];
  if (!token) return null;
  const hash = await sha256(token);
  const row = await db.prepare(`SELECT "actor","actorUserId" FROM "CallerToken" WHERE "tokenHash" = ? AND "revokedAt" IS NULL`).bind(hash).first<CallerActor>();
  if (!row) return null;
  await db.prepare(`UPDATE "CallerToken" SET "lastUsedAt" = ? WHERE "tokenHash" = ?`).bind(new Date().toISOString(), hash).run();
  return row;
}

const title = (value: string) => value === "HVAC" ? value : value.charAt(0) + value.slice(1).toLowerCase();

/** One business in the extension's LeadInput shape, plus the engine id it must send back. */
export function toCallerLead(row: ProspectRow) {
  const problems = row.label === "NO_WEBSITE" ? ["No website listed on Google."] : row.reasons.slice(0, 3);
  return {
    engineProspectId: row.prospectId,
    businessName: row.name, phone: row.phone!, website: row.websiteUrl, address: row.address, city: title(row.city), category: title(row.niche),
    callGoal: [
      "Call objective: Book a 15-minute look at a free mock-up of a phone-friendly website. Do not promise results.",
      `Problem observed: ${problems.join(" ")}`,
      row.followUpAt ? `Follow-up due ${row.followUpAt}; last result: ${row.lastOutcome ?? "none"}.` : null,
      "Evidence sources: Axiom Revenue Engine website check.",
    ].filter(Boolean).join("\n"),
    isFixture: false,
  };
}

/** The next callable businesses in queue order (follow-ups first), skipping anyone touched today. */
export async function callerLeads(db: ProspectDb, today: string, dayStart: string, limit: number) {
  const { rows } = await nextInQueue(db, today, dayStart, [], limit);
  return rows.filter((row) => row.phone).map(toCallerLead);
}

export const CallerResultSchema = z.object({
  idempotencyKey: z.string().uuid(),
  engineProspectId: z.string().min(1).max(300),
  disposition: z.enum(["no_answer", "gatekeeper", "callback", "follow_up", "not_interested", "qualified", "demo_requested", "won", "lost"]),
  summary: z.string().max(8000),
  callbackDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  doNotContact: z.boolean(),
  interest: z.enum(["unknown", "none", "low", "medium", "high"]).optional(),
}).strict();

const OUTCOME: Record<z.infer<typeof CallerResultSchema>["disposition"], ProspectOutcome> = {
  no_answer: "NO_ANSWER", gatekeeper: "GATEKEEPER", callback: "CALL_BACK", follow_up: "CALL_BACK",
  not_interested: "NOT_INTERESTED", lost: "NOT_INTERESTED", qualified: "INTERESTED", demo_requested: "MEETING_BOOKED", won: "WON",
};

/** Records one extension call in the shared call log. Idempotent per key. */
export async function recordCallerResult(db: ProspectDb, input: unknown, caller: CallerActor) {
  const result = CallerResultSchema.parse(input);
  const outcome: ProspectOutcome = result.doNotContact ? "DO_NOT_CONTACT" : OUTCOME[result.disposition];
  const note = `[Axiom Caller] ${result.summary}`.replace(/\s+/g, " ").trim().slice(0, 1000);
  return recordProspectActivity(db, {
    idempotencyKey: result.idempotencyKey, prospectId: result.engineProspectId, channel: "CALL", outcome, note,
    followUpAt: outcome === "CALL_BACK" || outcome === "INTERESTED" ? result.callbackDate ?? null : null,
  }, caller.actor, caller.actorUserId);
}
