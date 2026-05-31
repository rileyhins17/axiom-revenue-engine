import { strict as assert } from "node:assert";
import test from "node:test";

import { resolvePublicBusinessEmail, type EmailDiscoveryPage } from "./public-email-intelligence";

function page(text: string, links: EmailDiscoveryPage["links"] = []): EmailDiscoveryPage {
  return {
    url: "https://example-roofing.ca/contact",
    role: "contact",
    sourceLabel: "contact page",
    text,
    links,
  };
}

test("resolvePublicBusinessEmail does not select generic or sales-style role inboxes", () => {
  const result = resolvePublicBusinessEmail({
    businessName: "Example Roofing",
    businessWebsite: "https://example-roofing.ca",
    pages: [
      page("Email us at info@example-roofing.ca or sales@example-roofing.ca for quotes.", [
        { href: "mailto:marketing@example-roofing.ca", text: "Marketing" },
      ]),
    ],
  });

  assert.equal(result.email, "");
  assert.equal(result.emailType, "unknown");
  assert.match(result.reason, /generic|role/i);
  assert.equal(result.candidates.length, 3);
});

test("resolvePublicBusinessEmail prefers a person inbox over generic candidates", () => {
  const result = resolvePublicBusinessEmail({
    businessName: "Example Roofing",
    businessWebsite: "https://example-roofing.ca",
    ownerName: "Sarah Lee",
    pages: [
      page("For estimates email info@example-roofing.ca. Owner Sarah Lee handles projects directly.", [
        { href: "mailto:sarah.lee@example-roofing.ca", text: "Email Sarah Lee" },
      ]),
    ],
  });

  assert.equal(result.email, "sarah.lee@example-roofing.ca");
  assert.equal(result.emailType, "owner");
});

test("resolvePublicBusinessEmail canonicalizes encoded mailto addresses", () => {
  const result = resolvePublicBusinessEmail({
    businessName: "Example Roofing",
    businessWebsite: "https://example-roofing.ca",
    ownerName: "Sarah Lee",
    pages: [
      page("Owner Sarah Lee handles projects directly.", [
        { href: "mailto:%20Sarah.Lee%40Example-Roofing.ca?subject=Estimate", text: "Email Sarah" },
      ]),
    ],
  });

  assert.equal(result.email, "sarah.lee@example-roofing.ca");
  assert.equal(result.emailType, "owner");
});

test("resolvePublicBusinessEmail extracts the email from appended JSON-LD structured data", () => {
  // Mirrors what the crawler now appends: body.innerText followed by a
  // [STRUCTURED-DATA] block containing schema.org JSON-LD. The owner email
  // only exists in the JSON-LD, never in visible body text — the prior
  // innerText-only capture would have missed it entirely.
  const bodyText = "Owner Sarah Lee handles every roofing project across the city.";
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "RoofingContractor",
    name: "Example Roofing",
    email: "sarah.lee@example-roofing.ca",
    url: "https://example-roofing.ca",
  });
  const combined = `${bodyText}\n\n[STRUCTURED-DATA]\n${jsonLd}`;

  const result = resolvePublicBusinessEmail({
    businessName: "Example Roofing",
    businessWebsite: "https://example-roofing.ca",
    ownerName: "Sarah Lee",
    pages: [page(combined)],
  });

  assert.equal(result.email, "sarah.lee@example-roofing.ca");
  assert.equal(result.emailType, "owner");
});
