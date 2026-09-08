import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { OwnerLeadEvaluationWorkspace } from "@/components/leads/owner-lead-evaluation-workspace";

test("quality lab starts as a plain-language, zero-authority file review", () => {
  const html = renderToStaticMarkup(createElement(OwnerLeadEvaluationWorkspace));

  assert.match(html, /<h1[^>]*>Quality Lab<\/h1>/);
  assert.match(html, /Review only · no outreach/);
  assert.match(html, /Load the exact 50-business review checkpoint/);
  assert.match(html, /data-quality-lab-ready="false"/);
  assert.match(html, /Starting Quality Lab…/);
  assert.match(html, /type="file"[^>]*disabled=""/);
  assert.match(html, /Nothing is uploaded to a provider or written to the database/);
  assert.match(html, /cannot acquire leads, call providers, change qualification/);
  assert.match(html, /href="\/leads"/);
  assert.doesNotMatch(html, /href="mailto:/);
  assert.doesNotMatch(html, /href="tel:/);
  assert.doesNotMatch(html, />Send</);
  assert.doesNotMatch(html, />Approve</);
});
