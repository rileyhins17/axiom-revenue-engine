import openNextWorkerModule, {
  BucketCachePurge,
  DOQueueHandler,
  DOShardedTagCache,
} from "./.open-next/worker.js";

import { setCloudflareBindings } from "./src/lib/cloudflare";
import { clearServerEnvCache } from "./src/lib/env";

const worker = openNextWorkerModule;

export { BucketCachePurge, DOQueueHandler, DOShardedTagCache };

// Each fetch invocation gets its own 30s CPU budget on Workers Standard. The
// cron handler used to run scheduler + pipeline + intake + scrape + digest in
// a single invocation and consistently hit the CPU cap, killing sends. Now the
// cron handler only fires fetch() calls into the same worker — each runs in a
// fresh invocation with its own CPU budget. Cron itself uses near-zero CPU.
const INTERNAL_CRON_PATH = "/api/internal/cron-tick";
const APP_BASE_URL_FALLBACK = "https://operations.getaxiom.ca";

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
    const fetchPromise = fetch(url, {
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
  const minuteOfDay = now.getUTCHours() * 60 + minuteOfHour;

  const tasks = ["scheduler", "pipeline"];

  const slot = minuteOfHour % 15;
  if (slot === 0) tasks.push("intake");
  else if (slot === 5) tasks.push("scrape");
  else if (slot === 10 && minuteOfDay % 1440 < 60) tasks.push("digest");

  // Dispatch in parallel — each is its own fetch invocation with its own CPU.
  await Promise.allSettled(tasks.map((task) => dispatchInternalTask(env, task)));
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
    ctx.waitUntil(
      runCronTasks(env).catch((error) => {
        console.error("[cron] outer failure:", error);
      }),
    );
  },
};
