/**
 * Axiom Engine Unit Tests
 * 
 * Tests for:
 * - Scoring bucket math
 * - Tier assignment rules (including S/A pain signal gate)
 * - Dedupe behavior
 * - Auto-archive disqualifiers
 * - Contact validation
 * 
 * Run: npx tsx tests/axiom-engine.test.ts
 */

import {
    scoreBusinessValue,
    scorePainOpportunity,
    scoreReachability,
    scoreLocalFit,
    computeTier,
    computeAxiomScore,
    type PainSignal,
    type WebsiteAssessment,
} from "../src/lib/axiom-scoring";

import { validateEmail, validatePhone } from "../src/lib/contact-validation";
import { generateDedupeKey, normalizeName, extractDomain, normalizePhone } from "../src/lib/dedupe";
import { checkDisqualifiers } from "../src/lib/disqualifiers";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
    if (condition) {
        passed++;
        console.log(`  ✅ ${message}`);
    } else {
        failed++;
        console.log(`  ❌ FAIL: ${message}`);
    }
}

// ═══════════════════════════════════════════════
// SCORING BUCKET TESTS
// ═══════════════════════════════════════════════
console.log("\n═══ SCORING: Business Value (0-30) ═══");

{
    // High-LTV industry
    const score1 = scoreBusinessValue("Roofers", "Roofing", 4.5, 100, "our services pricing book a consultation team since 2010");
    assert(score1 >= 25, `High-LTV roofing + all surfaces + strong reviews = ${score1} (expected ≥25)`);

    // Non-high-LTV with minimal signals
    const score2 = scoreBusinessValue("Unknown", "General", 3.0, 2, "");
    assert(score2 <= 5, `Low-LTV unknown + no surfaces + low reviews = ${score2} (expected ≤5)`);

    // High-LTV but no revenue surface or reviews
    const score3 = scoreBusinessValue("Dentist", "Dental", 0, 0, "");
    assert(score3 === 10, `High-LTV dentist + no surfaces + no reviews = ${score3} (expected 10)`);

    // Caps at 30
    const score4 = scoreBusinessValue("HVAC", "Heating", 5.0, 200, "services pricing book team locations hiring since established");
    assert(score4 <= 30, `Max value capped at 30: ${score4}`);
}

console.log("\n═══ SCORING: Pain & Opportunity (0-40) ═══");

{
    // No website with verified business
    const score1 = scorePainOpportunity("MISSING", null, [], 20);
    assert(score1 === 20, `No website + 20 reviews = ${score1} (expected 20)`);

    // No website with unverified business
    const score2 = scorePainOpportunity("MISSING", null, [], 1);
    assert(score2 === 12, `No website + 1 review = ${score2} (expected 12)`);

    // Active website with high risk
    const assessment: WebsiteAssessment = {
        speedRisk: 4, conversionRisk: 5, trustRisk: 3, seoRisk: 2,
        overallGrade: "D", topFixes: [],
    };
    const pains: PainSignal[] = [
        { type: "SPEED", severity: 4, evidence: "Slow load", source: "site_scan" },
        { type: "CONVERSION", severity: 5, evidence: "No forms", source: "site_scan" },
    ];
    const score3 = scorePainOpportunity("ACTIVE", assessment, pains, 10);
    assert(score3 >= 25, `Active with high risk + pains = ${score3} (expected ≥25)`);

    // Active website with NO pain signals → capped at 10
    const score4 = scorePainOpportunity("ACTIVE", assessment, [], 10);
    assert(score4 <= 10, `Active with risk but 0 pain signals = ${score4} (expected ≤10, capped)`);
}

console.log("\n═══ SCORING: Reachability (0-20) ═══");

{
    const score1 = scoreReachability(
        { emailType: "owner", emailConfidence: 0.9, phoneConfidence: 0.9 },
        true, true,
    );
    assert(score1 >= 18, `Owner email+phone+form+social = ${score1} (expected ≥18)`);

    const score2 = scoreReachability(
        { emailType: "unknown", emailConfidence: 0, phoneConfidence: 0 },
        false, false,
    );
    assert(score2 === 0, `No contact = ${score2} (expected 0)`);

    const score3 = scoreReachability(
        { emailType: "generic", emailConfidence: 0.5, phoneConfidence: 0.8 },
        false, false,
    );
    assert(score3 >= 6, `Generic email + phone = ${score3} (expected ≥6)`);
}

console.log("\n═══ SCORING: Local Fit (0-10) ═══");

