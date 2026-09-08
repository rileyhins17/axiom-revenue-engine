import type { D1DatabaseLike } from "./cloudflare";
import { operatorBanSchemaReady } from "./operator-ban-schema";
import { policyPlaceholders, readOperatorOwnerPolicy } from "./operator-owner-policy";

const actions = {
  ban: { set: '"banned" = 1, "banReason" = NULL, "banExpires" = NULL', result: "banned" },
  unban: { set: '"banned" = 0, "banReason" = NULL, "banExpires" = NULL', result: "unbanned" },
  make_admin: { set: '"role" = \'admin\'', result: "promoted" },
  remove_admin: { set: '"role" = \'user\'', result: "demoted" },
} as const;

export type OperatorAction = keyof typeof actions;

export function isOperatorAction(value: unknown): value is OperatorAction {
  return typeof value === "string" && Object.hasOwn(actions, value);
}

export async function changeOperatorAccess(
  database: D1DatabaseLike,
  input: { action: OperatorAction; userId: string; actorUserId: string; actorSessionId: string },
) {
  if (!await operatorBanSchemaReady(database)) {
    throw new Error("Operator access is unavailable until the reviewed ban schema is installed.");
  }
  const action = actions[input.action];
  const policy = readOperatorOwnerPolicy();
  const admins = policyPlaceholders(policy.adminEmails);
  // Fixed SQL fragments only. Recheck the actor in the same statement as the
  // change, so an intervening revocation/demotion cannot authorize it. Migration
  // 0071 revokes target sessions atomically with a ban, including other callers.
  const result = await database.prepare(`
    UPDATE "User" SET ${action.set}, "updatedAt" = datetime('now')
    WHERE "id" = ? AND "id" <> ?
      AND (? <> 'make_admin' OR ("emailVerified" = 1 AND lower("email") IN (${admins})))
      AND EXISTS (
      SELECT 1 FROM "Session" s JOIN "User" actor ON actor."id" = s."userId"
      WHERE s."id" = ? AND actor."id" = ? AND actor."role" = 'admin'
        AND COALESCE(actor."banned", 0) = 0
        AND actor."emailVerified" = 1 AND lower(actor."email") IN (${admins})
        AND julianday(s."expiresAt") > julianday('now')
    ) RETURNING "id"
  `).bind(input.userId, input.actorUserId, input.action, ...policy.adminEmails,
    input.actorSessionId, input.actorUserId, ...policy.adminEmails).first<{ id: string }>();
  // D1's changes count may include the trigger's session deletions. The returned
  // target identity proves the guarded UPDATE actually changed this account.
  return result?.id === input.userId ? action.result : null;
}
