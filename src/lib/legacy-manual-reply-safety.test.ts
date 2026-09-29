import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { requireLegacyManualReplySafety } from "./legacy-manual-reply-safety";

type FakeState = {
  settings?: { emergencyPaused: boolean; globalPaused: boolean } | null;
  suppression?: { id: string } | null;
};

function fakePrisma(state: FakeState) {
  return {
    outreachAutomationSetting: {
      findFirst: async () => state.settings,
    },
    outreachSuppression: {
      findFirst: async () => state.suppression,
    },
  };
}

function recordingPrisma(state: FakeState, queries: unknown[]) {
  return {
    outreachAutomationSetting: {
      findFirst: async () => state.settings,
    },
    outreachSuppression: {
      findFirst: async (args: unknown) => {
        queries.push(args);
        return state.suppression;
      },
    },
  };
}

const lead = {
  id: 42,
  email: "owner@business.ca",
  outreachStatus: "REPLIED",
  websiteDomain: "business.ca",
};

test("manual replies fail closed when stop state is unavailable or active", async () => {
  await assert.rejects(
    requireLegacyManualReplySafety(fakePrisma({ settings: null }), lead, "owner@business.ca"),
    /MANUAL_REPLY_SAFETY_STATE_UNAVAILABLE/,
  );
  await assert.rejects(
    requireLegacyManualReplySafety(
      fakePrisma({ settings: { emergencyPaused: true, globalPaused: false } }),
      lead,
      "owner@business.ca",
    ),
    /MANUAL_REPLY_EMERGENCY_STOP_ACTIVE/,
  );
  await assert.rejects(
    requireLegacyManualReplySafety(
      fakePrisma({ settings: { emergencyPaused: false, globalPaused: true } }),
      lead,
      "owner@business.ca",
    ),
    /MANUAL_REPLY_GLOBAL_STOP_ACTIVE/,
  );
});

test("manual replies reject business, recipient, and domain suppressions", async () => {
  await assert.rejects(
    requireLegacyManualReplySafety(
      fakePrisma({ settings: { emergencyPaused: false, globalPaused: false } }),
      { ...lead, outreachStatus: "SUPPRESSED" },
      "owner@business.ca",
    ),
    /MANUAL_REPLY_BUSINESS_SUPPRESSED/,
  );

  const queries: unknown[] = [];
  await assert.rejects(
    requireLegacyManualReplySafety(
      recordingPrisma({
        settings: { emergencyPaused: false, globalPaused: false },
        suppression: { id: "suppression-1" },
      }, queries),
      lead,
      "old-owner@business.ca",
    ),
    /MANUAL_REPLY_RECIPIENT_SUPPRESSED/,
  );
  assert.match(JSON.stringify(queries), /"leadId":42/);
  assert.match(JSON.stringify(queries), /"email":"old-owner@business.ca"/);
  assert.match(JSON.stringify(queries), /"domain":"business.ca"/);
});

test("manual replies fail closed when suppression state cannot be read", async () => {
  const prisma = {
    outreachAutomationSetting: {
      findFirst: async () => ({ emergencyPaused: false, globalPaused: false }),
    },
    outreachSuppression: {
      findFirst: async () => { throw new Error("database unavailable"); },
    },
  };
  await assert.rejects(
    requireLegacyManualReplySafety(prisma, lead, "owner@business.ca"),
    /database unavailable/,
  );
});

test("manual replies remain available when every stop and suppression check is clear", async () => {
  await assert.doesNotReject(
    requireLegacyManualReplySafety(
      fakePrisma({
        settings: { emergencyPaused: false, globalPaused: false },
        suppression: null,
      }),
      lead,
      "owner@business.ca",
    ),
  );
});

test("the legacy reply route runs the safety gate before credentials and Gmail", () => {
  const route = readFileSync(
    new URL("../app/api/clients/[id]/emails/reply/route.ts", import.meta.url),
    "utf8",
  );
  const gate = route.indexOf("await requireLegacyManualReplySafety(");
  const credentials = route.indexOf("await getValidAccessToken(");
  const send = route.indexOf("await sendGmailReply(");
  assert.ok(gate >= 0, "reply route must call the manual reply safety gate");
  assert.ok(credentials > gate, "safety gate must run before credential resolution");
  assert.ok(send > credentials, "Gmail send must remain after the safety gate");
});
