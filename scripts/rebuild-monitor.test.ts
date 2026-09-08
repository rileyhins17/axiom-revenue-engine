import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  REBUILD_MONITOR_RELEASE_CHECKS,
  REBUILD_MONITOR_STATES,
  parseRebuildMonitorReleaseProof,
  parseRebuildMonitorState,
  safeRebuildMonitorCommitTitle,
} from "@/lib/rebuild-monitor/contract";
import { applyRebuildMonitorUpdate } from "@/lib/rebuild-monitor/update";
import {
  REBUILD_MONITOR_ROOT,
  isCanonicalMonitorRoot,
} from "./rebuild-monitor-repository";

const seed = () => parseRebuildMonitorState(JSON.parse(readFileSync(
  new URL("../docs/rebuild-monitor/seed.json", import.meta.url),
  "utf8",
)) as unknown);

const checkpoint = {
  sha: "a".repeat(40),
  shortSha: "a".repeat(8),
  title: "Verified local checkpoint",
  branch: "RileyHinsperger/axiom-revenue-engine-rebuild" as const,
  verifiedAt: "2026-09-06T08:00:00.000Z",
};
const releaseProof = {
  proofVersion: "axiom-rebuild-monitor-release-v2" as const,
  sha: checkpoint.sha,
  treeSha: "b".repeat(40),
  branch: checkpoint.branch,
  verifiedAt: checkpoint.verifiedAt,
  checks: [...REBUILD_MONITOR_RELEASE_CHECKS],
};

test("the tracked seed is complete, truthful, and contains every master-plan stage", () => {
  const state = seed();
  assert.equal(state.stages.length, 7);
  assert.deepEqual(
    state.stages.map((stage) => stage.id),
    [
      "privacy-safety",
      "durable-foundation",
      "lead-quality",
      "responsible-outreach",
      "owner-application",
      "kw-pilot",
      "limited-autonomy",
    ],
  );
  assert.equal(state.safety.outboundSending, "OFF");
  assert.equal(state.safety.productionChanges, "NONE");
  assert.equal(state.safety.spendImpactCad, 0);
});

test("monitor commands accept only the exact non-synced canonical checkout", () => {
  assert.equal(isCanonicalMonitorRoot(REBUILD_MONITOR_ROOT), true);
  assert.equal(
    isCanonicalMonitorRoot("C:\\Users\\riley\\OneDrive\\Documents\\ChatGPT\\APE"),
    false,
  );
  assert.equal(isCanonicalMonitorRoot("C:\\Users\\riley\\Google Drive\\APE"), false);
  assert.equal(isCanonicalMonitorRoot("C:\\temp\\axiom-revenue-engine"), false);
});

test("release proof requires every exact gate in execution order", () => {
  assert.deepEqual(parseRebuildMonitorReleaseProof(releaseProof).checks, [
    ...REBUILD_MONITOR_RELEASE_CHECKS,
  ]);
  assert.throws(() => parseRebuildMonitorReleaseProof({
    ...releaseProof,
    checks: [...releaseProof.checks].reverse(),
  }), /execution order/i);
});

test("checkpoint proof includes both email browser gates after all bundle checks", () => {
  const checks: readonly string[] = REBUILD_MONITOR_RELEASE_CHECKS;
  const lastBundle = checks.indexOf("cf:engine:dry-run");
  for (const gate of ["test:saved-email-ui", "test:legacy-email-ui"]) {
    assert.ok(checks.indexOf(gate) > lastBundle, `${gate} must follow bundle checks`);
    assert.ok(checks.indexOf(gate) < checks.indexOf("test:owner-ui"));
  }
  assert.throws(() => parseRebuildMonitorReleaseProof({
    ...releaseProof, proofVersion: "axiom-rebuild-monitor-release-v1",
  }), "Historical v1 receipts cannot stand in for the current gate.");
  assert.throws(() => parseRebuildMonitorReleaseProof({
    ...releaseProof,
    checks: releaseProof.checks.filter((gate) => !["test:saved-email-ui", "test:legacy-email-ui"].includes(gate)),
  }), "A receipt that omits email privacy browser proof must not validate.");
});

test("Linux CI preserves the same email browser gates without concurrent builds", () => {
  const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const commands = [...workflow.matchAll(/^\s+run: (.+)$/gm)].map((match) => match[1]);
  const lastBundle = commands.indexOf("npm run cf:engine:dry-run");
  for (const gate of ["test:saved-email-ui", "test:legacy-email-ui", "test:owner-ui"]) {
    assert.ok(commands.indexOf(`npm run ${gate}`) > lastBundle,
      `${gate} must run sequentially after the last CI bundle check`);
  }
});

