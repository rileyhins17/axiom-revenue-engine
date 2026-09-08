import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/cloudflare";
import { ownerSummaryScope, ownerSummaryHeaders } from "@/lib/revenue-engine/owner-summary-scope";
import { requireAdminApiSession } from "@/lib/session";

/** Legacy reference metadata only. Google Workspace is not the rebuild provider.
 * Looking at connection status must never synchronize mailboxes or tokens. */
export async function GET(request: Request) {
  const authResult = await requireAdminApiSession(request);
  if ("response" in authResult) {
    for (const [name, value] of Object.entries(ownerSummaryHeaders)) authResult.response.headers.set(name, value);
    return authResult.response;
  }
  try {
    const db = getDatabase();
    const scope = await ownerSummaryScope({ userId: authResult.session.user.id, sessionId: authResult.session.session.id }, db);
    const [connectionRows, mailboxRows] = await Promise.all([
      db.prepare(`SELECT id,gmailAddress,createdAt,updatedAt,
        CASE WHEN julianday(tokenExpiresAt)>julianday('now') THEN 1 ELSE 0 END AS tokenHealthy
        FROM "GmailConnection" WHERE userId=? ORDER BY updatedAt DESC LIMIT 101`)
        .bind(scope.userId).all<{ id: string; gmailAddress: string; createdAt: string; updatedAt: string; tokenHealthy: number }>(),
      db.prepare(`SELECT id,gmailAddress,status,dailyLimit,hourlyLimit,minDelaySeconds,lastSentAt
        FROM "OutreachMailbox" WHERE userId=? ORDER BY gmailAddress LIMIT 101`)
        .bind(scope.userId).all<{ id: string; gmailAddress: string; status: string; dailyLimit: number; hourlyLimit: number; minDelaySeconds: number; lastSentAt: string | null }>(),
    ]);
    if (!connectionRows.results || !mailboxRows.results || connectionRows.results.length>100 || mailboxRows.results.length>100) {
      throw new Error("OWNER_SUMMARY_UNAVAILABLE");
    }
    const connections = connectionRows.results.map(row => ({
      id: row.id, gmailAddress: row.gmailAddress, createdAt: row.createdAt,
      updatedAt: row.updatedAt, tokenHealthy: row.tokenHealthy === 1,
    }));
    const mailboxes = mailboxRows.results.map(row => ({
      id: row.id, gmailAddress: row.gmailAddress, status: row.status,
      dailyLimit: row.dailyLimit, hourlyLimit: row.hourlyLimit,
      minDelaySeconds: row.minDelaySeconds, lastSentAt: row.lastSentAt,
    }));
    await scope.assertCurrent();
    return NextResponse.json({
      source: "LEGACY_GMAIL_METADATA", readOnly: true, runtimeAvailable: false, healthChecked: false,
      connected: connections.length>0, gmailAddress: connections[0]?.gmailAddress,
      connectedAt: connections[0]?.createdAt, tokenHealthy: connections.some(row => row.tokenHealthy),
      connections, mailboxes,
    }, { headers: ownerSummaryHeaders });
  } catch {
    return NextResponse.json({ error: "Saved mailbox status unavailable. No settings were changed." },
      { status: 503, headers: ownerSummaryHeaders });
  }
}
