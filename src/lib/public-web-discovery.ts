import { rejectLegacyBrowserWork } from "@/lib/retired-legacy-browser";
import type { AutomationBrowserContext } from "@/lib/browser-rendering";
import type { ScrapeJobEventPayload } from "@/lib/scrape-jobs";

import { type EmailDiscoveryPage } from "@/lib/public-email-intelligence";

export function pickBestSocialLink(pages: EmailDiscoveryPage[]): string {
    const preferredHosts = ["linkedin.com", "facebook.com", "instagram.com", "x.com", "twitter.com"];
    const candidates = pages
        .flatMap((page) => page.links)
        .map((link) => link.href)
        .filter(Boolean);

    for (const host of preferredHosts) {
        const match = candidates.find((href) => href.includes(host));
        if (match) return match;
    }

    return "";
}

export async function collectWebsiteDiscoveryPages(
  context: AutomationBrowserContext,
  website: string,
  sendEvent: (data: ScrapeJobEventPayload) => Promise<void> | void,
): Promise<{ rawFootprint: string; pages: EmailDiscoveryPage[] }> {
  void context; void website; void sendEvent;
  return rejectLegacyBrowserWork();
}
export async function collectSearchDiscoveryPage(
  context: AutomationBrowserContext,
  query: string,
): Promise<{ rawFootprint: string; pages: EmailDiscoveryPage[] }> {
  void context; void query;
  return rejectLegacyBrowserWork();
}
