import assert from "node:assert/strict";
import { test } from "node:test";
import type { APIRequestContext, APIResponse } from "playwright";
import { postOwnerSignIn } from "./owner-auth-request";

function fixture(statuses: number[], delay: string | undefined = "10") {
  let calls = 0;
  const waits: number[] = [];
  const request: Pick<APIRequestContext, "post"> = { post: async (url) => {
    assert.equal(url, "http://127.0.0.1:3000/api/auth/sign-in/email");
    const status = statuses[Math.min(calls++, statuses.length - 1)];
    return { status: () => status, headers: () => ({ "x-retry-after": delay }) } as unknown as APIResponse;
  } };
  return { request, sleep: async (ms: number) => { waits.push(ms); }, waits, calls: () => calls };
}

test("fixture login respects rate limiting, then preserves the actual auth decision", async () => {
  const f = fixture([429, 403]);
  assert.equal((await postOwnerSignIn(f.request, "http://127.0.0.1:3000", {}, f.sleep)).status(), 403);
  assert.deepEqual(f.waits, [10_100]);
});

test("fixture login never retries auth/server errors and bounds persistent throttling", async () => {
  for (const status of [200, 401, 403, 500, 503]) {
    const f = fixture([status]);
    assert.equal((await postOwnerSignIn(f.request, "http://127.0.0.1:3000", {}, f.sleep)).status(), status);
    assert.equal(f.calls(), 1);
    assert.deepEqual(f.waits, []);
  }
  const f = fixture([429]);
  assert.equal((await postOwnerSignIn(f.request, "http://127.0.0.1:3000", {}, f.sleep)).status(), 429);
  assert.equal(f.calls(), 3);
});

test("fixture login rejects external destinations and unsafe retry instructions", async () => {
  const f = fixture([200]);
  await assert.rejects(postOwnerSignIn(f.request, "https://example.invalid", {}, f.sleep), /loopback-only/);
  assert.equal(f.calls(), 0);
  for (const value of ["", "invalid", "11", "-1", "1.2"]) {
    const limited = fixture([429], value);
    await assert.rejects(postOwnerSignIn(limited.request, "http://127.0.0.1:3000", {}, limited.sleep));
    assert.deepEqual(limited.waits, []);
  }
});
