/**
 * Lead Personalization Module
 * 
 * Generates evidence-backed callOpener and followUpQuestion
 * using painSignals + niche context.
 */

import type { PainSignal, WebsiteAssessment } from "./axiom-scoring";

export interface PersonalizationResult {
    callOpener: string;
    followUpQuestion: string;
    evidenceLevel: "none" | "weak" | "strong";
}

/**
 * Generate a sales-ready call opener and follow-up question.
 * Uses the most severe pain signals as evidence.
 */
export function generatePersonalization(input: {
    businessName: string;
    niche: string;
    city: string;
    websiteStatus: string;
    painSignals: PainSignal[];
    assessment: WebsiteAssessment | null;
    contactName: string | null;
}): PersonalizationResult {
    const topPains = [...input.painSignals]
        .sort((a, b) => b.severity - a.severity)
        .slice(0, 3);

    const name = input.contactName ? input.contactName.split(" ")[0] : null;
    const greeting = name ? `Hi ${name}, ` : "";

    // ═══ NO WEBSITE ═══
    if (input.websiteStatus === "MISSING") {
        return {
            callOpener: `${greeting}I found ${input.businessName}'s listing in ${input.city}, but couldn't find a website linked from it. I can send a simple outline of what a useful first version could include.`,
            followUpQuestion: `Would it be useful if I sent that outline, or is a website not something you're considering right now?`,
            evidenceLevel: "strong",
        };
    }

    // ═══ HAS WEBSITE WITH PROBLEMS ═══
    if (topPains.length === 0) {
        return {
            callOpener: `${greeting}I reviewed ${input.businessName}'s website, but the scan didn't surface a specific issue reliable enough for me to claim as fact.`,
            followUpQuestion: `Would you be open to me sending a short, no-pressure review if I find something concrete?`,
            evidenceLevel: "none",
        };
    }

    // Build evidence string from top pain signals
    const painPhrases: string[] = [];
    for (const pain of topPains) {
        switch (String(pain.type).toUpperCase()) {
            case "SPEED":
                painPhrases.push("mobile speed as an area to review");
                break;
            case "CONVERSION":
                if (
                    pain.evidence.toLowerCase().includes("no booking") ||
                    pain.evidence.toLowerCase().includes("no form") ||
                    pain.evidence.toLowerCase().includes("no quote")
                ) {
                    painPhrases.push("the booking or quote path as hard to find");
                } else if (pain.evidence.toLowerCase().includes("no cta")) {
                    painPhrases.push("the main call-to-action as unclear");
                } else {
                    painPhrases.push("the contact path as an area to review");
                }
                break;
            case "TRUST":
                if (pain.evidence.toLowerCase().includes("ssl") || pain.evidence.toLowerCase().includes("https")) {
                    painPhrases.push("a security or HTTPS issue");
                } else if (pain.evidence.toLowerCase().includes("outdated")) {
                    painPhrases.push("an outdated design signal");
                } else {
                    painPhrases.push("trust signals as an area to review");
                }
                break;
            case "SEO":
                painPhrases.push("local-search signals as an area to review");
                break;
            case "DESIGN":
                painPhrases.push("the design as a possible refresh area");
                break;
            default:
                painPhrases.push("one website item worth reviewing");
        }
    }

    // Deduplicate
    const uniquePhrases = [...new Set(painPhrases)].slice(0, 2);
    const evidenceStr = uniquePhrases.join(" and ");

    const callOpener = `${greeting}The website scan for ${input.businessName} flagged ${evidenceStr}. I can send the exact observations so you can judge whether they're useful.`;

    // Follow-up based on primary pain type
    const primaryType = String(topPains[0]?.type || "").toUpperCase();
    let followUpQuestion: string;
    switch (primaryType) {
        case "SPEED":
            followUpQuestion = "Is mobile load time something you're already reviewing, or would the scan notes be useful?";
            break;
        case "CONVERSION":
            followUpQuestion = "Would it help if I sent the exact contact-path item the scan flagged?";
            break;
        case "TRUST":
            followUpQuestion = "Would it be useful if I sent the trust-signal items the scan flagged?";
            break;
        case "SEO":
            followUpQuestion = "Would you like the local-search observations from the scan?";
            break;
        default:
            followUpQuestion = "Would it be useful if I sent the exact item that stood out?";
    }

    const evidenceLevel = input.assessment || topPains.some((pain) => pain.severity >= 5) ? "strong" : "weak";
    return { callOpener, followUpQuestion, evidenceLevel };
}
