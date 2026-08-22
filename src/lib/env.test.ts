import assert from "node:assert/strict";
import { test } from "node:test";

import { clearServerEnvCache, getServerEnv, parseEnvironmentBoolean } from "./env";

const autonomousSwitches = [
  "AUTONOMOUS_INTAKE_ENABLED",
  "AUTONOMOUS_QUEUE_ENABLED",
  "AUTONOMOUS_SEND_ENABLED",
] as const;

const envKeysToRestore = ["BETTER_AUTH_SECRET", ...autonomousSwitches];
const originalEnv = new Map<string, string | undefined>();
const mutableProcessEnv = process.env as Record<string, string | undefined>;

test.beforeEach(() => {
  for (const key of envKeysToRestore) {
    originalEnv.set(key, process.env[key]);
  }

  mutableProcessEnv.BETTER_AUTH_SECRET = "test-secret-that-is-at-least-32-characters";
});

test.afterEach(() => {
  for (const key of envKeysToRestore) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      delete mutableProcessEnv[key];
    } else {
      mutableProcessEnv[key] = value;
    }
  }

  clearServerEnvCache();
});

test("parseEnvironmentBoolean accepts booleans and explicit true/false forms", () => {
  for (const [value, expected] of [
    [true, true],
    [false, false],
    [1, true],
    [0, false],
    ["true", true],
    [" TRUE ", true],
    ["on", true],
    ["false", false],
    ["FALSE", false],
    ["off", false],
    ["1", true],
    ["0", false],
  ] as const) {
    assert.equal(parseEnvironmentBoolean(value), expected, String(value));
  }
});

test("all autonomous kill switches use the explicit parser", () => {
  for (const [value, expected] of [
    ["false", false],
    ["0", false],
    ["TRUE", true],
    ["1", true],
  ] as const) {
    for (const key of autonomousSwitches) {
      mutableProcessEnv[key] = value;
    }

    clearServerEnvCache();
    const env = getServerEnv();

    for (const key of autonomousSwitches) {
      assert.equal(env[key], expected, `${key}=${value}`);
    }
  }
});

test("invalid autonomous boolean values fail closed instead of enabling automation", () => {
  for (const key of autonomousSwitches) {
    mutableProcessEnv[key] = "maybe";
    clearServerEnvCache();

    assert.throws(() => getServerEnv(), /Invalid boolean environment value/);

    // A failed parse must not leave a partially cached environment behind.
    mutableProcessEnv[key] = "false";
    clearServerEnvCache();
    assert.equal(getServerEnv()[key], false, key);
  }
});

test("missing autonomous kill switches retain safe defaults", () => {
  for (const key of autonomousSwitches) {
    delete mutableProcessEnv[key];
  }

  clearServerEnvCache();
  const env = getServerEnv();

  assert.equal(env.AUTONOMOUS_INTAKE_ENABLED, false);
  assert.equal(env.AUTONOMOUS_QUEUE_ENABLED, false);
  assert.equal(env.AUTONOMOUS_SEND_ENABLED, false);
});
