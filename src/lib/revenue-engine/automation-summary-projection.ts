import type { AutomationOverview } from "../outreach-automation";
import type { LeadRecord, OutreachMailboxRecord } from "../prisma";

const leadSummary = (lead?: LeadRecord | null) => lead ? ({
  id: lead.id, businessName: lead.businessName, city: lead.city, niche: lead.niche,
  email: lead.email, websiteUrl: lead.websiteUrl, axiomScore: lead.axiomScore, axiomTier: lead.axiomTier,
}) : null;
const mailboxSummary = (mailbox: OutreachMailboxRecord) => ({
  id: mailbox.id, gmailAddress: mailbox.gmailAddress, status: mailbox.status,
  connected: Boolean(mailbox.gmailConnectionId), dailyLimit: mailbox.dailyLimit,
  hourlyLimit: mailbox.hourlyLimit, timezone: mailbox.timezone, lastSentAt: mailbox.lastSentAt,
});
const sequenceSummary = (sequence: AutomationOverview["sequences"][number]) => ({
  id: sequence.id, leadId: sequence.leadId, status: sequence.status, currentStep: sequence.currentStep,
  createdAt: sequence.createdAt, nextScheduledAt: sequence.nextScheduledAt, lastSentAt: sequence.lastSentAt,
  replyDetectedAt: sequence.replyDetectedAt, state: sequence.state, nextSendAt: sequence.nextSendAt,
  blockerReason: sequence.blockerReason, blockerLabel: sequence.blockerLabel, blockerDetail: sequence.blockerDetail,
  hasSentAnyStep: sequence.hasSentAnyStep, secondaryBlockers: sequence.secondaryBlockers,
  lead: leadSummary(sequence.lead), mailbox: sequence.mailbox ? mailboxSummary(sequence.mailbox) : null,
  nextStep: sequence.nextStep ? { id: sequence.nextStep.id, stepNumber: sequence.nextStep.stepNumber,
    stepType: sequence.nextStep.stepType, status: sequence.nextStep.status, scheduledFor: sequence.nextStep.scheduledFor } : null,
});

/** Display DTO, not a raw ORM export or send decision. All sequence/mailbox/mail
 * rows must already be scoped by their durable owner ID. Global pipeline/run
 * metrics are explicitly shared; no run diagnostics or email bodies are exposed. */
export function projectAutomationOverview(value: AutomationOverview) {
  return {
    scope: { messages: "CURRENT_OWNER", pipeline: "SHARED_BUSINESS", runs: "SHARED_COUNTS" } as const,
    settings: { enabled: value.settings.enabled, globalPaused: value.settings.globalPaused,
      emergencyPaused: value.settings.emergencyPaused, intakePaused: value.settings.intakePaused,
      followUpsPaused: value.settings.followUpsPaused },
    ready: value.ready.map(leadSummary),
    mailboxes: value.mailboxes.map(mailbox => ({ ...mailboxSummary(mailbox), sentToday: mailbox.sentToday, sentThisHour: mailbox.sentThisHour })),
    sequences: value.sequences.map(sequenceSummary), queued: value.queued.map(sequenceSummary),
    active: value.active.map(sequenceSummary), finished: value.finished.map(sequenceSummary),
    recentSent: value.recentSent.map(email => ({ source: "LEGACY_OUTREACH_EMAIL" as const,
      id: email.id, sentAt: email.sentAt, subject: email.subject, senderEmail: email.senderEmail,
      recipientEmail: email.recipientEmail, lead: leadSummary(email.lead) })),
    engine: value.engine, pipeline: value.pipeline, stats: value.stats,
    recentRuns: value.recentRuns.map(run => ({ startedAt: run.startedAt, finishedAt: run.finishedAt,
      status: run.status, claimedCount: run.claimedCount, sentCount: run.sentCount,
      failedCount: run.failedCount, skippedCount: run.skippedCount })),
  };
}
