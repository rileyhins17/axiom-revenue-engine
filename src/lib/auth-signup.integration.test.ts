import assert from "node:assert/strict";
import test from "node:test";

import { getAuth } from "./auth";
import { clearServerEnvCache } from "./env";

test("the production auth handler rejects an allow-listed first signup before creating a session", async () => {
  const previous = new Map<string, string | undefined>();
  const environment = {
    APP_BASE_URL: "https://revenue.getaxiom.ca/",
    AUTH_ALLOWED_EMAILS: "owner@getaxiom.ca",
    AUTH_ADMIN_EMAILS: "owner@getaxiom.ca",
    AUTH_ALLOWED_ORIGINS: "https://revenue.getaxiom.ca",
    BETTER_AUTH_SECRET: "focused-auth-test-secret-longer-than-thirty-two-characters",
    DATABASE_PATH: ":memory:",
    AXIOM_LOCAL_SYNTHETIC_SIGNUP: "1",
  };

  for (const [key, value] of Object.entries(environment)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  clearServerEnvCache();

  try {
    const response = await getAuth().handler(new Request("https://revenue.getaxiom.ca/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://revenue.getaxiom.ca" },
      body: JSON.stringify({
        name: "Unverified owner",
        email: "owner@getaxiom.ca",
        password: "attacker-chosen-password",
      }),
    }));

    assert.equal(response.status, 403);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.match(await response.text(), /provisioned privately/i);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    clearServerEnvCache();
  }
});
