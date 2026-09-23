import { normalizePipelineEmail } from "@/lib/lead-qualification";

type ManualReplyLead = {
  id: number;
  email: string | null;
  outreachStatus: string | null;
  websiteDomain: string | null;
};

type ManualReplySafetyPrisma = {
  outreachAutomationSetting: {
    findFirst(args?: unknown): Promise<{ emergencyPaused: boolean; globalPaused: boolean } | null | undefined>;
  };
  outreachSuppression: {
    findFirst(args?: unknown): Promise<{ id: string } | null | undefined>;
  };
};

const SHARED_EMAIL_DOMAINS = new Set([
  "aol.com", "fastmail.com", "gmail.com", "googlemail.com", "hey.com", "icloud.com",
  "live.com", "mail.com", "me.com", "msn.com", "outlook.com", "pm.me", "proton.me",
  "protonmail.com", "tutanota.com", "yahoo.com", "ymail.com", "zoho.com",
]);
const SHARED_EMAIL_PREFIXES = ["aol.", "hotmail.", "live.", "outlook.", "rocketmail.", "yahoo."];

function normalizeDomain(value: string | null | undefined) {
  const raw = (value || "").trim().toLowerCase();
  if (!raw) return "";
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function emailDomain(value: string | null | undefined) {
  const email = normalizePipelineEmail(value);
  return email.includes("@") ? normalizeDomain(email.split("@")[1]) : "";
}

function isSharedEmailDomain(domain: string) {
  return SHARED_EMAIL_DOMAINS.has(domain) || SHARED_EMAIL_PREFIXES.some((prefix) => domain.startsWith(prefix));
}

function suppressionDomains(lead: ManualReplyLead, recipientEmail: string) {
  const domains = new Set<string>();
  const websiteDomain = normalizeDomain(lead.websiteDomain);
  const leadEmailDomain = emailDomain(lead.email);
  const recipientDomain = emailDomain(recipientEmail);

  if (websiteDomain) domains.add(websiteDomain);
  if (leadEmailDomain && !isSharedEmailDomain(leadEmailDomain)) domains.add(leadEmailDomain);
  if (recipientDomain && !isSharedEmailDomain(recipientDomain)) domains.add(recipientDomain);
  return [...domains];
}

/**
 * Fail-closed final policy gate for the abandoned legacy Gmail reply route.
 * This must run immediately before resolving credentials or contacting Gmail.
 */
export async function requireLegacyManualReplySafety(
  prisma: ManualReplySafetyPrisma,
  lead: ManualReplyLead,
  recipientEmail: string,
) {
  const settings = await prisma.outreachAutomationSetting.findFirst({
    select: { emergencyPaused: true, globalPaused: true },
  });
  if (!settings) throw new Error("MANUAL_REPLY_SAFETY_STATE_UNAVAILABLE");
  if (settings.emergencyPaused) throw new Error("MANUAL_REPLY_EMERGENCY_STOP_ACTIVE");
  if (settings.globalPaused) throw new Error("MANUAL_REPLY_GLOBAL_STOP_ACTIVE");
  if (lead.outreachStatus === "SUPPRESSED") throw new Error("MANUAL_REPLY_BUSINESS_SUPPRESSED");

  const normalizedRecipient = normalizePipelineEmail(recipientEmail);
  if (!normalizedRecipient) throw new Error("MANUAL_REPLY_RECIPIENT_INVALID");
  const domains = suppressionDomains(lead, normalizedRecipient);
  const suppression = await prisma.outreachSuppression.findFirst({
    where: {
      OR: [
        { leadId: lead.id },
        { email: normalizedRecipient },
        ...domains.map((domain) => ({ domain })),
      ],
    },
    select: { id: true },
  });
  if (suppression) throw new Error("MANUAL_REPLY_RECIPIENT_SUPPRESSED");
}