{
    const score1 = scoreLocalFit("Kitchener", "");
    assert(score1 === 6, `Core city Kitchener = ${score1} (expected 6)`);

    const score2 = scoreLocalFit("Hamilton", "");
    assert(score2 === 6, `Core city Hamilton = ${score2} (expected 6)`);

    const score3 = scoreLocalFit("Toronto", "");
    assert(score3 === 4, `Priority city Toronto = ${score3} (expected 4)`);

    const score4 = scoreLocalFit("Vancouver", "");
    assert(score4 === 0, `Non-Ontario city = ${score4} (expected 0)`);

    const score5 = scoreLocalFit("Kitchener", "new location grand opening hiring");
    assert(score5 >= 8, `Core city + intent signals = ${score5} (expected ≥8)`);
}

// ═══════════════════════════════════════════════
// TIER ASSIGNMENT TESTS
// ═══════════════════════════════════════════════
console.log("\n═══ TIER ASSIGNMENT ═══");

{
    // S tier: 90+ with 2+ pain signals
    const tier1 = computeTier(95, [
        { type: "NO_WEBSITE", severity: 4, evidence: "test", source: "heuristic" },
        { type: "CONVERSION", severity: 3, evidence: "test", source: "heuristic" },
    ]);
    assert(tier1 === "S", `Score 95 + 2 pains = ${tier1} (expected S)`);

    // Score 90+ but only 1 pain → demoted to B
    const tier2 = computeTier(92, [
        { type: "NO_WEBSITE", severity: 4, evidence: "test", source: "heuristic" },
    ]);
    assert(tier2 === "B", `Score 92 + 1 pain = ${tier2} (expected B, demoted from S)`);

    // Score 85 + 2 pains → A
    const tier3 = computeTier(85, [
        { type: "SPEED", severity: 3, evidence: "test", source: "site_scan" },
        { type: "CONVERSION", severity: 4, evidence: "test", source: "site_scan" },
    ]);
    assert(tier3 === "A", `Score 85 + 2 pains = ${tier3} (expected A)`);

    // Score 85 + 0 pains → B (demoted)
    const tier4 = computeTier(85, []);
    assert(tier4 === "B", `Score 85 + 0 pains = ${tier4} (expected B, demoted from A)`);

    // Score 72 → B
    const tier5 = computeTier(72, []);
    assert(tier5 === "B", `Score 72 = ${tier5} (expected B)`);

    // Score 60 → C
    const tier6 = computeTier(60, []);
    assert(tier6 === "C", `Score 60 = ${tier6} (expected C)`);

    // Score 40 → D
    const tier7 = computeTier(40, []);
    assert(tier7 === "D", `Score 40 = ${tier7} (expected D)`);

    // Hard rule: pain signals severity < 2 don't count for S/A gate
    const tier8 = computeTier(93, [
        { type: "SPEED", severity: 1, evidence: "test", source: "site_scan" },
        { type: "TRUST", severity: 1, evidence: "test", source: "site_scan" },
    ]);
    assert(tier8 === "B", `Score 93 + 2 low-severity pains = ${tier8} (expected B, severity too low)`);
}

// ═══════════════════════════════════════════════
// DEDUPE TESTS
// ═══════════════════════════════════════════════
console.log("\n═══ DEDUPLICATION ═══");

{
    // Phone takes priority
    const d1 = generateDedupeKey("Acme Roofing Ltd.", "Kitchener", "(519) 555-1234", "https://acmeroofing.ca", "123 Main St");
    assert(d1.matchedBy === "phone" && d1.key === "phone:5195551234", `Phone priority: ${d1.key} matched by ${d1.matchedBy}`);

    // Domain when no phone
    const d2 = generateDedupeKey("Acme Roofing Ltd.", "Kitchener", null, "https://www.acmeroofing.ca", "123 Main St");
    assert(d2.matchedBy === "domain" && d2.key === "domain:acmeroofing.ca", `Domain fallback: ${d2.key} matched by ${d2.matchedBy}`);

    // Address when no phone or domain
    const d3 = generateDedupeKey("Acme Roofing Ltd.", "Kitchener", null, null, "123 Main St, Unit 4");
    assert(d3.matchedBy === "address", `Address fallback: ${d3.key} matched by ${d3.matchedBy}`);

    // Name+city as last resort
    const d4 = generateDedupeKey("Acme Roofing Ltd.", "Kitchener", null, null, null);
    assert(d4.matchedBy === "name_city", `Name+city fallback: ${d4.key} matched by ${d4.matchedBy}`);

    // Name normalization
    assert(normalizeName("Acme Roofing Ltd.") === normalizeName("ACME ROOFING LTD"), "Name normalization: case + suffix");
    assert(normalizeName("Bob's Inc.") === normalizeName("bobs inc"), "Name normalization: apostrophe");

    // Domain extraction
    assert(extractDomain("https://www.acmeroofing.ca/about") === "acmeroofing.ca", "Domain extraction strips www");
    assert(extractDomain(null) === null, "Domain extraction handles null");

    // Phone normalization
    assert(normalizePhone("(519) 555-1234") === "5195551234", "Phone normalize: brackets");
    assert(normalizePhone("1-519-555-1234") === "5195551234", "Phone normalize: country code");
    assert(normalizePhone(null) === null, "Phone normalize: null");

    // Social domains excluded from domain dedupe
    const d5 = generateDedupeKey("Test", "City", null, "https://facebook.com/test", null);
    assert(d5.matchedBy !== "domain", `Social domain excluded: matched by ${d5.matchedBy}`);
}

