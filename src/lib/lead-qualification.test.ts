import { strict as assert } from "node:assert";
import test from "node:test";

import { hasValidPipelineEmail, normalizePipelineEmail } from "./lead-qualification";

test("pipeline email normalization strips mailto wrappers and encoded whitespace", () => {
  assert.equal(
    normalizePipelineEmail("mailto:%20Owner.Name%40Example-Roofing.ca?subject=Hello"),
    "owner.name@example-roofing.ca",
  );
  assert.equal(normalizePipelineEmail(" <TEAM@Example.ca>, "), "team@example.ca");
});

test("pipeline email validation rejects wrapper text that does not contain an address", () => {
  assert.equal(hasValidPipelineEmail({ email: "mailto:not-an-email", emailType: "owner", emailConfidence: 1 }), false);
});

test("pipeline email validation requires trusted recipient type confidence", () => {
  assert.equal(hasValidPipelineEmail({ email: "owner@example.ca", emailType: "owner", emailConfidence: 0.49 }), false);
  assert.equal(hasValidPipelineEmail({ email: "owner@example.ca", emailType: "owner", emailConfidence: 0.5 }), true);
  assert.equal(hasValidPipelineEmail({ email: "sarah@example.ca", emailType: "staff", emailConfidence: 0.64 }), false);
  assert.equal(hasValidPipelineEmail({ email: "sarah@example.ca", emailType: "staff", emailConfidence: 0.65 }), true);
});

test("pipeline email validation rejects generic and unclassified recipients", () => {
  assert.equal(hasValidPipelineEmail({ email: "info@example.ca", emailType: "generic", emailConfidence: 1 }), false);
  assert.equal(hasValidPipelineEmail({ email: "contact@example.ca", emailType: "owner", emailConfidence: 1 }), false);
  assert.equal(hasValidPipelineEmail({ email: "person@example.ca", emailType: "unknown", emailConfidence: 1 }), false);
});

test("pipeline email validation rejects business role mailboxes that scraper mislabels as owners", () => {
  for (const email of [
    "arborist@tree133.com",
    "trees@boughennurseries.com",
    "payment@littlecreektreefarm.com",
    "ltd@eclipse-electrical.ca",
    "privacy@example.ca",
    "created@example.ca",
    "services@example.ca",
    "ontact@example.ca",
    "rinfo@example.ca",
    "ads@example.ca",
    "excellent@example.ca",
    "metroflow@example.ca",
    "showroom@example.ca",
    "located@example.ca",
    "user@example.ca",
    "atinfo@example.ca",
    "customersupport@example.ca",
    "dmin@example.ca",
    "billing@example.ca",
    "accounts@example.ca",
  ]) {
    assert.equal(hasValidPipelineEmail({ email, emailType: "owner", emailConfidence: 0.95 }), false, email);
  }
});
