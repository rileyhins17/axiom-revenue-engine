import {
    pickRelevantContactLinks,
    type EmailDiscoveryPage,
    type ResolvedLink,
} from "@/lib/public-email-intelligence";
import type { AutomationBrowserContext, AutomationPage } from "@/lib/browser-rendering";
import type { ScrapeJobEventPayload } from "@/lib/scrape-jobs";

type PageSnapshot = {
    text: string;
    links: ResolvedLink[];
};

// 3 contact pages: homepage + 2 sub-pages (contact/about/team most often).
// Previously 2 produced 0 emails across 25-target scrape jobs. 3 raises
// yield meaningfully on sites that bury email under About/Team without
// blowing per-target time budget too far.
const WEBSITE_DISCOVERY_CONTACT_PAGE_LIMIT = 3;
const WEBSITE_DISCOVERY_PAGE_SETTLE_MS = 500;

async function waitForDiscoveryPageReady(page: AutomationPage): Promise<void> {
    await page.waitForSelector("body", { timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(WEBSITE_DISCOVERY_PAGE_SETTLE_MS);
}

async function capturePageSnapshot(page: AutomationPage): Promise<PageSnapshot> {
    return page.evaluate(() => {
        const links = Array.from(document.querySelectorAll("a"))
            .map((anchor) => {
                const element = anchor as HTMLAnchorElement;
                return {
                    href: element.href || element.getAttribute("href") || "",
                    text: (element.textContent || "").trim().slice(0, 160),
                };
            })
            .filter((link) => link.href);

        // body.innerText misses emails that live in places the renderer never
        // paints as visible text: schema.org JSON-LD, structured-data
        // attributes, and meta tags. Local-business sites very often only
        // expose their real email there, which is why innerText-only capture
        // tops out around 20% email yield. Harvest those sources here — same
        // page load, zero extra browser-rendering cost — and append them so
        // the existing email extractor/validator picks them up.
        const structured: string[] = [];

        // 1. schema.org JSON-LD blocks (LocalBusiness/Organization carry `email`).
        for (const node of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
            const raw = node.textContent || "";
            if (raw) structured.push(raw);
        }

        // 2. Explicit email-bearing markup: itemprop, data-email, mailto targets
        //    (including non-anchor elements and onclick mailto handlers).
        for (const el of Array.from(
            document.querySelectorAll('[itemprop="email"], [data-email], [href^="mailto:" i]'),
        )) {
            const value =
                el.getAttribute("data-email") ||
                el.getAttribute("content") ||
                el.getAttribute("href") ||
                el.textContent ||
                "";
            if (value) structured.push(value.replace(/^mailto:/i, ""));
        }

        // 3. Meta tags occasionally hold the contact email.
        for (const meta of Array.from(
            document.querySelectorAll('meta[name*="email" i], meta[property*="email" i]'),
        )) {
            const content = meta.getAttribute("content") || "";
            if (content) structured.push(content);
        }

        const bodyText = document.body?.innerText || "";
        const structuredText = structured.join("\n").slice(0, 8000);

        return {
            text: structuredText ? `${bodyText}\n\n[STRUCTURED-DATA]\n${structuredText}` : bodyText,
            links,
        };
    });
}

function buildDiscoverySection(label: string, snapshot: PageSnapshot): string {
    const trimmedText = snapshot.text.slice(0, 5000);
    const trimmedLinks = snapshot.links
        .map((link) => link.href)
        .filter(Boolean)
        .slice(0, 40)
        .join("\n");

    return `[${label.toUpperCase()}]\n${trimmedText}\n\nLINKS:\n${trimmedLinks}`;
}

export async function collectWebsiteDiscoveryPages(
    context: AutomationBrowserContext,
    website: string,
    sendEvent: (data: ScrapeJobEventPayload) => Promise<void> | void,
): Promise<{ rawFootprint: string; pages: EmailDiscoveryPage[] }> {
    const pages: EmailDiscoveryPage[] = [];
    const sections: string[] = [];
    const homepage = await context.newPage();

    try {
        await homepage.goto(website, { waitUntil: "domcontentloaded", timeout: 15000 });
        await waitForDiscoveryPageReady(homepage);
        const homepageSnapshot = await capturePageSnapshot(homepage);

        pages.push({
            url: website,
            role: "homepage",
            sourceLabel: "Homepage",
            text: homepageSnapshot.text,
            links: homepageSnapshot.links,
        });
        sections.push(buildDiscoverySection("Homepage", homepageSnapshot));

        const contactLinks = pickRelevantContactLinks(website, homepageSnapshot.links, WEBSITE_DISCOVERY_CONTACT_PAGE_LIMIT);
        for (const link of contactLinks) {
            const subPage = await context.newPage();
            try {
                await sendEvent({ message: `[EMAIL] Scanning ${link.role} page: ${link.url}` });
                await subPage.goto(link.url, { waitUntil: "domcontentloaded", timeout: 12000 });
                await waitForDiscoveryPageReady(subPage);
                const snapshot = await capturePageSnapshot(subPage);
                pages.push({
                    url: link.url,
                    role: link.role,
                    sourceLabel: link.label || link.role,
                    text: snapshot.text,
                    links: snapshot.links,
                });
                sections.push(buildDiscoverySection(link.label || link.role, snapshot));
            } catch {
                // Ignore secondary page failures and keep the run moving.
            } finally {
                await subPage.close();
            }
        }
    } finally {
        await homepage.close();
    }

    return {
        rawFootprint: sections.join("\n\n"),
        pages,
    };
}

export async function collectSearchDiscoveryPage(
    context: AutomationBrowserContext,
    query: string,
): Promise<{ rawFootprint: string; pages: EmailDiscoveryPage[] }> {
    const searchPage = await context.newPage();

    try {
        await searchPage.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}`, {
            waitUntil: "domcontentloaded",
            timeout: 15000,
        });

        try {
            await searchPage.waitForSelector("#search", { timeout: 8000 });
        } catch {
            await searchPage.waitForSelector("body", { timeout: 8000 });
        }
        await searchPage.waitForTimeout(WEBSITE_DISCOVERY_PAGE_SETTLE_MS);

        const snapshot = await capturePageSnapshot(searchPage);
        return {
            rawFootprint: buildDiscoverySection("Search results", snapshot),
            pages: [{
                url: searchPage.url(),
                role: "search",
                sourceLabel: "Search results",
                text: snapshot.text,
                links: snapshot.links,
            }],
        };
    } finally {
        await searchPage.close();
    }
}

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
