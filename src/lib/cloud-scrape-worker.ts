import { LEGACY_BROWSER_RETIRED_REASON } from "@/lib/retired-legacy-browser";

import type { getServerEnv } from "@/lib/env";

type ExistingLeadDedupeCandidate = {
  axiomScore?: number | null;
  axiomTier?: string | null;
  email?: string | null;
  isArchived?: boolean | null;
  websiteDomain?: string | null;
  websiteUrl?: string | null;
};

export function shouldUseExistingLeadForScrapeDedupe(lead: ExistingLeadDedupeCandidate) {
  const hasContactOrWebsite = Boolean(
    String(lead.email || "").trim() ||
      String(lead.websiteUrl || "").trim() ||
      String(lead.websiteDomain || "").trim(),
  );

  if (hasContactOrWebsite) {
    return true;
  }

  if (!lead.isArchived) {
    return true;
  }

  const score = Number(lead.axiomScore || 0);
  return score >= 45 && String(lead.axiomTier || "").toUpperCase() !== "D";
}

export function shouldSkipCloudMapsDetailPages(env: Pick<ReturnType<typeof getServerEnv>, "CLOUD_SCRAPE_DETAIL_PAGES_ENABLED">) {
  return !env.CLOUD_SCRAPE_DETAIL_PAGES_ENABLED;
}

export function isTransientCloudBrowserError(message: string) {
  return /browser.*429|429.*browser|rate limit exceeded/i.test(message);
}

export async function runCloudScrapeWorker() {
  return { claimed: false as const, reason: LEGACY_BROWSER_RETIRED_REASON };
}
