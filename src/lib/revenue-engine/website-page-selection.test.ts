import assert from "node:assert/strict";
import test from "node:test";

import { HTML_PAGE_FACTS_VERSION, type HtmlPageFacts } from "@/lib/revenue-engine/html-page-facts";
import {
  WEBSITE_PAGE_SELECTION_VERSION,
  WebsitePageSelectionPlanSchema,
  defaultWebsitePageSelectionPolicy,
  planWebsitePages,
  type WebsitePageSelectionRequest,
} from "@/lib/revenue-engine/website-page-selection";
import { WEBSITE_CAPTURE_VERSION } from "@/lib/revenue-engine/website-capture";

const HOME_URL = "https://fixture-roofing.ca/";
const CAPTURED_AT = "2026-08-22T20:00:00.000Z";
const PLANNED_AT = "2026-08-22T21:00:00.000Z";

type Link = HtmlPageFacts["discoveredInternalLinks"][number];

function link(path: string, label: string, kindHint: Link["kindHint"]): Link {
  return { url: new URL(path, HOME_URL).href, label, kindHint };
}

function homepageFacts(links: Link[], complete = true): HtmlPageFacts {
  return {
    extractorVersion: HTML_PAGE_FACTS_VERSION,
    captureVersion: WEBSITE_CAPTURE_VERSION,
    capturedAt: CAPTURED_AT,
    pageKind: "HOME",
    url: HOME_URL,
    title: "Fixture Roofing",
    metaDescription: "Roof repair in Kitchener.",
    visibleText: "Fixture Roofing provides roof repair in Kitchener.",
    actions: [],
    forms: [],
    trustSignals: [],
    structuredDataTypes: ["RoofingContractor"],
    discoveredInternalLinks: links,
    complete,
    warnings: complete ? [] : ["token_limit_reached"],
    policy: { maxTokens: 50_000, maxTextChars: 100_000, maxJsonLdChars: 100_000 },
    tokenCount: complete ? 100 : 50_001,
  };
}

function request(links: Link[], complete = true): WebsitePageSelectionRequest {
  return {
    selectionVersion: WEBSITE_PAGE_SELECTION_VERSION,
    selectionId: "11111111-1111-4111-8111-111111111111",
    businessId: "business:fixture-roofing",
    businessName: "Fixture Roofing",
    niche: "roofing",
    expectedServices: ["roof repair", "roof replacement"],
    plannedAt: PLANNED_AT,
    mode: "SHADOW",
    plannerKind: "DETERMINISTIC_FIXTURE",
    maxCostUsd: 0,
    policy: defaultWebsitePageSelectionPolicy(),
    homepageFacts: homepageFacts(links, complete),
  };
}

const GOOD_LINKS = [
  link("/services", "Services", "SERVICE"),
  link("/roof-repair", "Roof repair", "SERVICE"),
  link("/about", "About us", "ABOUT"),
  link("/contact", "Contact", "CONTACT"),
  link("/privacy", "Privacy policy", "OTHER"),
  link("/blog", "Roofing news", "OTHER"),
];

test("selects one explainable high-signal page per required role at zero cost", () => {
  const first = planWebsitePages(request(GOOD_LINKS));
  const second = planWebsitePages(request([...GOOD_LINKS].reverse()));
  assert.deepEqual(first, second);
  assert.equal(first.status, "READY");
  assert.equal(first.discoveryComplete, true);
  assert.deepEqual(first.missingRequiredPageKinds, []);
  assert.deepEqual(first.selectedPages.map((page) => [page.pageKind, page.url]), [
    ["HOME", HOME_URL],
    ["SERVICE", "https://fixture-roofing.ca/roof-repair"],
    ["ABOUT", "https://fixture-roofing.ca/about"],
    ["CONTACT", "https://fixture-roofing.ca/contact"],
  ]);
  assert.equal(first.budget.totalCostUsd, 0);
  assert.equal(first.budget.providerOperations, 0);
  assert.ok(first.candidateEvaluations.find((candidate) => candidate.url.endsWith("/roof-repair"))?.reasonCodes.includes("matches_expected_service"));
  assert.ok(first.candidateEvaluations.find((candidate) => candidate.url.endsWith("/privacy"))?.reasonCodes.includes("low_value_or_policy_page"));
  assert.throws(
    () => WebsitePageSelectionPlanSchema.parse({
      ...first,
      selectedPages: first.selectedPages.map((page) => page.pageKind === "SERVICE" ? { ...page, score: 0 } : page),
    }),
    /must match its candidate evaluation/,
  );
});

