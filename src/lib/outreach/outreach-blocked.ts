/**
 * The one do-not-email rule for every campaign (Riley, Nov 5): anyone who bounced or said "no thanks"
 * in any campaign, FCC included, is never emailed by any campaign again. EngineEmailSuppression is the
 * list FCC already reads before every email, so every campaign bounce (BOUNCED) and "no thanks"
 * (UNSUBSCRIBED) is written there too, which stops FCC from emailing them as well.
 */
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";

const domainOf = (email: string) => email.slice(email.lastIndexOf("@") + 1).toLowerCase();

/** FCC's own test for a reply that said no (fcc-campaign-status.ts), over an FCC contact row `f`. */
export const FCC_SAID_NO_SQL = `(f."status" = 'replied' AND COALESCE(f."stoppedReason",'') NOT LIKE '%automatic reply%' AND (${
  ["%stop%", "%no thank%", "%not interested%", "%remove%", "%unsubscribe%"].map((words) => `COALESCE(f."stoppedReason",'') LIKE '${words}'`).join(" OR ")}))`;

/**
 * SQL that is true when no campaign may email an address. Binds: the address, its "@domain", then the
 * address three more times. The do-not-email list (the address or its whole domain), a bounce in FCC
 * or any campaign, or a "no thanks" in FCC or any campaign.
 */
export const BLOCKED_SQL = `(EXISTS (SELECT 1 FROM "EngineEmailSuppression" WHERE "email" = ? OR "email" = ?)
      OR EXISTS (SELECT 1 FROM "FccCampaignContact" f WHERE lower(f."email") = ? AND (f."status" = 'bounced' OR ${FCC_SAID_NO_SQL}))
      OR EXISTS (SELECT 1 FROM "OutreachContact" WHERE "email" = ? AND "status" = 'bounced')
      OR EXISTS (SELECT 1 FROM "OutreachReply" r JOIN "OutreachContact" o ON o."id" = r."contactId" WHERE o."email" = ? AND r."kind" = 'no_thanks'))`;

export const blockedBinds = (email: string) => {
  const address = email.toLowerCase();
  return [address, `@${domainOf(address)}`, address, address, address];
};

/** True when no campaign may email this address. */
export async function addressBlocked(db: ProspectDb, email: string) {
  return Boolean(await db.prepare(`SELECT 1 AS hit WHERE ${BLOCKED_SQL}`).bind(...blockedBinds(email)).first<{ hit: number }>());
}

/** Puts an address on the do-not-email list every campaign and FCC read. */
export async function suppress(db: ProspectDb, email: string, reason: "BOUNCED" | "UNSUBSCRIBED") {
  await db.prepare(`INSERT INTO "EngineEmailSuppression" ("email","reason") VALUES (?,?) ON CONFLICT DO NOTHING`).bind(email.toLowerCase(), reason).run();
}
