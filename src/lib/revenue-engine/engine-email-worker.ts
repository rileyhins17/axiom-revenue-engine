import { connect } from "cloudflare:sockets";

import { runDailyEmail, type EmailRunResult } from "./engine-email";
import type { ProspectDb } from "./engine-prospects-d1";
import { openSmtp } from "./smtp-client";

type EmailEnv = {
  DB: unknown; APP_BASE_URL?: string; ENGINE_EMAIL_ENABLED?: string;
  ENGINE_EMAIL_FROM?: string; ENGINE_EMAIL_FROM_NAME?: string; ENGINE_SMTP_HOST?: string; ENGINE_SMTP_PASSWORD?: string;
};

const token = () => [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Worker cron entry for the daily first-touch batch. Missing config means no send. */
export async function runEngineEmailCron(env: EmailEnv): Promise<EmailRunResult> {
  const from = env.ENGINE_EMAIL_FROM?.trim() ?? "";
  const password = env.ENGINE_SMTP_PASSWORD?.trim() ?? "";
  const hostname = env.ENGINE_SMTP_HOST?.trim() || "smtp.zoho.com";
  const configured = Boolean(from && password);
  return runDailyEmail(env.DB as ProspectDb, {
    workerSwitch: env.ENGINE_EMAIL_ENABLED === "true",
    fromName: env.ENGINE_EMAIL_FROM_NAME?.trim() || "Riley Hinsperger",
    fromAddress: from,
    baseUrl: env.APP_BASE_URL ?? "",
    newId: () => crypto.randomUUID(),
    newToken: token,
    transport: configured ? async () => {
      const socket = connect({ hostname, port: 465 }, { secureTransport: "on", allowHalfOpen: false });
      await socket.opened;
      return openSmtp({ readable: socket.readable, writable: socket.writable, close: () => socket.close() },
        { host: hostname, username: from, password, fromName: env.ENGINE_EMAIL_FROM_NAME?.trim() || "Riley Hinsperger", fromAddress: from }, () => crypto.randomUUID());
    } : null,
  });
}
