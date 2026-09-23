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
  canControlEmergencyStop?: boolean;
} = {}) {
  return renderToStaticMarkup(createElement(
    AppRouterContext.Provider,
    { value: router },
    createElement(AutomationConsole, {
      data: options.data ?? null,
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

test("follow-through page avoids stale business review prompts and keeps client work and email status clear", () => {
  const html = renderConsole({ data: statusData(false) });

  assert.match(html, /<h1[^>]*>Follow-through<\/h1>/);
  assert.doesNotMatch(html, /Check the proposed business list|Open business review|business review/i);
  assert.doesNotMatch(html, /href="\/leads\/m2(?:\/identity)?"/);
  assert.match(html, /Client follow-ups/);
  assert.match(html, /href="\/clients"/);
  assert.match(html, /Email is not ready/);
  assert.match(html, /owner inbox and reply path/);

  const restrictedHtml = renderConsole({ data: statusData(false), canControlEmergencyStop: false });
  assert.match(restrictedHtml, /Only an admin owner can turn on or verify the stop/);
  assert.doesNotMatch(restrictedHtml, /Stop new automated work/);
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
