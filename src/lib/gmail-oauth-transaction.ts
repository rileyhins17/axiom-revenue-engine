import { z } from "zod";
import type { D1DatabaseLike } from "./cloudflare";
import { policyPlaceholders, readOperatorOwnerPolicy } from "./operator-owner-policy";

type Binding = { userId: string; sessionId: string; redirectUri: string };
const encoder = new TextEncoder();
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");

async function key(secret: string) {
  if (secret.length < 32) throw new Error("OAuth security configuration unavailable");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function actorFence() {
  const { adminEmails } = readOperatorOwnerPolicy();
  return { adminEmails, sql: `EXISTS (SELECT 1 FROM "Session" s JOIN "User" u ON u."id" = s."userId"
    WHERE s."id" = ? AND u."id" = ? AND u."role" = 'admin'
      AND u."emailVerified" = 1 AND COALESCE(u."banned", 0) = 0
      AND lower(u."email") IN (${policyPlaceholders(adminEmails)})
      AND julianday(s."expiresAt") > julianday('now'))` };
}

export async function issueGmailOAuthTransaction(db: D1DatabaseLike, secret: string, input: Binding & { targetEmail: string }) {
  const uri = new URL(input.redirectUri);
  if (!input.userId || !input.sessionId || uri.href !== input.redirectUri || uri.username || uri.password || uri.search || uri.hash
    || uri.pathname !== "/api/outreach/gmail/callback"
    || !(uri.protocol === "https:" || (uri.protocol === "http:" && ["localhost", "127.0.0.1"].includes(uri.hostname)))
    || input.targetEmail !== input.targetEmail.trim().toLowerCase() || !z.email().safeParse(input.targetEmail).success) {
    throw new Error("Invalid OAuth transaction");
  }
  const id = hex(crypto.getRandomValues(new Uint8Array(32)));
  const signature = hex(new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(`gmail-oauth-v1:${id}`))));
  const actor = actorFence();
  const row = await db.prepare(`INSERT INTO "GmailOAuthTransaction" ("id","userId","sessionId","redirectUri","targetEmail")
    SELECT ?,?,?,?,? WHERE ${actor.sql} RETURNING "id"`)
    .bind(id, input.userId, input.sessionId, input.redirectUri, input.targetEmail,
      input.sessionId, input.userId, ...actor.adminEmails).first<{ id: string }>();
  if (row?.id !== id) throw new Error("OAuth administrator unavailable");
  return `v1.${id}.${signature}`;
}

export async function consumeGmailOAuthTransaction(db: D1DatabaseLike, secret: string, state: string | null, input: Binding) {
  if (!state || !/^v1\.[a-f0-9]{64}\.[a-f0-9]{64}$/.test(state)) return null;
  const [, id, signature] = state.split(".");
  const bytes = Uint8Array.from(signature.match(/../g)!, byte => parseInt(byte, 16));
  if (!await crypto.subtle.verify("HMAC", await key(secret), bytes, encoder.encode(`gmail-oauth-v1:${id}`))) return null;
  const actor = actorFence();
  // One database-clock guarded statement: concurrent callbacks cannot both win.
  return db.prepare(`UPDATE "GmailOAuthTransaction" SET "consumedAt" = unixepoch()
    WHERE "id" = ? AND "userId" = ? AND "sessionId" = ? AND "redirectUri" = ?
      AND "consumedAt" IS NULL AND "issuedAt" <= unixepoch() AND "expiresAt" > unixepoch()
      AND ${actor.sql} RETURNING "targetEmail"`)
    .bind(id, input.userId, input.sessionId, input.redirectUri,
      input.sessionId, input.userId, ...actor.adminEmails).first<{ targetEmail: string }>();
}
