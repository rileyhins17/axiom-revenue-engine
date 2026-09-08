/** Shared legacy domain interpretation. This is matching, not navigation or
 * evidence that a domain/recipient belongs to a business. Never fetch this URL. */
export function normalizeSuppressionDomain(domain: string | null | undefined) {
  const raw = (domain || "").trim().toLowerCase();
  if (!raw) return "";
  try {
    const parsed = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return raw.replace(/^https?:\/\//, "").replace(/^www\./, "")
      .split("/")[0].split("?")[0].trim();
  }
}
