import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";

import { loadM2ManualObservationDossier, M2ManualWebsiteObservations } from "./m2-manual-website-observations";
import {
  buildM2ManualWebsiteObservation,
  sealM2ManualWebsiteObservation,
} from "@/lib/revenue-engine/m2-manual-website-observation";

test("owner dossier reload fetches and renders the persisted synthetic manual observation", async () => {
  const target = {
    reviewId: "M2-01",
    businessName: "Synthetic Example HVAC",
    approvedWebsiteUrl: "https://synthetic.example.invalid/",
    businessIdentityDigest: "a".repeat(64),
  };
  const record = sealM2ManualWebsiteObservation(buildM2ManualWebsiteObservation({
    commandId: "cd019946-3c26-4c6c-9d57-577f9eaf50b7",
    reviewId: target.reviewId,
    observedUrl: "https://synthetic.example.invalid/services",
    confidence: "MEDIUM",
    evidenceState: "OBSERVED",
    observation: "The service categories are grouped in a single narrow column.",
    noCopiedOrPersonalData: true,
  }, target, "RILEY", "2026-09-23T14:30:00.000Z"));

  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const dossier = await loadM2ManualObservationDossier(async (input, init) => {
    requests.push({ url: String(input), init });
    return Response.json({ version: "kw-m2-manual-observation-dossier-v1", targets: [{ ...target, observations: [record] }] });
  });

  assert.equal(requests[0]?.url, "/api/leads/m2/manual-observations");
  assert.equal(requests[0]?.init?.method, "GET");
  assert.equal(requests[0]?.init?.cache, "no-store");
  assert.equal(dossier.targets[0]?.reviewId, "M2-01");
  assert.equal(dossier.targets[0]?.observations[0]?.observation, "The service categories are grouped in a single narrow column.");
  assert.equal(dossier.targets[0]?.observations[0]?.assessment.qualification, "RESEARCH");
});

test("manual observations are a compact collapsed disclosure by default", () => {
  const markup = renderToStaticMarkup(React.createElement(M2ManualWebsiteObservations));
  assert.match(markup, /aria-expanded="false"/);
  assert.match(markup, /Open optional observations/);
  assert.doesNotMatch(markup, /does not satisfy, advance, or count toward any real M2 assessment gate/);
  assert.doesNotMatch(markup, /Save manual observation/);
});