// ═══════════════════════════════════════════════
// CONTACT VALIDATION TESTS
// ═══════════════════════════════════════════════
console.log("\n═══ CONTACT VALIDATION ═══");

{
    const e1 = validateEmail("john.smith@acmeroofing.ca");
    assert(e1.type === "owner" && e1.confidence >= 0.7, `Business owner email: type=${e1.type} conf=${e1.confidence}`);

    const e2 = validateEmail("info@acmeroofing.ca");
    assert(e2.type === "generic" && e2.confidence <= 0.5, `Generic email: type=${e2.type} conf=${e2.confidence}`);

    const e3 = validateEmail("john@gmail.com");
    assert(e3.type === "owner" && e3.confidence >= 0.5, `Free provider personal: type=${e3.type} conf=${e3.confidence}`);

    const e4 = validateEmail("test@mailinator.com");
    assert(e4.confidence <= 0.1, `Disposable email: conf=${e4.confidence}`);

    const e5 = validateEmail(null);
    assert(e5.confidence === 0, `Null email: conf=${e5.confidence}`);

    const e6 = validateEmail("noreply@company.com");
    assert(e6.confidence <= 0.1, `NoReply email: conf=${e6.confidence}`);

    const p1 = validatePhone("(519) 555-1234");
    assert(p1.confidence >= 0.8, `Ontario phone: conf=${p1.confidence}`);

    const p2 = validatePhone("(604) 555-1234");
    assert(p2.confidence >= 0.5 && p2.confidence < 0.9, `BC phone: conf=${p2.confidence}`);

    const p3 = validatePhone("123");
    assert(p3.confidence <= 0.2, `Short phone: conf=${p3.confidence}`);
}

// ═══════════════════════════════════════════════
// DISQUALIFIER TESTS
// ═══════════════════════════════════════════════
console.log("\n═══ DISQUALIFIERS ═══");

{
    // Inactive business
    const dq1 = checkDisqualifiers({
        businessName: "ABC Corp", niche: "Roofers", category: "Roofing",
        city: "Kitchener", rating: 0, reviewCount: 0,
        websiteStatus: "MISSING", websiteContent: "",
        assessment: null, painSignals: [], axiomScore: 30, tier: "D",
    });
    assert(dq1.disqualified === true, `Inactive business (0 reviews + no site) = disqualified`);
    assert(dq1.reasons.length >= 1, `Has ${dq1.reasons.length} reason(s)`);

    // Low-ROI industry
    const dq2 = checkDisqualifiers({
        businessName: "Church of Light", niche: "Church", category: "worship",
        city: "Kitchener", rating: 5, reviewCount: 100,
        websiteStatus: "ACTIVE", websiteContent: "",
        assessment: null, painSignals: [], axiomScore: 60, tier: "C",
    });
    assert(dq2.disqualified === true, `Low-ROI church = disqualified`);

    // High-performing website
    const dq3 = checkDisqualifiers({
        businessName: "Pro Corp", niche: "Dentist", category: "Dental",
        city: "Kitchener", rating: 4.8, reviewCount: 200,
        websiteStatus: "ACTIVE", websiteContent: "",
        assessment: { speedRisk: 0, conversionRisk: 1, trustRisk: 0, seoRisk: 0, overallGrade: "A", topFixes: [] },
        painSignals: [], axiomScore: 70, tier: "B",
    });
    assert(dq3.disqualified === true, `High-performing A-grade site = disqualified (no pain)`);

    // Valid lead should NOT be disqualified
    const dq4 = checkDisqualifiers({
        businessName: "Smith Roofing", niche: "Roofers", category: "Roofing",
        city: "Kitchener", rating: 4.5, reviewCount: 50,
        websiteStatus: "MISSING", websiteContent: "",
        assessment: null,
        painSignals: [{ type: "NO_WEBSITE", severity: 4, evidence: "test", source: "heuristic" }],
        axiomScore: 75, tier: "B",
    });
    assert(dq4.disqualified === false, `Valid roofer lead = NOT disqualified`);

    // Very low rating
    const dq5 = checkDisqualifiers({
        businessName: "Bad Plumbing", niche: "Plumbing", category: "Plumber",
        city: "Kitchener", rating: 1.5, reviewCount: 30,
        websiteStatus: "ACTIVE", websiteContent: "",
        assessment: null, painSignals: [], axiomScore: 45, tier: "D",
    });
    assert(dq5.disqualified === true, `Low rating business = disqualified`);
}

