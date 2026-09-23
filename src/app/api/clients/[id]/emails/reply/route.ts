import { NextResponse } from "next/server";

import { getErrorMessage } from "@/lib/errors";
import { getDatabase } from "@/lib/cloudflare";
import { getValidAccessToken, sendGmailReply } from "@/lib/gmail";
import { getPrisma } from "@/lib/prisma";
import { requireLegacyManualReplySafety } from "@/lib/legacy-manual-reply-safety";
import { isAllowedReplyTarget } from "@/lib/reply-validation";
import { requireApiSession } from "@/lib/session";

function parseLeadId(value: string) {
  const leadId = Number(value);
  return Number.isFinite(leadId) && leadId > 0 ? leadId : null;
}

/**
 * POST /api/clients/[id]/emails/reply
 *
 * Send a reply email on an existing Gmail thread.
 * Body: { threadId, to, subject, bodyHtml, bodyPlain }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireApiSession(request);
  if ("response" in authResult) return authResult.response;

  const { id } = await params;
  const leadId = parseLeadId(id);
  if (!leadId) {
    return NextResponse.json({ error: "Invalid client id" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { threadId, to, subject, bodyHtml, bodyPlain } = body as {
    threadId?: string;
    to?: string;
    subject?: string;
    bodyHtml?: string;
    bodyPlain?: string;
  };

  if (!threadId || !to || !subject) {
    return NextResponse.json(
      { error: "threadId, to, and subject are required" },
      { status: 400 },
    );
  }

  if (!bodyHtml && !bodyPlain) {
    return NextResponse.json(
      { error: "bodyHtml or bodyPlain is required" },
      { status: 400 },
    );
  }

  const prisma = getPrisma();

  // Verify lead exists
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead || lead.isArchived) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  const threadRows = await getDatabase()
    .prepare(
      `SELECT "recipientEmail"
       FROM "OutreachEmail"
       WHERE "leadId" = ? AND "gmailThreadId" = ?
       UNION ALL
       SELECT lead."email" AS "recipientEmail"
       FROM "OutreachSequenceStep" step
       JOIN "OutreachSequence" sequence ON sequence."id" = step."sequenceId"
       JOIN "Lead" lead ON lead."id" = sequence."leadId"
       WHERE sequence."leadId" = ? AND step."gmailThreadId" = ?`,
    )
    .bind(leadId, threadId, leadId, threadId)
    .all<{ recipientEmail: string | null }>();

  const recordedRecipients = threadRows.results ?? [];
  if (recordedRecipients.length === 0) {
    return NextResponse.json({ error: "Email thread does not belong to this client" }, { status: 409 });
  }

  if (!isAllowedReplyTarget(to, lead.email, recordedRecipients.map((row) => row.recipientEmail))) {
    return NextResponse.json({ error: "Reply recipient does not belong to this client thread" }, { status: 400 });
  }

  try {
    await requireLegacyManualReplySafety(prisma, lead, to);
  } catch (error) {
    console.warn("[emails/reply] blocked by manual reply safety policy:", error);
    return NextResponse.json(
      { error: "Email reply is blocked by the current stop or suppression policy" },
      { status: 409 },
    );
  }

  // Get Gmail connection
  const connection = await prisma.gmailConnection.findFirst({
    where: { userId: authResult.session.user.id },
  });

  if (!connection) {
    return NextResponse.json(
      { error: "No Gmail connection found. Connect Gmail in Settings first." },
      { status: 400 },
    );
  }

  try {
    const tokenResult = await getValidAccessToken(connection);

    if (tokenResult.updated) {
      await prisma.gmailConnection.update({
        where: { id: connection.id },
        data: tokenResult.updated,
      });
    }

    const plainText = bodyPlain || stripHtml(bodyHtml || "");
    const htmlText = bodyHtml || `<p>${escapeHtml(bodyPlain || "")}</p>`;

    const result = await sendGmailReply({
      accessToken: tokenResult.accessToken,
      from: connection.gmailAddress,
      to,
      subject,
      bodyHtml: htmlText,
      bodyPlain: plainText,
      threadId,
    });

    // Log as a CRM activity
    await prisma.crmActivity.create({
      data: {
        leadId,
        actorUserId: authResult.session.user.id,
        type: "EMAIL",
        title: `Reply sent: ${subject}`,
        body: plainText.slice(0, 500),
        metadata: JSON.stringify({
          gmailMessageId: result.messageId,
          gmailThreadId: result.threadId,
          to,
        }),
      },
    });

    // Record in OutreachEmail table
    await prisma.outreachEmail.create({
      data: {
        id: crypto.randomUUID(),
        leadId,
        senderUserId: authResult.session.user.id,
        senderEmail: connection.gmailAddress,
        recipientEmail: to,
        subject,
        bodyHtml: htmlText,
        bodyPlain: plainText,
        gmailMessageId: result.messageId,
        gmailThreadId: result.threadId,
        status: "sent",
        sentAt: new Date(),
      },
    });

    // Update outbound contact timestamp. lastReplyAt is reserved for prospect replies.
    await prisma.lead.update({
      where: { id: leadId },
      data: { lastContactedAt: new Date() },
    });

    return NextResponse.json({
      success: true,
      messageId: result.messageId,
      threadId: result.threadId,
    });
  } catch (error: unknown) {
    console.error("[emails/reply] Error sending reply:", error);
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to send reply") },
      { status: 500 },
    );
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br>");
}
