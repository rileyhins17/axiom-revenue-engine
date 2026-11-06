import assert from "node:assert/strict";
import { test } from "node:test";

import { clearServerEnvCache, getServerEnv, getTrustedOrigins } from "./env";

const mutableProcessEnv = process.env as Record<string, string | undefined>;
const keys = ["BETTER_AUTH_SECRET", "APP_BASE_URL", "AUTH_ALLOWED_ORIGINS", "RATE_LIMIT_MAX_AUTH"] as const;
const original = new Map<string, string | undefined>();

test.beforeEach(() => {
  for (const key of keys) original.set(key, process.env[key]);
  mutableProcessEnv.BETTER_AUTH_SECRET = "test-secret-that-is-at-least-32-characters";
});

test.afterEach(() => {
  for (const key of keys) {
    const value = original.get(key);
    if (value === undefined) delete mutableProcessEnv[key];
    else mutableProcessEnv[key] = value;
  }
  clearServerEnvCache();
});

test("a short sign-in secret stops startup instead of running insecurely", () => {
  mutableProcessEnv.BETTER_AUTH_SECRET = "too-short";
  clearServerEnvCache();
  assert.throws(() => getServerEnv(), /at least 32 characters/);
});

test("sign-in rate limits have safe defaults and accept numbers from settings", () => {
  delete mutableProcessEnv.RATE_LIMIT_MAX_AUTH;
  clearServerEnvCache();
  assert.equal(getServerEnv().RATE_LIMIT_MAX_AUTH, 10);
  mutableProcessEnv.RATE_LIMIT_MAX_AUTH = "25";
  clearServerEnvCache();
  assert.equal(getServerEnv().RATE_LIMIT_MAX_AUTH, 25);
});

test("trusted origins are the app's own origin plus the listed extras, and ignore junk", () => {
  mutableProcessEnv.APP_BASE_URL = "https://operations.getaxiom.ca/";
  mutableProcessEnv.AUTH_ALLOWED_ORIGINS = "https://axiom-ops-omniscient.aidan-magee2.workers.dev, not a url";
  clearServerEnvCache();
  assert.deepEqual(getTrustedOrigins(), ["https://operations.getaxiom.ca", "https://axiom-ops-omniscient.aidan-magee2.workers.dev"]);
});
