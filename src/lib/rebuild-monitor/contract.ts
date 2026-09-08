import { z } from "zod";

export const REBUILD_MONITOR_VERSION = "axiom-rebuild-monitor-v1";
export const REBUILD_MONITOR_STATES = [
  "planning",
  "coding",
  "testing",
  "fixing",
  "verification",
  "committed",
  "blocked",
  "inactive",
] as const;

const SECRET_PATTERNS = [
  /\bsk-[a-z0-9_-]{12,}\b/i,
  /\bAIza[a-z0-9_-]{20,}\b/i,
  /\bgh[pousr]_[a-z0-9]{20,}\b/i,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
  /\b(?:api[_ -]?key|password|access[_ -]?token|refresh[_ -]?token)\s*[:=]\s*\S+/i,
  /\b(?:chain of thought|internal reasoning)\b/i,
] as const;

const TimestampSchema = z.string().datetime({ offset: true }).refine(
  (value) => Number.isFinite(Date.parse(value)),
  "Monitor timestamps must resolve to a finite epoch.",
);

export const RebuildMonitorPlainTextSchema = z.string().trim().min(1).max(280)
  .superRefine((value, context) => {
    if (/\r|\n|\0/.test(value)) {
      context.addIssue({
        code: "custom",
        message: "Monitor copy must be a single plain-text line.",
      });
    }
    if (SECRET_PATTERNS.some((pattern) => pattern.test(value))) {
      context.addIssue({
        code: "custom",
        message: "Monitor copy cannot contain credentials or private reasoning.",
      });
    }
  });

export function safeRebuildMonitorCommitTitle(value: string) {
  const parsed = RebuildMonitorPlainTextSchema.pipe(z.string().max(160)).safeParse(value);
  return parsed.success ? parsed.data : "Commit subject hidden by monitor privacy rules.";
}

const ShortTextSchema = RebuildMonitorPlainTextSchema.pipe(z.string().max(160));
const StateSchema = z.enum(REBUILD_MONITOR_STATES);

const CheckpointSchema = z.object({
  sha: z.string().regex(/^[a-f0-9]{40}$/),
  shortSha: z.string().regex(/^[a-f0-9]{7,12}$/),
  title: ShortTextSchema,
  branch: z.literal("RileyHinsperger/axiom-revenue-engine-rebuild"),
  verifiedAt: TimestampSchema,
}).strict().superRefine((checkpoint, context) => {
  if (!checkpoint.sha.startsWith(checkpoint.shortSha)) {
    context.addIssue({
      code: "custom",
      message: "The short checkpoint must prefix the exact verified SHA.",
      path: ["shortSha"],
    });
  }
});

const StageSchema = z.object({
  id: z.enum([
    "privacy-safety",
    "durable-foundation",
    "lead-quality",
    "responsible-outreach",
    "owner-application",
    "kw-pilot",
    "limited-autonomy",
  ]),
  label: ShortTextSchema,
  state: z.enum(["complete", "in_progress", "blocked", "not_started", "locked"]),
  summary: RebuildMonitorPlainTextSchema,
}).strict();

const TimelineEntrySchema = z.object({
  at: TimestampSchema,
  state: StateSchema,
  message: RebuildMonitorPlainTextSchema,
}).strict();

