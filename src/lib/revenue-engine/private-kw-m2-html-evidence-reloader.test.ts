import assert from "node:assert/strict";
import test from "node:test";

import { createPrivateKwLocalHtmlEvidenceStore } from "@/lib/revenue-engine/private-kw-local-html-evidence-store";

test("Task4 has a pathless zero-write Task3 evidence reader", () => {
  const store = createPrivateKwLocalHtmlEvidenceStore();
  assert.equal(typeof store.reloadPrivateKwHtmlEvidenceReadOnly, "function");
});
