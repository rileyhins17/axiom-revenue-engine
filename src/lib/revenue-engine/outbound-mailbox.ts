import { z } from "zod";
import type { D1DatabaseLike } from "../cloudflare";
import { MAILBOX_SENDABLE_STATUSES } from "../scheduler-state";

const identifier = z.string().regex(/^[\x21-\x7e]{1,256}(?![\s\S])/);
const identitySchema = z.object({
  ownerId: identifier, mailboxId: identifier, connectionId: identifier,
  address: z.email().max(254).regex(/^[\x21-\x7e]+(?![\s\S])/),
}).strict();
export type ExactMailboxIdentity = z.infer<typeof identitySchema>;
const token = z.string().min(1).max(65536).regex(/^[\x21-\x7e]+(?![\s\S])/);
const rowSchema = identitySchema.extend({
  encryptedAccessToken: token,
  tokenExpiresAt: z.string().max(64),
  scopes: z.string().max(8192),
  status: z.enum(MAILBOX_SENDABLE_STATUSES),
  nowMs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

const query = `SELECT m."userId" AS "ownerId", m."id" AS "mailboxId",
  c."id" AS "connectionId", c."gmailAddress" AS "address",
  c."accessToken" AS "encryptedAccessToken", c."tokenExpiresAt", c."scopes", m."status",
  CAST(unixepoch('now') * 1000 AS INTEGER) AS "nowMs"
  FROM "OutreachMailbox" m JOIN "GmailConnection" c ON c."id" = m."gmailConnectionId"
  WHERE m."id" = ? AND m."userId" = ? AND c."userId" = ?
    AND c."id" = ? AND m."gmailAddress" = ? AND c."gmailAddress" = ?`;

function expiryMs(value: string) {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?![\s\S])/.test(value)
    ? `${value.replace(" ", "T")}Z` : value;
  if (!z.iso.datetime({ offset: true }).safeParse(normalized).success) return null;
  return Date.parse(normalized);
}

/** Exact credential provenance loader, not owner/consent/health authorization.
 * Read-only SQL and local decryption only: no refresh token selection, network,
 * runtime binding, fallback mailbox or database write. Inject decryptToken only,
 * never getValidAccessToken (which may refresh). Call only inside the authorized
 * dispatcher transport. The enclosing policy must still establish fresh health,
 * global stops, consent, approval, capacity and budget before dispatch. */
export function createExactMailboxResolver(dependencies: {
  database: Pick<D1DatabaseLike, "prepare">;
  decryptAccessToken(ciphertext: string): Promise<string>;
}) {
  return async (input: Readonly<ExactMailboxIdentity>) => {
    const identityResult = identitySchema.safeParse(input);
    if (!identityResult.success) throw new Error("OUTBOUND_MAILBOX_IDENTITY_INVALID");
    const identity = Object.freeze(identityResult.data);
    const read = async () => {
      let raw: unknown;
      try {
        raw = await dependencies.database.prepare(query).bind(identity.mailboxId,
          identity.ownerId, identity.ownerId, identity.connectionId, identity.address, identity.address).first();
      } catch { throw new Error("OUTBOUND_MAILBOX_UNAVAILABLE"); }
      const parsed = rowSchema.safeParse(raw);
      if (!parsed.success) throw new Error("OUTBOUND_MAILBOX_UNAVAILABLE");
      const row = parsed.data;
      const expiresAt = expiryMs(row.tokenExpiresAt);
      if (Object.entries(identity).some(([key, value]) => row[key as keyof ExactMailboxIdentity] !== value)
        || !row.scopes.split(/\s+/).includes("https://www.googleapis.com/auth/gmail.send")
        || expiresAt === null || !Number.isFinite(expiresAt) || expiresAt - row.nowMs <= 300000) {
        throw new Error("OUTBOUND_MAILBOX_UNAVAILABLE");
      }
      return row;
    };
    const before = await read();
    let accessToken: string;
    try {
      accessToken = await dependencies.decryptAccessToken(before.encryptedAccessToken);
      if (!token.max(16384).safeParse(accessToken).success) throw new Error("Invalid token");
    } catch { throw new Error("OUTBOUND_MAILBOX_CREDENTIAL_UNAVAILABLE"); }
    const after = await read();
    if (after.nowMs < before.nowMs || Object.keys(before).some((key) => key !== "nowMs"
      && after[key as keyof typeof after] !== before[key as keyof typeof before])) {
      throw new Error("OUTBOUND_MAILBOX_CHANGED");
    }
    // No token/ciphertext is emitted to logs, parser diagnostics or status records.
    return Object.freeze({ ...identity, accessToken });
  };
}
