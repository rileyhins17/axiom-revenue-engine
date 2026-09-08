import { z } from "zod";
import { getDatabase, type D1DatabaseLike } from "../cloudflare";
import { policyPlaceholders, readOperatorOwnerPolicy } from "../operator-owner-policy";

export type OwnerSummaryActor = { userId: string; sessionId: string };
export const ownerSummaryHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/** Read admission only; never reconcile accounts, repair schema or grant send
 * authority. Call assertCurrent after the final asynchronous read and before
 * serializing a summary. Ownership predicates remain required on each query. */
export async function ownerSummaryScope(actor: OwnerSummaryActor, db: Pick<D1DatabaseLike, "prepare"> = getDatabase()) {
  const id = z.string().min(1).max(256);
  const scope = z.object({ userId: id, sessionId: id }).strict().parse(actor);
  const policy = readOperatorOwnerPolicy();
  const assertCurrent = async () => {
    if (JSON.stringify(readOperatorOwnerPolicy()) !== JSON.stringify(policy)) throw new Error("OWNER_SUMMARY_UNAVAILABLE");
    const admitted = await db.prepare(`SELECT s.id FROM "Session" s JOIN "User" u ON u.id=s.userId
      WHERE s.id=? AND s.userId=? AND s.impersonatedBy IS NULL
      AND julianday(s.createdAt)<=julianday('now') AND julianday(s.expiresAt)>julianday('now')
      AND u.role='admin' AND u.emailVerified=1 AND COALESCE(u.banned,0)=0
      AND lower(u.email) IN (${policyPlaceholders(policy.adminEmails)})`)
      .bind(scope.sessionId, scope.userId, ...policy.adminEmails).first();
    if (!admitted || JSON.stringify(readOperatorOwnerPolicy()) !== JSON.stringify(policy)) throw new Error("OWNER_SUMMARY_UNAVAILABLE");
  };
  await assertCurrent();
  return { ...scope, assertCurrent };
}
