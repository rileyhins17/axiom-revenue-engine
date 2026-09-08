import {
  REBUILD_MONITOR_STATES,
  RebuildMonitorPlainTextSchema,
  RebuildMonitorStateSchema,
  parseRebuildMonitorState,
  parseRebuildMonitorReleaseProof,
  type RebuildMonitorState,
  type RebuildMonitorReleaseProof,
} from "@/lib/rebuild-monitor/contract";

type MonitorState = (typeof REBUILD_MONITOR_STATES)[number];

export type RebuildMonitorCheckpoint = RebuildMonitorState["lastVerifiedCheckpoint"];

export type RebuildMonitorUpdate = Readonly<{
  now: string;
  state: MonitorState;
  message: string;
  milestone?: string;
  completed?: readonly string[];
  currentWork?: readonly string[];
  nextWork?: readonly string[];
  blocker?: Readonly<{ summary: string; ownerAction: string }> | null;
  checkpoint?: RebuildMonitorCheckpoint;
  releaseProof?: RebuildMonitorReleaseProof;
}>;

function text(value: string) {
  return RebuildMonitorPlainTextSchema.parse(value);
}

function list(values: readonly string[], description: string) {
  if (values.length < 1) throw new Error(`${description} requires at least one item.`);
  return values.map(text);
}

export function applyRebuildMonitorUpdate(
  currentValue: unknown,
  update: RebuildMonitorUpdate,
): RebuildMonitorState {
  const current = parseRebuildMonitorState(currentValue);
  const message = text(update.message);
  const milestone = update.milestone ? text(update.milestone) : current.milestone;
  if (update.state === "committed" && (!update.checkpoint || !update.releaseProof)) {
    throw new Error("A committed monitor transition requires the exact verified Git checkpoint and release proof.");
  }
  if (update.state !== "committed" && (update.checkpoint || update.releaseProof)) {
    throw new Error("Only a committed monitor transition may replace the verified checkpoint.");
  }
  if (update.checkpoint && update.releaseProof) {
    const proof = parseRebuildMonitorReleaseProof(update.releaseProof);
    if (proof.sha !== update.checkpoint.sha
      || proof.branch !== update.checkpoint.branch
      || proof.verifiedAt !== update.checkpoint.verifiedAt) {
      throw new Error("The verified checkpoint must match its exact release proof.");
    }
  }
  if (update.state === "blocked" && !update.blocker && !current.blocker) {
    throw new Error("A blocked monitor transition requires Riley's exact action.");
  }
  const blocker = update.state === "blocked"
    ? update.blocker ?? current.blocker
    : null;
  const completedWork = update.completed
    ? [...new Set([...current.completedWork, ...update.completed.map(text)])].slice(-12)
    : current.completedWork;
  const candidate = {
    ...current,
    updatedAt: update.now,
    state: update.state,
    milestone,
    lastMeaningfulUpdate: message,
    lastVerifiedCheckpoint: update.checkpoint ?? current.lastVerifiedCheckpoint,
    completedWork,
    currentWork: update.currentWork
      ? list(update.currentWork, "Current work")
      : current.currentWork,
    nextWork: update.nextWork ? list(update.nextWork, "Next work") : current.nextWork,
    blocker: blocker
      ? { summary: text(blocker.summary), ownerAction: text(blocker.ownerAction) }
      : null,
    timeline: [
      { at: update.now, state: update.state, message },
      ...current.timeline,
    ].slice(0, 10),
  };
  return RebuildMonitorStateSchema.parse(candidate);
}
