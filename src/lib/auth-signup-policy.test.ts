import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { assertOperatorSignupAllowed } from "./auth-signup-policy";

test("production signup fails closed even when a synthetic fixture flag is present", () => {
  assert.throws(
    () => assertOperatorSignupAllowed({
      appBaseUrl: "https://revenue.getaxiom.ca/",
      cloudflareDatabaseBound: true,
      localSyntheticSignupFlag: "1",
    }),
    /disabled/i,
  );
});

test("loopback signup fails closed without the explicit synthetic fixture flag", () => {
  assert.throws(
    () => assertOperatorSignupAllowed({
      appBaseUrl: "http://127.0.0.1:3000",
      cloudflareDatabaseBound: false,
      localSyntheticSignupFlag: undefined,
    }),
    /disabled/i,
  );
});

test("the isolated owner-browser fixture can sign up only on loopback with its explicit flag", () => {
  assert.doesNotThrow(() => assertOperatorSignupAllowed({
    appBaseUrl: "http://127.0.0.1:43123",
    cloudflareDatabaseBound: false,
    localSyntheticSignupFlag: "1",
  }));
});

test("a Cloudflare-bound runtime cannot enable signup through the local fixture flag", () => {
  assert.throws(
    () => assertOperatorSignupAllowed({
      appBaseUrl: "http://127.0.0.1:3000",
      cloudflareDatabaseBound: true,
      localSyntheticSignupFlag: "1",
    }),
    /disabled/i,
  );
});

test("non-canonical fixture flag values do not enable signup", () => {
  for (const localSyntheticSignupFlag of ["true", "yes", "01", " 1 "]) {
    assert.throws(
      () => assertOperatorSignupAllowed({
        appBaseUrl: "http://localhost:3000",
        cloudflareDatabaseBound: false,
        localSyntheticSignupFlag,
      }),
      /disabled/i,
    );
  }
});

test("the synthetic signup flag is absent from Cloudflare production configuration", async () => {
  const productionConfiguration = await Promise.all([
    readFile(new URL("../../wrangler.jsonc", import.meta.url), "utf8"),
    readFile(new URL("./env.ts", import.meta.url), "utf8"),
    readFile(new URL("../../cloudflare-secrets.d.ts", import.meta.url), "utf8"),
  ]);

  for (const source of productionConfiguration) {
    assert.doesNotMatch(source, /AXIOM_LOCAL_SYNTHETIC_SIGNUP/);
  }
});
