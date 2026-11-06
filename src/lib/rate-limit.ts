import { APIError } from "better-auth";

import { getDatabase } from "@/lib/cloudflare";

type RateLimitOptions = {
  identifier: string;
  limit: number;
  scope: string;
  windowSeconds: number;
};

export async function consumeRateLimit(options: RateLimitOptions) {
  // limit <= 0 means unlimited — bypass rate limiting entirely
  if (options.limit <= 0) {
    return {
      allowed: true,
      count: 0,
      remaining: Infinity,
      resetAt: new Date(Date.now() + options.windowSeconds * 1000),
    };
  }

  const db = getDatabase();
  const now = new Date();
  const windowMs = options.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const key = `${options.scope}:${options.identifier}:${windowStart.toISOString()}`;

  // Create the window if this is the first request, then count atomically: SQLite applies
  // `count = count + 1` in one step, so simultaneous requests can't all see the same count.
  await db.prepare(`INSERT INTO "RateLimitWindow" ("id","key","windowStart","count","updatedAt") VALUES (?,?,?,0,?) ON CONFLICT("key") DO NOTHING`)
    .bind(crypto.randomUUID(), key, windowStart.toISOString(), now.toISOString()).run();
  const updated = await db.prepare(`UPDATE "RateLimitWindow" SET "count" = "count" + 1, "updatedAt" = ? WHERE "key" = ? RETURNING "count"`)
    .bind(now.toISOString(), key).first<{ count: number }>();
  const count = Number(updated?.count ?? 1);

  return {
    allowed: count <= options.limit,
    count,
    remaining: Math.max(options.limit - count, 0),
    resetAt: new Date(windowStart.getTime() + windowMs),
  };
}

export async function assertRateLimit(options: RateLimitOptions) {
  const result = await consumeRateLimit(options);
  if (!result.allowed) {
    throw new APIError("TOO_MANY_REQUESTS", {
      message: `Rate limit exceeded for ${options.scope}. Try again after ${result.resetAt.toISOString()}.`,
    });
  }
  return result;
}
