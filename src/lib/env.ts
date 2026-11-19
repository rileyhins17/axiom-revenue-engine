import { z } from "zod";

import { getCloudflareBindings } from "@/lib/cloudflare";

const envSchema = z.object({
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  AUTH_ALLOWED_EMAILS: z.string().default(""),
  AUTH_ADMIN_EMAILS: z.string().default(""),
  AUTH_ALLOWED_ORIGINS: z.string().default(""),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters long"),
  RATE_LIMIT_MAX_AUTH: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(900),
});

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | null = null;

/**
 * Clear the module-level env cache. Called by the Worker on every request and
 * scheduled run, so a changed setting takes effect at once.
 */
export function clearServerEnvCache() {
  cachedEnv = null;
}

export function getServerEnv(): AppEnv {
  if (cachedEnv) return cachedEnv;

  const bindings = getCloudflareBindings();
  cachedEnv = envSchema.parse({
    APP_BASE_URL: bindings?.APP_BASE_URL ?? process.env.APP_BASE_URL,
    AUTH_ALLOWED_EMAILS: bindings?.AUTH_ALLOWED_EMAILS ?? process.env.AUTH_ALLOWED_EMAILS,
    AUTH_ADMIN_EMAILS: bindings?.AUTH_ADMIN_EMAILS ?? process.env.AUTH_ADMIN_EMAILS,
    AUTH_ALLOWED_ORIGINS: bindings?.AUTH_ALLOWED_ORIGINS ?? process.env.AUTH_ALLOWED_ORIGINS,
    BETTER_AUTH_SECRET: bindings?.BETTER_AUTH_SECRET ?? process.env.BETTER_AUTH_SECRET,
    RATE_LIMIT_MAX_AUTH: bindings?.RATE_LIMIT_MAX_AUTH ?? process.env.RATE_LIMIT_MAX_AUTH,
    RATE_LIMIT_WINDOW_SECONDS: bindings?.RATE_LIMIT_WINDOW_SECONDS ?? process.env.RATE_LIMIT_WINDOW_SECONDS,
  });

  return cachedEnv;
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function splitOrigins(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function getAllowedEmails(): string[] {
  return splitCsv(getServerEnv().AUTH_ALLOWED_EMAILS);
}

export function getAdminEmails(): string[] {
  return splitCsv(getServerEnv().AUTH_ADMIN_EMAILS);
}

export function isAdminEmail(email: string): boolean {
  return getAdminEmails().includes(email.trim().toLowerCase());
}

export function getTrustedOrigins(): string[] {
  const env = getServerEnv();
  const origins = new Set<string>();

  try {
    const appUrl = new URL(env.APP_BASE_URL);
    origins.add(appUrl.origin);

    for (const origin of splitOrigins(env.AUTH_ALLOWED_ORIGINS)) {
      try {
        origins.add(new URL(origin).origin);
      } catch {
        // Ignore malformed trusted origins and continue with the rest.
      }
    }

    const isLoopback = appUrl.hostname === "localhost" || appUrl.hostname === "127.0.0.1";

    if (isLoopback) {
      const protocol = appUrl.protocol;
      const loopbackHosts = ["localhost", "127.0.0.1"];
      const loopbackPorts = new Set([
        appUrl.port || (protocol === "https:" ? "443" : "80"),
        "3000",
        "3001",
        "3002",
      ]);

      for (let port = 8787; port <= 8799; port++) {
        loopbackPorts.add(String(port));
      }

      for (const host of loopbackHosts) {
        for (const port of loopbackPorts) {
          origins.add(`${protocol}//${host}${port ? `:${port}` : ""}`);
        }
      }
    }
  } catch {
    // Ignore invalid URLs here; env parsing will already have failed elsewhere.
  }

  return Array.from(origins);
}
