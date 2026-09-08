import assert from "node:assert/strict";
import type { APIRequestContext } from "playwright";

// Production Better Auth limits sign-in attempts to three per ten seconds.
// The fixture respects that response instead of disabling the protection.
export async function postOwnerSignIn(
  request: Pick<APIRequestContext, "post">,
  baseUrl: string,
  options: Parameters<APIRequestContext["post"]>[1],
  sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
) {
  assert.equal(new URL(baseUrl).hostname, "127.0.0.1", "Owner login fixtures must remain loopback-only.");
  for (let attempt = 0; ; attempt++) {
    const response = await request.post(`${baseUrl}/api/auth/sign-in/email`, options);
    if (response.status() !== 429 || attempt === 2) return response;
    const value = response.headers()["x-retry-after"];
    assert(value !== undefined && /^\d+$/.test(value), "Rate-limited fixture login needs an explicit retry delay.");
    const seconds = Number(value);
    assert(seconds >= 0 && seconds <= 10, "Unexpected fixture login rate-limit window.");
    await sleep(Math.max(1, seconds) * 1_000 + 100);
  }
}
