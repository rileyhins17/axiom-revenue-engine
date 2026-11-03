import { AsyncLocalStorage } from "node:async_hooks";

import openNextWorkerModule, {
  BucketCachePurge,
  DOQueueHandler,
  DOShardedTagCache,
} from "./.open-next/worker.js";

import { EmailMessage } from "cloudflare:email";

import { setCloudflareBindings } from "./src/lib/cloudflare";
import { clearServerEnvCache } from "./src/lib/env";
import { runFccCampaignCron, runFccReplyCheckCron } from "./src/lib/fcc-campaign-worker";
import { alertEmail, OWNER_ALERT_INBOXES, recordAndSelectAlerts, runHealthChecks } from "./src/lib/ops/health";

// Sign-in (better-auth) sets up three request stores the first time it is used, by
// awaiting one shared `import("node:async_hooks")` started inside that request. When
// that request was cut off (the browser cancels page preloads all the time), the shared
// setup never finished, and every later sign-in check on that copy of the Worker waited
// forever: Today, FCC, Settings and /api/auth/get-session hung for up to 100 minutes and
// Next showed "This page couldn't load". Creating the stores here, at startup, means
// better-auth finds them ready and never waits on anything a request started.
const BETTER_AUTH_GLOBAL = Symbol.for("better-auth:global");
const authGlobal = (globalThis[BETTER_AUTH_GLOBAL] ??= { version: "1.6.29", epoch: 1, context: {} });
authGlobal.context.requestStateAsyncStorage ??= new AsyncLocalStorage();
authGlobal.context.endpointContextAsyncStorage ??= new AsyncLocalStorage();
authGlobal.context.adapterAsyncStorage ??= new AsyncLocalStorage();

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
// Every minute, 14:00-19:59 UTC (10:00 Toronto in both EDT and EST): one FCC send
// tick. The tick itself keeps Toronto send windows, weekdays and the 1-3 minute gap.
const FCC_TICK_CRON = "* 14-19 * * *";

export { BucketCachePurge, DOQueueHandler, DOShardedTagCache };

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

// A screen that hasn't answered in 20 seconds is stuck, not slow: every page here renders
// in well under 2. Answer instead of leaving the browser waiting, so the app can try again.
// Only reads are cut off; a pause, resume or sign-in always runs to the end.
const PAGE_TIMEOUT_MS = 20_000;

function stuckResponse(request) {
  const headers = { "Cache-Control": "no-store", "Retry-After": "1" };
  // Next's router reloads the page when a screen's data comes back as plain text.
  if (request.headers.get("rsc") === "1") return new Response("Timed out, try again", { status: 503, headers: { ...headers, "Content-Type": "text/plain" } });
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="2"><title>Loading again</title></head>`
    + `<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f4ef;color:#202c26;font:15px/1.5 Inter,Segoe UI,Arial,sans-serif">`
    + `<p>That took too long. Loading it again…</p></body></html>`;
  return new Response(html, { status: 503, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
}

async function answerInTime(request, env, ctx) {
  const handled = worker.fetch(request, env, ctx);
  if (request.method !== "GET" && request.method !== "HEAD") return handled;
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(null), PAGE_TIMEOUT_MS); });
  try {
    const response = await Promise.race([handled, late]);
    if (response) return response;
    console.error(JSON.stringify({ event: "page_timeout", path: new URL(request.url).pathname, rsc: request.headers.get("rsc") === "1" }));
    return stuckResponse(request);
  } finally {
    clearTimeout(timer);
  }
}

const exportedWorker = {
  async fetch(request, env, ctx) {
    clearServerEnvCache();
    setCloudflareBindings(env);
    installLoginEmail(env);
    return answerInTime(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    clearServerEnvCache();
    setCloudflareBindings(env);
    if (controller?.cron === HEALTH_CRON) {
      installLoginEmail(env);
      ctx.waitUntil(runHealthCron(env)
        .then((result) => console.log(JSON.stringify({ event: "health", ...result })))
        .catch((error) => console.error("[health] failure", error instanceof Error ? error.message : "unknown")));
      // Once a day from 9:00 Toronto: read the FCC inboxes for replies and tell both founders.
      ctx.waitUntil(runFccReplyCheckCron(env, globalThis.__axiomSendLoginEmail)
        .then((result) => console.log(JSON.stringify({ event: "fcc_reply_check", ...result })))
        .catch((error) => console.error("[fcc-reply-check] failure:", error instanceof Error ? error.message : "unknown")));
      return;
    }
    if (controller?.cron === FCC_TICK_CRON) {
      ctx.waitUntil(
        runFccCampaignCron(env)
          .then((result) => console.log(JSON.stringify({ event: "fcc_campaign", ...result })))
          .catch((error) => console.error("[fcc-campaign] failure:", error instanceof Error ? error.message : "unknown")),
      );
      return;
    }
    console.warn(JSON.stringify({ event: "cron_unknown", cron: controller?.cron ?? null }));
  },
};

export default exportedWorker;
