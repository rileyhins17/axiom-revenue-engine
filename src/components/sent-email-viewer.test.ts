import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { legacyEmailSchema, legacyTimeSchema } from "@/lib/revenue-engine/legacy-mail-contract";

test("legacy mail viewers never execute or fall back to saved HTML", () => {
  for (const file of ["src/components/sent-email-viewer.tsx", "src/components/ClientProfile.tsx"]) {
    const source = readFileSync(file,"utf8");
    assert.doesNotMatch(source, /srcDoc|dangerouslySetInnerHTML|bodyHtml|<iframe/);
    assert.match(source, /bodyPlain/);
  }
});
test("legacy display contract rejects raw HTML and preserves literal plain text", () => {
  const value = { source: "LEGACY_OUTREACH_EMAIL", id: "owner-email", leadId: 1,
    senderEmail: "owner@example.invalid", recipientEmail: "client@example.invalid", subject: "Legacy",
    bodyPlain: '<img src="https://tracking.invalid/pixel">', bodyUnavailable: null, status: "sent",
    sentAt: "2026-09-08T00:00:00Z", failureRecorded: false, businessName: "Synthetic", city: null };
  assert.equal(legacyEmailSchema.parse(value).bodyPlain,value.bodyPlain);
  assert.equal(legacyEmailSchema.safeParse({ ...value, bodyHtml: "<script>bad()</script>" }).success,false);
});

test("SQLite legacy timestamps are UTC and retain the same instant as offset timestamps", () => {
  assert.equal(legacyTimeSchema.parse("2026-09-08 22:00:00"),"2026-09-08T22:00:00.000Z");
  assert.equal(legacyTimeSchema.parse("2026-09-08T18:00:00-04:00"),"2026-09-08T22:00:00.000Z");
  assert.equal(legacyTimeSchema.safeParse("not a date").success,false);
});