test("common local-business wording works without trusting an upstream kind hint", () => {
  const plan = planWebsitePages(request([
    link("/roof-repair", "Roof repair", "OTHER"),
    link("/why-choose-us", "Why choose us", "OTHER"),
    link("/request-service", "Request service", "OTHER"),
  ]));
  assert.equal(plan.status, "READY");
  assert.deepEqual(plan.selectedPages.map((page) => page.pageKind), ["HOME", "SERVICE", "ABOUT", "CONTACT"]);
});

test("query, policy, file, and homepage-duplicate candidates cannot be selected", () => {
  const plan = planWebsitePages(request([
    link("/", "Contact section", "CONTACT"),
    link("/contact?source=nav", "Contact", "CONTACT"),
    link("/careers", "Join our team", "ABOUT"),
    link("/services.pdf", "Services brochure", "SERVICE"),
    link("/roof-repair", "Roof repair", "SERVICE"),
  ]));
  assert.equal(plan.status, "PARTIAL");
  assert.deepEqual(plan.missingRequiredPageKinds, ["ABOUT", "CONTACT"]);
  assert.equal(plan.selectedPages.find((page) => page.pageKind === "SERVICE")?.url, "https://fixture-roofing.ca/roof-repair");
  assert.ok(plan.candidateEvaluations.find((candidate) => candidate.url.includes("?"))?.reasonCodes.includes("query_url_excluded"));
  assert.ok(plan.candidateEvaluations.find((candidate) => candidate.url === HOME_URL)?.reasonCodes.includes("homepage_duplicate"));
});

test("global assignment keeps URLs unique when one link could fit two roles", () => {
  const plan = planWebsitePages(request([
    link("/services", "Services", "SERVICE"),
    link("/about-contact", "About and contact", "ABOUT"),
    link("/contact", "Contact", "CONTACT"),
  ]));
  assert.equal(plan.status, "READY");
  assert.equal(new Set(plan.selectedPages.map((page) => page.url)).size, plan.selectedPages.length);
  assert.equal(plan.selectedPages.find((page) => page.pageKind === "ABOUT")?.url, "https://fixture-roofing.ca/about-contact");
  assert.equal(plan.selectedPages.find((page) => page.pageKind === "CONTACT")?.url, "https://fixture-roofing.ca/contact");
});

test("incomplete homepage extraction keeps an otherwise full selection partial", () => {
  const plan = planWebsitePages(request(GOOD_LINKS, false));
  assert.equal(plan.status, "PARTIAL");
  assert.equal(plan.discoveryComplete, false);
  assert.deepEqual(plan.missingRequiredPageKinds, []);
  assert.ok(plan.warnings.includes("homepage_link_discovery_incomplete"));
  assert.throws(
    () => WebsitePageSelectionPlanSchema.parse({ ...plan, status: "READY" }),
    /Only complete discovery/,
  );
});

test("duplicate page identities are deterministic and visible", () => {
  const links = [
    link("http://fixture-roofing.ca/about", "About", "ABOUT"),
    link("https://fixture-roofing.ca/about/", "About our team", "ABOUT"),
    link("/services", "Services", "SERVICE"),
    link("/contact", "Contact", "CONTACT"),
  ];
  const plan = planWebsitePages(request(links));
  assert.equal(plan.selectedPages.find((page) => page.pageKind === "ABOUT")?.url, "https://fixture-roofing.ca/about/" );
  assert.ok(plan.warnings.some((warning) => warning.startsWith("duplicate_page_identity:")));
});

test("cross-site, reserved, stale, and future homepage evidence fail before planning", () => {
  assert.throws(
    () => planWebsitePages(request([{ url: "https://other-fixture.ca/contact", label: "Contact", kindHint: "CONTACT" }])),
    /homepage authority/,
  );
  assert.throws(
    () => planWebsitePages(request([{ url: "http://localhost/contact", label: "Contact", kindHint: "CONTACT" }])),
    /Local, internal, and reserved/,
  );
  assert.throws(
    () => planWebsitePages({ ...request(GOOD_LINKS), plannedAt: "2026-08-24T21:00:00.000Z" }),
    /older than the page-selection freshness window/,
  );
  assert.throws(
    () => planWebsitePages({ ...request(GOOD_LINKS), plannedAt: "2026-08-22T19:00:00.000Z" }),
    /cannot be captured after page selection/,
  );
});