test("checkpoint and timeline chronology cannot claim future verification", () => {
  assert.throws(() => parseRebuildMonitorState({
    ...seed(),
    updatedAt: "2026-09-06T08:00:00.000Z",
    lastVerifiedCheckpoint: {
      ...seed().lastVerifiedCheckpoint,
      verifiedAt: "2026-09-06T08:01:00.000Z",
    },
    timeline: [{
      at: "2026-09-06T08:00:00.000Z",
      state: "testing",
      message: "A current update exists.",
    }],
  }), /cannot postdate/i);
  assert.throws(() => parseRebuildMonitorState({
    ...seed(),
    updatedAt: "2026-09-06T08:02:00.000Z",
    timeline: [
      { at: "2026-09-06T08:02:00.000Z", state: "testing", message: "Newest." },
      { at: "2026-09-06T08:03:00.000Z", state: "coding", message: "Impossible future." },
    ],
  }), /newest-first/i);
});

test("Git subjects cannot bypass the visible-copy privacy screen", () => {
  assert.equal(safeRebuildMonitorCommitTitle("feat: verify the owner monitor"), "feat: verify the owner monitor");
  assert.equal(
    safeRebuildMonitorCommitTitle("api_key=must-not-render"),
    "Commit subject hidden by monitor privacy rules.",
  );
  assert.equal(
    safeRebuildMonitorCommitTitle("internal reasoning about a private implementation"),
    "Commit subject hidden by monitor privacy rules.",
  );
});

test("every meaningful work state can append one bounded plain-English transition", () => {
  let state = seed();
  REBUILD_MONITOR_STATES.forEach((nextState, index) => {
    const now = new Date(Date.parse("2026-09-06T08:00:00.000Z") + index * 1_000)
      .toISOString();
    state = applyRebuildMonitorUpdate(state, {
      now,
      state: nextState,
      message: `Meaningful transition ${index + 1} is recorded.`,
      blocker: nextState === "blocked"
        ? { summary: "Owner approval is required.", ownerAction: "Review the exact approval packet." }
        : null,
      checkpoint: nextState === "committed" ? { ...checkpoint, verifiedAt: now } : undefined,
      releaseProof: nextState === "committed"
        ? { ...releaseProof, verifiedAt: now }
        : undefined,
    });
    assert.equal(state.state, nextState);
    assert.equal(state.timeline[0]?.at, now);
    assert.ok(state.timeline.length <= 10);
  });
});

test("committed and blocked states require exact evidence", () => {
  assert.throws(
    () => applyRebuildMonitorUpdate(seed(), {
      now: "2026-09-06T08:00:00.000Z",
      state: "committed",
      message: "Claimed commit without a checkpoint.",
    }),
    /exact verified Git checkpoint/i,
  );
  assert.throws(
    () => applyRebuildMonitorUpdate(seed(), {
      now: "2026-09-06T08:00:00.000Z",
      state: "committed",
      message: "Claimed commit with a mismatched proof.",
      checkpoint,
      releaseProof: { ...releaseProof, sha: "c".repeat(40) },
    }),
    /match its exact release proof/i,
  );
  assert.throws(
    () => applyRebuildMonitorUpdate({ ...seed(), blocker: null }, {
      now: "2026-09-06T08:00:00.000Z",
      state: "blocked",
      message: "Claimed blocker without Riley's action.",
    }),
    /Riley's exact action/i,
  );
});

test("a blocked transition retains its exact owner action until work resumes", () => {
  const blocked = applyRebuildMonitorUpdate(seed(), {
    now: "2026-09-06T08:00:00.000Z",
    state: "blocked",
    message: "The work is waiting for an exact owner decision.",
    blocker: {
      summary: "Owner approval is required.",
      ownerAction: "Review the exact approval packet.",
    },
  });
  const stillBlocked = applyRebuildMonitorUpdate(blocked, {
    now: "2026-09-06T08:01:00.000Z",
    state: "blocked",
    message: "The exact owner decision is still pending.",
  });
  assert.deepEqual(stillBlocked.blocker, blocked.blocker);

  const resumed = applyRebuildMonitorUpdate(stillBlocked, {
    now: "2026-09-06T08:02:00.000Z",
    state: "planning",
    message: "The owner decision was recorded and planning resumed.",
  });
  assert.equal(resumed.blocker, null);
});

test("secrets, multiline dumps, and private reasoning cannot enter visible monitor copy", () => {
  for (const message of [
    "api_key=not-for-a-monitor",
    "sk-this-looks-like-a-secret-value",
    "first line\nsecond line",
    "Internal reasoning should be displayed here",
  ]) {
    assert.throws(() => applyRebuildMonitorUpdate(seed(), {
      now: "2026-09-06T08:00:00.000Z",
      state: "coding",
      message,
    }));
  }
});

test("the local UI uses text nodes and contains no external asset URL", () => {
  const html = readFileSync(new URL("../docs/rebuild-monitor/index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../docs/rebuild-monitor/styles.css", import.meta.url), "utf8");
  const client = readFileSync(new URL("../docs/rebuild-monitor/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(`${html}\n${css}\n${client}`, /https?:\/\//i);
  assert.doesNotMatch(client, /\.innerHTML\s*=|insertAdjacentHTML/i);
  assert.match(client, /textContent = value/);
  assert.match(client, /matchesLastVerifiedCheckpoint/);
  assert.match(client, /Clean, not verified/);
  assert.match(client, /Live rebuild state unavailable/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /<ol id="next-list"/);
  assert.doesNotMatch(css, /content:\s*counter\(/);
});
