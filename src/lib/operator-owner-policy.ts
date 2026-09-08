import { APIError } from "better-auth";
import { z } from "zod";

import { getCloudflareBindings, type D1DatabaseLike } from "./cloudflare";

export type OperatorOwnerPolicy = { allowedEmails: string[]; adminEmails: string[] };

export function parseOperatorOwnerPolicy(allowed: unknown, admins: unknown): OperatorOwnerPolicy {
  const parse = (value: unknown) => {
    if (typeof value !== "string") return null;
    const entries = value.split(",").map((email) => email.trim().toLowerCase());
    if (!entries.length || entries.some((email) => !z.email().safeParse(email).success || email.includes("*"))
      || new Set(entries).size !== entries.length) return null;
    return entries;
  };
  const allowedEmails = parse(allowed);
  const adminEmails = parse(admins);
  if (!allowedEmails || !adminEmails || adminEmails.some((email) => !allowedEmails.includes(email))) {
    // Never include configuration values in errors. Invalid settings stop auth
    // before any cleanup; they must not accidentally erase all owner access.
    throw new APIError("SERVICE_UNAVAILABLE", { message: "Owner access configuration requires administrator review." });
  }
  return { allowedEmails, adminEmails };
}

export function readOperatorOwnerPolicy(): OperatorOwnerPolicy {
  const bindings = getCloudflareBindings();
  // Neither getServerEnv nor getAuth's singleton may cache admission policy.
  // A present Cloudflare environment is authoritative, even when incomplete.
  return parseOperatorOwnerPolicy(
    bindings ? bindings.AUTH_ALLOWED_EMAILS : process.env.AUTH_ALLOWED_EMAILS,
    bindings ? bindings.AUTH_ADMIN_EMAILS : process.env.AUTH_ADMIN_EMAILS,
  );
}

export function policyPlaceholders(emails: readonly string[]) {
  return emails.map(() => "?").join(", ");
}

export async function reconcileOperatorAdmission(database: D1DatabaseLike): Promise<OperatorOwnerPolicy> {
  const policy = readOperatorOwnerPolicy();
  await database.prepare(`DELETE FROM "Session" WHERE NOT EXISTS (
    SELECT 1 FROM "User" u WHERE u."id" = "Session"."userId"
      AND u."emailVerified" = 1 AND lower(u."email") IN (${policyPlaceholders(policy.allowedEmails)})
  )`).bind(...policy.allowedEmails).run();
  // Configuration is only a ceiling. Removing admin approval demotes the stored
  // role; adding approval never promotes it, including after removal/re-add.
  // Better Auth recognizes exact comma-separated role names. Only values that
  // can grant its admin permissions are demoted; leave the non-human system
  // account and other non-admin metadata untouched.
  await database.prepare(`UPDATE "User" SET "role" = 'user', "updatedAt" = datetime('now')
    WHERE instr(',' || COALESCE("role", '') || ',', ',admin,') > 0 AND (
      "emailVerified" <> 1 OR lower("email") NOT IN (${policyPlaceholders(policy.adminEmails)})
    )`).bind(...policy.adminEmails).run();
  return policy;
}

export async function assertOperatorAdmission(database: D1DatabaseLike, userId: string): Promise<void> {
  const policy = readOperatorOwnerPolicy();
  const user = await database.prepare(`SELECT "id" FROM "User" WHERE "id" = ?
    AND "emailVerified" = 1 AND lower("email") IN (${policyPlaceholders(policy.allowedEmails)})`)
    .bind(userId, ...policy.allowedEmails).first<{ id: string }>();
  if (!user) throw new APIError("FORBIDDEN", { message: "This account is not approved for owner access." });
}

export async function finishOperatorSessionCreation(
  database: D1DatabaseLike, session: { id: string; userId: string },
): Promise<void> {
  try {
    const policy = readOperatorOwnerPolicy();
    const admitted = await database.prepare(`SELECT s."id" FROM "Session" s
      JOIN "User" u ON u."id" = s."userId" WHERE s."id" = ? AND s."userId" = ?
      AND u."emailVerified" = 1 AND COALESCE(u."banned", 0) = 0
      AND lower(u."email") IN (${policyPlaceholders(policy.allowedEmails)})`)
      .bind(session.id, session.userId, ...policy.allowedEmails).first<{ id: string }>();
    if (!admitted) throw new APIError("FORBIDDEN", { message: "Owner access changed during sign-in. Sign in again if approved." });
  } catch (error) {
    // The library inserts after its before-hook. Recheck before login completes
    // and delete only this new session if admission changed in that interval.
    // Later requests still enforce current policy; this is not a transaction
    // spanning external configuration changes or a recall of in-flight work.
    await database.prepare('DELETE FROM "Session" WHERE "id" = ? AND "userId" = ?')
      .bind(session.id, session.userId).run();
    throw error;
  }
}
