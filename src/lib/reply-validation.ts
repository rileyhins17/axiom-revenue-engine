import { normalizeGmailAddress } from "@/lib/gmail";

export function isAllowedReplyTarget(
  requestedRecipient: string,
  leadEmail: string | null | undefined,
  recordedThreadRecipients: Array<string | null | undefined>,
) {
  const requested = normalizeGmailAddress(requestedRecipient);
  if (!requested || !requested.includes("@")) return false;

  const allowed = new Set(
    [leadEmail, ...recordedThreadRecipients]
      .map(normalizeGmailAddress)
      .filter(Boolean),
  );

  return allowed.has(requested);
}
