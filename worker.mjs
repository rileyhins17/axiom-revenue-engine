import openNextWorkerModule, {
  BucketCachePurge,
  DOQueueHandler,
  DOShardedTagCache,
} from "./.open-next/worker.js";

import { setCloudflareBindings } from "./src/lib/cloudflare";
import { getCronTimeoutBudgets } from "./src/lib/cron-timeouts";
import { clearServerEnvCache } from "./src/lib/env";
import { runEngineEmailCron } from "./src/lib/revenue-engine/engine-email-worker";

const worker = openNextWorkerModule;
// Weekdays 10:00 Toronto (EDT); the sender itself refuses weekends and every closed gate.
const ENGINE_EMAIL_CRON = "0 14 * * 1-5";

export { BucketCachePurge, DOQueueHandler, DOShardedTagCache };

// Each fetch invocation gets its own 30s CPU budget on Workers Standard. The
// cron handler used to run scheduler + pipeline + intake + scrape in
// a single invocation and consistently hit the CPU cap, killing sends. Now the
// cron handler only fires fetch() calls into the same worker — each runs in a
// fresh invocation with its own CPU budget. Cron itself uses near-zero CPU.
const INTERNAL_CRON_PATH = "/api/internal/cron-tick";
const APP_BASE_URL_FALLBACK = "https://revenue.getaxiom.ca";

async function dispatchInternalTask(env, task, options = {}) {
  const base = (env.APP_BASE_URL || APP_BASE_URL_FALLBACK).replace(/\/$/, "");
  const url = `${base}${INTERNAL_CRON_PATH}?task=${encodeURIComponent(task)}`;
  const token = env.MCP_API_TOKEN || "";
  if (!token) {
    console.warn(`[cron:${task}] MCP_API_TOKEN not set; cannot dispatch internal task`);
    return;
  }

  const startedAt = Date.now();
  let timeoutId;
  const timeoutMs = options.timeoutMs ?? 90_000;
  const controller = new AbortController();
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      resolve("timeout");
    }, timeoutMs);
  });

  try {
    const service = env.WORKER_SELF_REFERENCE;
    if (!service || typeof service.fetch !== "function") {
      console.warn(`[cron:${task}] WORKER_SELF_REFERENCE not configured; cannot dispatch internal task`);
      return;
    }
    const fetchPromise = service.fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    const response = await Promise.race([fetchPromise, timeout]);
    if (response === "timeout") {
      console.warn(`[cron:${task}] dispatch timed out after ${timeoutMs}ms`);
      return;
    }
    const status = response.status;
    const body = await response.text().catch(() => "");
    console.log(`[cron:${task}] dispatched status=${status} durationMs=${Date.now() - startedAt} body=${body.slice(0, 200)}`);
  } catch (error) {
    console.error(`[cron:${task}] dispatch error:`, error);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function runCronTasks(env) {
  const now = new Date();
  const minuteOfHour = now.getUTCMinutes();
  const isExplicitlyEnabled = (value) => value === true || value === "true" || value === "1";
  const tasks = [];
  const timeoutBudgets = getCronTimeoutBudgets(env);

  if (isExplicitlyEnabled(env.AUTONOMOUS_QUEUE_ENABLED) || isExplicitlyEnabled(env.AUTONOMOUS_SEND_ENABLED)) {
    tasks.push("scheduler");
  }
  if (isExplicitlyEnabled(env.AUTONOMOUS_QUEUE_ENABLED)) {
    tasks.push("pipeline");
  }

  const slot = minuteOfHour % 15;
  if (slot === 0 && isExplicitlyEnabled(env.AUTONOMOUS_INTAKE_ENABLED)) tasks.push("intake");
  else if (slot === 5 && isExplicitlyEnabled(env.CLOUD_SCRAPE_ENABLED)) tasks.push("scrape");

  if (tasks.length === 0) {
    console.log(JSON.stringify({ event: "cron_skipped", reason: "all_phase_switches_off" }));
    return;
  }
  // Dispatch in parallel — each is its own fetch invocation with its own CPU.
  await Promise.allSettled(
    tasks.map((task) => dispatchInternalTask(env, task, { timeoutMs: timeoutBudgets[task] })),
  );
}

const exportedWorker = {
  async fetch(request, env, ctx) {
    clearServerEnvCache();
    setCloudflareBindings(env);
    return worker.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    clearServerEnvCache();
    setCloudflareBindings(env);
    if (controller?.cron === ENGINE_EMAIL_CRON) {
      ctx.waitUntil(
        runEngineEmailCron(env)
          .then((result) => console.log(JSON.stringify({ event: "engine_email", ...result })))
          .catch((error) => console.error("[engine-email] failure:", error instanceof Error ? error.message : "unknown")),
      );
      return;
    }
    ctx.waitUntil(
      runCronTasks(env).catch((error) => {
        console.error("[cron] outer failure:", error);
      }),
    );
  },
};

export default exportedWorker;