export const RebuildMonitorStateSchema = z.object({
  monitorVersion: z.literal(REBUILD_MONITOR_VERSION),
  updatedAt: TimestampSchema,
  state: StateSchema,
  milestone: RebuildMonitorPlainTextSchema,
  lastMeaningfulUpdate: RebuildMonitorPlainTextSchema,
  lastVerifiedCheckpoint: CheckpointSchema,
  completedWork: z.array(RebuildMonitorPlainTextSchema).min(1).max(12),
  currentWork: z.array(RebuildMonitorPlainTextSchema).min(1).max(8),
  nextWork: z.array(RebuildMonitorPlainTextSchema).min(1).max(8),
  blocker: z.object({
    summary: RebuildMonitorPlainTextSchema,
    ownerAction: RebuildMonitorPlainTextSchema,
  }).strict().nullable(),
  safety: z.object({
    outboundSending: z.literal("OFF"),
    productionChanges: z.literal("NONE"),
    externalProspectContact: z.literal("NONE"),
    paidProviderOperations: z.literal("NONE"),
    spendImpactCad: z.literal(0),
    storageBoundary: z.literal("LOCAL_CANONICAL_CHECKOUT_ONLY"),
  }).strict(),
  stages: z.array(StageSchema).length(7).superRefine((stages, context) => {
    if (new Set(stages.map((stage) => stage.id)).size !== stages.length) {
      context.addIssue({ code: "custom", message: "Monitor stages must be unique." });
    }
  }),
  timeline: z.array(TimelineEntrySchema).min(1).max(10),
}).strict().superRefine((state, context) => {
  if (state.state === "blocked" && !state.blocker) {
    context.addIssue({
      code: "custom",
      message: "A blocked monitor state requires the exact blocker and owner action.",
      path: ["blocker"],
    });
  }
  if (state.timeline[0]?.at !== state.updatedAt) {
    context.addIssue({
      code: "custom",
      message: "The newest timeline entry must match the monitor update time.",
      path: ["timeline", 0, "at"],
    });
  }
  if (Date.parse(state.lastVerifiedCheckpoint.verifiedAt) > Date.parse(state.updatedAt)) {
    context.addIssue({
      code: "custom",
      message: "The verified checkpoint cannot postdate the visible monitor update.",
      path: ["lastVerifiedCheckpoint", "verifiedAt"],
    });
  }
  state.timeline.forEach((entry, index) => {
    const older = state.timeline[index + 1];
    if (older && Date.parse(entry.at) < Date.parse(older.at)) {
      context.addIssue({
        code: "custom",
        message: "The monitor timeline must remain newest-first.",
        path: ["timeline", index + 1, "at"],
      });
    }
  });
});

export type RebuildMonitorState = z.infer<typeof RebuildMonitorStateSchema>;

export const REBUILD_MONITOR_RELEASE_CHECKS = [
  "rebuild-monitor:check",
  "check:safety",
  "test",
  "typecheck",
  "lint",
  "build:cloudflare",
  "cf:dry-run",
  "cf:engine:typegen:check",
  "cf:engine:dry-run",
  "test:saved-email-ui",
  "test:legacy-email-ui",
  "test:owner-ui",
] as const;

export const RebuildMonitorReleaseProofSchema = z.object({
  proofVersion: z.literal("axiom-rebuild-monitor-release-v2"),
  sha: z.string().regex(/^[a-f0-9]{40}$/),
  treeSha: z.string().regex(/^[a-f0-9]{40}$/),
  branch: z.literal("RileyHinsperger/axiom-revenue-engine-rebuild"),
  verifiedAt: TimestampSchema,
  checks: z.array(z.enum(REBUILD_MONITOR_RELEASE_CHECKS))
    .length(REBUILD_MONITOR_RELEASE_CHECKS.length),
}).strict().superRefine((proof, context) => {
  if (proof.checks.some((check, index) => check !== REBUILD_MONITOR_RELEASE_CHECKS[index])) {
    context.addIssue({
      code: "custom",
      message: "The release proof must contain every required check in execution order.",
      path: ["checks"],
    });
  }
});

export type RebuildMonitorReleaseProof = z.infer<typeof RebuildMonitorReleaseProofSchema>;

export function parseRebuildMonitorState(value: unknown): RebuildMonitorState {
  return RebuildMonitorStateSchema.parse(value);
}

export function parseRebuildMonitorReleaseProof(value: unknown): RebuildMonitorReleaseProof {
  return RebuildMonitorReleaseProofSchema.parse(value);
}
