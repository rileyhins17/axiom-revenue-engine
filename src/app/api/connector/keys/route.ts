import { z } from "zod";

import { writeAuditEvent } from "@/lib/audit";
import { getDatabase } from "@/lib/cloudflare";
import { isFounder, keysStatus, makeKey, turnOffKey } from "@/lib/connector/connector-keys";
import { founderRequest, json } from "@/lib/outreach/outreach-api";
import { ownerForAccount } from "@/lib/owner-login";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { requireApiSession } from "@/lib/session";
import { withTimeout } from "@/lib/timeout";

export const dynamic = "force-dynamic";
const Command = z.object({ kind: z.enum(["header", "link"]) }).strict();
const NOT_A_FOUNDER = "Only Riley or Aidan can have a connector key.";
const FAILED = "Could not reach the keys just now. Try again.";

/** Settings, Claude connector: whether the signed-in founder has each key, its last four characters and when it was used. */
export async function GET(request: Request) {
  const auth = await requireApiSession(request);
  if ("response" in auth) return auth.response;
  const owner = ownerForAccount(auth.session.user.email ?? "");
  if (!owner || !isFounder(owner.name)) return json({ error: NOT_A_FOUNDER }, 403);
  try {
    return json({ founder: owner.name, keys: await withTimeout(keysStatus(getDatabase() as unknown as ProspectDb, owner.name), 10_000, "connector-keys") });
  } catch {
    return json({ error: FAILED }, 503);
  }
}

/** Makes the founder's key of one kind, replacing the old one at once. The key is in this answer and nowhere else, ever. */
export async function POST(request: Request) {
  const input = await founderRequest(request, Command, "make a connector key");
  if ("response" in input) return input.response;
  const { owner, body, db } = input;
  if (!isFounder(owner.name)) return json({ error: NOT_A_FOUNDER }, 403);
  try {
    const key = await withTimeout(makeKey(db, owner.name, body.kind), 10_000, "connector-key-make");
    await writeAuditEvent({ action: "connector.key.make", targetType: "connector", targetId: body.kind, metadata: { founder: owner.name, kind: body.kind } });
    return json({ founder: owner.name, kind: body.kind, key, keys: await withTimeout(keysStatus(db, owner.name), 10_000, "connector-keys") });
  } catch {
    return json({ error: FAILED }, 503);
  }
}

/** Turns the founder's key of one kind off: it stops working at once. */
export async function DELETE(request: Request) {
  const input = await founderRequest(request, Command, "turn off a connector key");
  if ("response" in input) return input.response;
  const { owner, body, db } = input;
  if (!isFounder(owner.name)) return json({ error: NOT_A_FOUNDER }, 403);
  try {
    await withTimeout(turnOffKey(db, owner.name, body.kind), 10_000, "connector-key-off");
    await writeAuditEvent({ action: "connector.key.off", targetType: "connector", targetId: body.kind, metadata: { founder: owner.name, kind: body.kind } });
    return json({ founder: owner.name, keys: await withTimeout(keysStatus(db, owner.name), 10_000, "connector-keys") });
  } catch {
    return json({ error: FAILED }, 503);
  }
}
