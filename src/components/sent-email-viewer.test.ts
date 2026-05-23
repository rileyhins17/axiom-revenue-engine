import assert from "node:assert/strict";
import { test } from "node:test";

import { buildEmailHtmlSrcDoc } from "@/components/sent-email-viewer";

test("email html srcdoc uses premium reader typography and a constrained message column", () => {
  const srcDoc = buildEmailHtmlSrcDoc("<p>Hello</p>");

  assert.match(srcDoc, /font:15\.5px\/1\.74 "Aptos"/);
  assert.match(srcDoc, /max-width:640px/);
  assert.match(srcDoc, /<base target="_blank">/);
  assert.match(srcDoc, /<main class="message">/);
});

test("email html srcdoc extracts saved full-document email bodies before wrapping", () => {
  const srcDoc = buildEmailHtmlSrcDoc("<html><head><style>body{padding:0}</style></head><body><p>Readable</p></body></html>");

  assert.match(srcDoc, /<main class="message"><p>Readable<\/p><\/main>/);
  assert.doesNotMatch(srcDoc, /<main class="message"><html>/);
});
