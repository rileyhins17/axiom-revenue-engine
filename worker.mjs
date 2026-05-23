import openNextWorkerModule, {
  BucketCachePurge,
  DOQueueHandler,
  DOShardedTagCache,
} from "./.open-next/worker.js";

import { runAutomationScheduler } from "./src/lib/outreach-automation";
import { runCloudScrapeWorker } from "./src/lib/cloud-scrape-worker";
import { runAutonomousIntake } from "./src/lib/autonomous-intake";
import { runAutoPipeline } from "./src/lib/auto-pipeline";
import { maybeRunDailyDigest } from "./src/lib/daily-digest";
import { setCloudflareBindings } from "./src/lib/cloudflare";
import { clearServerEnvCache } from "./src/lib/env";
import { getCronTimeoutBudgets } from "./src/lib/cron-timeouts";

const worker = openNextWorkerModule;

export { BucketCachePurge, DOQueueHandler, DOShardedTagCache };

class CronTaskTimeoutError extends Error {
  constructor(label, ms) {
    super(`${label} timed out after ${ms}ms`);
    this.name = "CronTaskTimeoutError";
  }
}

function withTimeout(promise, ms, label) {
  const startedAt = Date.now();
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new CronTaskTimeoutError(label, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timeoutId);
    console.log(`[cron:${label}] durationMs=${Date.now() - startedAt} timeoutMs=${ms}`);
  });
}

// Cloudflare Workers cron triggers cap CPU at 30s per invocation (Standard plan).
// Running scheduler + pipeline + intake + scrape + digest in one tick exceeds
// the budget. Cloudflare kills the isolate, leaving OutreachRun rows stuck
// RUNNING. Next tick's recover_stale handler marks them FAILED but the same
// CPU-exhaustion repeats, so nothing ever sends. The fix: run AT MOST one
// heavy task per tick, rotated by wall-clock minute. The scheduler (send loop)
// runs every tick because it gates outbound throughput. Pipeline runs every
// tick because it is light. Intake/scrape/digest are staggered.
// Circuit-breaker check. If the last 3 OutreachRuns all FAILED, the worker is
// in a CPU-exhaustion or subrequest-exhaustion loop. Fall back to minimal mode:
// run scheduler only (no pipeline, no intake, no scrape) so at least the send
// loop has a chance to drain. As soon as one tick succeeds, full mode resumes.
async function shouldRunMinimalMode() {
  try {
    const { getDatabase } = await import("./src/lib/cloudflare");
    const db = getDatabase();
    const recent = await db
      .prepare(
        `SELECT "status" FROM "OutreachRun"
         WHERE "startedAt" > datetime('now', '-30 minutes')
         ORDER BY "startedAt" DESC
         LIMIT 5`,
      )
      .all();
    const rows = recent?.results || [];
    if (rows.length < 3) return false;
    const allFailed = rows.slice(0, 3).every((r) => r.status === "FAILED");
    if (allFailed) {
      console.warn("[cron] Circuit-breaker tripped — last 3 runs FAILED. Minimal mode.");
    }
    return allFailed;
  } catch (error) {
    console.warn("[cron] Circuit-breaker check failed (defaulting to full mode):", error);
    return false;
  }
}

async function runCronTasks(env, deadline) {
  const now = new Date();
  const minuteOfHour = now.getUTCMinutes();
  const minuteOfDay = now.getUTCHours() * 60 + minuteOfHour;
  const timeouts = getCronTimeoutBudgets(env);

  const minimalMode = await shouldRunMinimalMode();

  const tasks = [];

  tasks.push({
    fn: runAutomationScheduler,
    timeout: Math.min(timeouts.scheduler, 90_000),
    label: "scheduler",
  });

  if (!minimalMode) {
    tasks.push({
      fn: () => runAutoPipeline("system"),
      timeout: 60_000,
      label: "pipeline",
      requireRemainingMs: 60_000,
    });

    const slot = minuteOfHour % 15;
    if (slot === 0) {
      tasks.push({
        fn: runAutonomousIntake,
        timeout: Math.min(timeouts.intake, 90_000),
        label: "intake",
        requireRemainingMs: 90_000,
      });
    } else if (slot === 5) {
      tasks.push({
        fn: runCloudScrapeWorker,
        timeout: Math.min(timeouts.scrape, 600_000),
        label: "scrape",
        requireRemainingMs: 120_000,
      });
    } else if (slot === 10 && minuteOfDay % 1440 < 60) {
      tasks.push({
        fn: maybeRunDailyDigest,
        timeout: timeouts.digest,
        label: "digest",
        requireRemainingMs: 30_000,
      });
    }
  }

  for (const task of tasks) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      console.warn(`[cron:${task.label}] skipped — wall-clock budget exhausted`);
      continue;
    }
    if (task.requireRemainingMs && remaining < task.requireRemainingMs) {
      console.warn(`[cron:${task.label}] skipped — only ${remaining}ms left, need ${task.requireRemainingMs}ms`);
      continue;
    }
    const effectiveTimeout = Math.min(task.timeout, remaining);
    try {
      const value = await withTimeout(task.fn(), effectiveTimeout, task.label);
      console.log(`[cron:${task.label}] ok`, value);
    } catch (error) {
      console.error(`[cron:${task.label}] failed:`, error);
      if (error instanceof CronTaskTimeoutError) {
        console.warn(`[cron:${task.label}] timed out; stopping remaining cron tasks for this tick`);
        break;
      }
    }
  }
}

export default {
  async fetch(request, env, ctx) {
    clearServerEnvCache();
    setCloudflareBindings(env);
    return worker.fetch(request, env, ctx);
  },
  async scheduled(_controller, env, ctx) {
    clearServerEnvCache();
    setCloudflareBindings(env);
    const CRON_WALL_CLOCK_BUDGET_MS = 4 * 60 * 1000;
    ctx.waitUntil(
      (async () => {
        const deadline = Date.now() + CRON_WALL_CLOCK_BUDGET_MS;
        try {
          await runCronTasks(env, deadline);
        } catch (error) {
          console.error("[cron] outer failure:", error);
        }
      })(),
    );
  },
};
