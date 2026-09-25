import openNextWorkerModule, {
  BucketCachePurge,
  DOQueueHandler,
  DOShardedTagCache,
} from "./.open-next/worker.js";

import { EmailMessage } from "cloudflare:email";

import { setCloudflareBindings } from "./src/lib/cloudflare";
import { getCronTimeoutBudgets } from "./src/lib/cron-timeouts";
import { clearServerEnvCache } from "./src/lib/env";
import { runEngineEmailCron } from "./src/lib/revenue-engine/engine-email-worker";
import { runCallerSyncTick } from "./src/lib/caller-v2/sync-tick";
import { alertEmail, OWNER_ALERT_INBOXES, recordAndSelectAlerts, runHealthChecks } from "./src/lib/ops/health";

const HEALTH_CRON = "*/15 * * * *";
async function runHealthCron(env) {
  const checks = await runHealthChecks(env.DB, env);
  const alerts = await recordAndSelectAlerts(env.DB, checks);
  const mail = alertEmail(alerts);
  if (mail && globalThis.__axiomSendLoginEmail) {
    for (const to of OWNER_ALERT_INBOXES) await globalThis.__axiomSendLoginEmail({ to, ...mail }).catch(() => undefined);
  }
  return { failing: checks.filter((c) => !c.ok).map((c) => c.key), emailed: Boolean(mail) };
}

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

const LOGIN_FROM = "login@getaxiom.ca";

function encodeHeader(value) {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(value)))}?=`;
}
function base64Lines(value) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(value))).replace(/.{1,76}/g, "$&\r\n");
}

/** Sign-in codes go out through the LOGIN_EMAIL send_email binding, which Cloudflare
 * restricts to the owners' verified inboxes (allowed_destination_addresses). */
function installLoginEmail(env) {
  globalThis.__axiomSendLoginEmail = env.LOGIN_EMAIL
    ? async ({ to, subject, text, html }) => {
        const boundary = `axiom-${crypto.randomUUID()}`;
        const raw = [
          `From: Axiom <${LOGIN_FROM}>`, `To: <${to}>`, `Subject: ${encodeHeader(subject)}`,
          `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`, `Message-ID: <${crypto.randomUUID()}@getaxiom.ca>`,
          "MIME-Version: 1.0", `Content-Type: multipart/alternative; boundary="${boundary}"`, "",
          `--${boundary}`, "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", base64Lines(text),
          `--${boundary}`, "Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: base64", "", base64Lines(html),
          `--${boundary}--`, "",
        ].join("\r\n");
        await env.LOGIN_EMAIL.send(new EmailMessage(LOGIN_FROM, to, raw));
      }
    : undefined;
}

const exportedWorker = {
  async fetch(request, env, ctx) {
    clearServerEnvCache();
    setCloudflareBindings(env);
    installLoginEmail(env);
    return worker.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    clearServerEnvCache();
    setCloudflareBindings(env);
    if (controller?.cron === HEALTH_CRON) {
      installLoginEmail(env);
      ctx.waitUntil(runHealthCron(env)
        .then((result) => console.log(JSON.stringify({ event: "health", ...result })))
        .catch((error) => console.error("[health] failure", error instanceof Error ? error.message : "unknown")));
      return;
    }
    if (controller?.cron === "* * * * *") {
      ctx.waitUntil(runCallerSyncTick(env.DB, env)
        .then((result) => console.log(JSON.stringify({ event: "caller_sync", ...result })))
        .catch(() => { console.error("[caller-sync] failure"); throw new Error("CALLER_SYNC_FAILED"); }));
      return;
    }
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
