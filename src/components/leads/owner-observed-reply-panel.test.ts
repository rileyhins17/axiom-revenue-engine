import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { OwnerObservedReplyPanel } from "@/components/leads/owner-observed-reply-panel";

test("observed reply panel starts compact with the entry form collapsed", () => {
  const html = renderToStaticMarkup(createElement(OwnerObservedReplyPanel, {
    businessId: "business:one",
    stopState: "CLEAR",
    contactPoints: [
      { contactPointId: "email:one", businessId: "business:one", channel: "EMAIL", label: "Work", value: "owner@example.test" },
      { contactPointId: "phone:one", businessId: "business:one", channel: "PHONE", label: "Office", value: "+15555550123" },
      { contactPointId: "email:other", businessId: "business:other", channel: "EMAIL", label: "Other", value: "other@example.test" },
    ],
  }));

  assert.match(html, /Observed email replies/);
  assert.match(html, /Add reply/);
  assert.match(html, /Loading saved replies/);
  assert.doesNotMatch(html, /<form/);
  assert.doesNotMatch(html, /message body|provider details/i);
});

test("observed reply panel reads history without offering a new action when no current email contact exists", () => {
  const html = renderToStaticMarkup(createElement(OwnerObservedReplyPanel, {
    businessId: "business:one",
    stopState: "CLEAR",
    contactPoints: [{ contactPointId: "phone:one", businessId: "business:one", channel: "PHONE", label: "Office", value: "+15555550123" }],
  }));

  assert.match(html, /Loading saved replies/);
  assert.doesNotMatch(html, /Add reply|<form/);
});