// ═══════════════════════════════════════════════
// FULL SCORE INTEGRATION TEST
// ═══════════════════════════════════════════════
console.log("\n═══ FULL INTEGRATION ═══");

{
    // Strong no-website lead: High-LTV, no web, great reviews, reachable, local
    // Pain bucket maxes at 20 for no-website (vs 40 for bad-website), so max realistic ~60
    const result1 = computeAxiomScore({
        niche: "Roofers", category: "Roofing", city: "Kitchener",
        rating: 4.6, reviewCount: 80,
        websiteStatus: "MISSING",
        websiteContent: "",
        assessment: null,
        painSignals: [
            { type: "NO_WEBSITE", severity: 4, evidence: "No site found", source: "maps_data" },
            { type: "CONVERSION", severity: 3, evidence: "Losing leads", source: "heuristic" },
        ],
        contact: { emailType: "owner", emailConfidence: 0.8, phoneConfidence: 0.9 },
        hasContactForm: false,
        hasSocialMessaging: true,
        reviewContent: "",
    });
    assert(result1.axiomScore >= 55, `Strong no-site lead score: ${result1.axiomScore} (expected ≥55)`);
    assert(["C", "B"].includes(result1.tier), `Strong no-site lead tier: ${result1.tier} (expected C/B)`);

    // Perfect bad-website lead: High-LTV, terrible site, reachable, local
    const result1b = computeAxiomScore({
        niche: "Dentist", category: "Dental", city: "Kitchener",
        rating: 4.8, reviewCount: 120,
        websiteStatus: "ACTIVE",
        websiteContent: "our services pricing book appointment team locations hiring since 2008",
        assessment: { speedRisk: 5, conversionRisk: 5, trustRisk: 4, seoRisk: 3, overallGrade: "D", topFixes: ["Add booking", "Fix speed", "Add SSL"] },
        painSignals: [
            { type: "SPEED", severity: 5, evidence: "Page loads in 8s", source: "site_scan" },
            { type: "CONVERSION", severity: 5, evidence: "No booking form", source: "site_scan" },
            { type: "TRUST", severity: 4, evidence: "No SSL", source: "site_scan" },
        ],
        contact: { emailType: "owner", emailConfidence: 0.85, phoneConfidence: 0.9 },
        hasContactForm: false,
        hasSocialMessaging: true,
        reviewContent: "",
    });
    assert(result1b.axiomScore >= 80, `Bad-website lead score: ${result1b.axiomScore} (expected ≥80)`);
    assert(["S", "A"].includes(result1b.tier), `Bad-website lead tier: ${result1b.tier} (expected S/A)`);

    // Garbage lead: no contact, non-local, low-value
    const result2 = computeAxiomScore({
        niche: "Church", category: "Worship", city: "Vancouver",
        rating: 0, reviewCount: 0,
        websiteStatus: "MISSING",
        websiteContent: "",
        assessment: null,
        painSignals: [],
        contact: { emailType: "unknown", emailConfidence: 0, phoneConfidence: 0 },
        hasContactForm: false,
        hasSocialMessaging: false,
        reviewContent: "",
    });
    assert(result2.axiomScore <= 30, `Garbage lead score: ${result2.axiomScore} (expected ≤30)`);
    assert(result2.tier === "D", `Garbage lead tier: ${result2.tier} (expected D)`);
}

// ═══════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════
console.log(`\n${"═".repeat(50)}`);
console.log(`RESULTS: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
if (failed === 0) {
    console.log("✅ ALL TESTS PASSED");
} else {
    console.log("❌ SOME TESTS FAILED");
    process.exit(1);
}
