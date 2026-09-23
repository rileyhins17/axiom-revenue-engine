import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

import { AutomationConsole } from "@/components/automation/automation-console";
import type { AutomationOperatorConsoleData } from "@/lib/automation-operator-view";

const router = {
  back() {},
  forward() {},
  refresh() {},
  push() {},
  replace() {},
  prefetch() {},
  bfcacheId: "test",
} satisfies AppRouterInstance;

function renderConsole(options: {
  data?: AutomationOperatorConsoleData | null;
  canOpenBusinessReview?: boolean;
  canControlEmergencyStop?: boolean;
} = {}) {
  return renderToStaticMarkup(createElement(
    AppRouterContext.Provider,
    { value: router },
    createElement(AutomationConsole, {
      data: options.data ?? null,
      canOpenBusinessReview: options.canOpenBusinessReview ?? true,
      canControlEmergencyStop: options.canControlEmergencyStop ?? true,
    }),
  ));
}

function statusData(emergencyPaused: boolean): AutomationOperatorConsoleData {
  return {
    generatedAt: "2026-09-23T12:00:00.000Z",
    settings: { emergencyPaused },
  } as AutomationOperatorConsoleData;
}

test("follow-through page points owners to identity review and human client actions", () => {
  const html = renderConsole({ data: statusData(false) });

  assert.match(html, /<h1[^>]*>Follow-through<\/h1>/);
  assert.match(html, /Review proposed businesses/);
  assert.match(html, /href="\/leads\/m2\/identity"/);
  assert.doesNotMatch(html, /href="\/leads\/m2"/);
  assert.match(html, /Client follow-ups/);
  assert.match(html, /href="\/clients"/);
  assert.match(html, /Email is not ready/);
  assert.match(html, /owner inbox and reply path/);

  const restrictedHtml = renderConsole({ data: statusData(false), canOpenBusinessReview: false });
  assert.match(restrictedHtml, /An admin owner can review the proposed businesses/);
  assert.doesNotMatch(restrictedHtml, /href="\/leads\/m2\/identity"/);
});

test("follow-through page keeps stop state and admin-only stop control visible", () => {
  const activeHtml = renderConsole({ data: statusData(true) });
  assert.match(activeHtml, /Automation stop/);
  assert.match(activeHtml, /On\. New automated intake, queueing, and sending are reported stopped\./);
  assert.match(activeHtml, /href="\/settings"/);
  assert.doesNotMatch(activeHtml, />Stop new automated work</);

  const availableHtml = renderConsole({ data: statusData(false), canControlEmergencyStop: false });
  assert.match(availableHtml, /Off at the last successful check\./);
  assert.match(availableHtml, /Only an admin owner can turn on or verify the stop/);
  assert.doesNotMatch(availableHtml, />Stop new automated work</);

  const unavailableHtml = renderConsole({ data: null });
  assert.match(unavailableHtml, /Stop status could not be checked/);
  assert.match(unavailableHtml, /This does not turn on the stop/);
  assert.match(unavailableHtml, />Stop new automated work</);
});
