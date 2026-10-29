import assert from "node:assert/strict";
import test from "node:test";

import { HtmlPageFactsSchema } from "@/lib/revenue-engine/html-page-facts";
import {
  PRIVATE_KW_HTML_STRUCTURE_VERSION,
  PrivateKwHtmlStructureSchema,
  projectPrivateKwHtmlStructure,
} from "@/lib/revenue-engine/private-kw-html-structure";

function facts() {
  return HtmlPageFactsSchema.parse({
    extractorVersion: "html-page-facts-v1",
    captureVersion: "synthetic-capture-v1",
    capturedAt: "2026-09-22T16:00:00.000Z",
    pageKind: "HOME",
    url: "https://fixture.example/",
    title: "TITLE_PRIVATE_SENTINEL",
    metaDescription: "META_PRIVATE_SENTINEL",
    visibleText: "VISIBLE_PRIVATE_SENTINEL",
    actions: [
      { kind: "QUOTE", label: "ACTION_LABEL_PRIVATE_SENTINEL", href: "https://fixture.example/q?email=secret@example.test", notExplicitlyHidden: true, aboveFold: "UNKNOWN" },
      { kind: "PHONE", label: "PHONE_PRIVATE_SENTINEL", href: "tel:+15555550123", notExplicitlyHidden: true, aboveFold: "UNKNOWN" },
      { kind: "QUOTE", label: "Duplicate quote action", href: null, notExplicitlyHidden: true, aboveFold: "UNKNOWN" },
    ],
    forms: [
      { actionUrl: "https://fixture.example/send?email=form-secret@example.test", method: "POST", notExplicitlyHidden: true, hasEnabledSubmitControl: true },
      { actionUrl: null, method: "GET", notExplicitlyHidden: true, hasEnabledSubmitControl: false },
    ],
    trustSignals: ["WARRANTY", "REVIEW", "WARRANTY"],
    structuredDataTypes: ["PRIVATE_STRUCTURED_DATA_SENTINEL"],
    discoveredInternalLinks: [
      { url: "https://fixture.example/contact?phone=5550100", label: "LINK_LABEL_PRIVATE_SENTINEL", kindHint: "CONTACT" },
      { url: "https://fixture.example/service", label: "Service link", kindHint: "SERVICE" },
      { url: "https://fixture.example/service-2", label: "Service link 2", kindHint: "SERVICE" },
      { url: "https://fixture.example/about", label: "About link", kindHint: "ABOUT" },
      { url: "https://fixture.example/", label: "Home link", kindHint: "HOME" },
      { url: "https://fixture.example/other", label: "Other link", kindHint: "OTHER" },
    ],
    complete: true,
    warnings: ["PRIVATE_WARNING_SENTINEL"],
    policy: { maxTokens: 50_000, maxTextChars: 100_000, maxJsonLdChars: 100_000 },
    tokenCount: 42,
  });
}

test("projects only deterministic bounded structure and no source text or contact values", () => {
  const projected = projectPrivateKwHtmlStructure(facts());

  assert.deepEqual(projected, {
    version: PRIVATE_KW_HTML_STRUCTURE_VERSION,
    hasTitle: true,
    hasMetaDescription: true,
    actionKinds: ["PHONE", "QUOTE"],
    formCount: 2,
    formsWithEnabledSubmitCount: 1,
    trustSignals: ["REVIEW", "WARRANTY"],
    internalLinkKindCounts: { HOME: 1, SERVICE: 2, ABOUT: 1, CONTACT: 1, OTHER: 1 },
  });

  const json = JSON.stringify(projected);
  for (const privateValue of [
    "TITLE_PRIVATE_SENTINEL",
    "META_PRIVATE_SENTINEL",
    "VISIBLE_PRIVATE_SENTINEL",
    "ACTION_LABEL_PRIVATE_SENTINEL",
    "PHONE_PRIVATE_SENTINEL",
    "secret@example.test",
    "+15555550123",
    "form-secret@example.test",
    "LINK_LABEL_PRIVATE_SENTINEL",
    "PRIVATE_STRUCTURED_DATA_SENTINEL",
    "PRIVATE_WARNING_SENTINEL",
  ]) {
    assert.doesNotMatch(json, new RegExp(privateValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("output schema rejects unbounded counts, unknown enums, duplicates, and inconsistent forms", () => {
  const valid = projectPrivateKwHtmlStructure(facts());

  assert.equal(PrivateKwHtmlStructureSchema.safeParse({ ...valid, formCount: 31 }).success, false);
  assert.equal(PrivateKwHtmlStructureSchema.safeParse({ ...valid, formsWithEnabledSubmitCount: 3 }).success, false);
  assert.equal(PrivateKwHtmlStructureSchema.safeParse({ ...valid, actionKinds: ["PHONE", "UNRECOGNIZED"] }).success, false);
  assert.equal(PrivateKwHtmlStructureSchema.safeParse({ ...valid, trustSignals: ["REVIEW", "REVIEW"] }).success, false);
  assert.equal(PrivateKwHtmlStructureSchema.safeParse({
    ...valid,
    internalLinkKindCounts: { ...valid.internalLinkKindCounts, OTHER: 101 },
  }).success, false);
});

test("projector rejects malformed extractor facts before projecting", () => {
  assert.throws(() => projectPrivateKwHtmlStructure({ ...facts(), actions: [{ kind: "UNKNOWN" }] } as never));
});
