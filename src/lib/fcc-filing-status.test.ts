import assert from "node:assert/strict";
import test from "node:test";

import { fccFilingStatusFromPortal, fccRecertifiedBy, fccSysId, parseFccFilingStatus } from "@/lib/fcc-filing-status";

const SYS_ID = "2f29adbf1ba4345022e3a681f54bcbd4";
const URL = `https://fccprod.servicenowservices.com/rmd?id=rmd_form&table=x_g_fmc_rmd_robocall_mitigation_database&sys_id=${SYS_ID}&view=sp`;

/** The portal's page JSON, as the hand-run scans read it: the record sits a few containers deep. */
const page = (record: Record<string, unknown>) => ({
  result: { containers: [{ rows: [{ columns: [{ widgets: [{ data: { f: { _fields: {} }, record } }] }] }] }] },
});

test("finds the sys_id in a filing URL", () => {
  assert.equal(fccSysId(URL), SYS_ID);
  assert.equal(fccSysId("https://example.test"), null);
  assert.equal(fccSysId(null), null);
});

test("reads the recertification date and the Recertify flag out of the page JSON", () => {
  assert.deepEqual(parseFccFilingStatus(page({ last_recertified: "2026-11-01", enable_recertify: "true" })), { lastRecertified: "2026-11-01", recertifyOpen: true });
  assert.deepEqual(parseFccFilingStatus(page({ last_recertified: "", enable_recertify: "false" })), { lastRecertified: null, recertifyOpen: false });
  assert.deepEqual(parseFccFilingStatus(page({ last_recertified: "2025-02-10" })), { lastRecertified: "2025-02-10", recertifyOpen: null });
  assert.equal(parseFccFilingStatus(page({ status: "Submitted" })), null, "a record without the field is not a listing");
  assert.equal(parseFccFilingStatus({ result: "sign in" }), null);
  assert.equal(parseFccFilingStatus(null), null);
});

test("a recertification in the sending year or later counts; an older one or none does not", () => {
  assert.equal(fccRecertifiedBy({ lastRecertified: "2026-11-01", recertifyOpen: true }, "2026-11-06"), true);
  assert.equal(fccRecertifiedBy({ lastRecertified: "2027-02-03", recertifyOpen: true }, "2026-11-06"), true);
  assert.equal(fccRecertifiedBy({ lastRecertified: "2025-02-10", recertifyOpen: false }, "2026-11-06"), false);
  assert.equal(fccRecertifiedBy({ lastRecertified: null, recertifyOpen: false }, "2026-11-06"), false);
  assert.equal(fccRecertifiedBy(null, "2026-11-06"), false);
});

test("the portal reader opens one session, sends its cookie and token, and resolves null on any failure", async () => {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: { ...(init?.headers as Record<string, string>) } });
    if (url.endsWith("rmd?id=rmd_landing")) {
      return new Response(`<script>var g_ck = 'tok123';</script>`, { headers: { "set-cookie": "JSESSIONID=abc; Path=/; HttpOnly" } });
    }
    if (url.includes("sys_id=dead")) return new Response("nope", { status: 500 });
    return new Response(JSON.stringify(page({ last_recertified: "2026-10-30", enable_recertify: "true" })), { headers: { "content-type": "application/json" } });
  };
  const read = fccFilingStatusFromPortal(fetchImpl);
  assert.deepEqual(await read(URL), { lastRecertified: "2026-10-30", recertifyOpen: true });
  assert.deepEqual(await read(URL.replace(SYS_ID, "deaddeaddeaddeaddeaddeaddeaddead")), null, "a failed page read is null, never a throw");
  assert.equal(await read("https://example.test"), null, "no sys_id, nothing to read");
  assert.equal(calls.filter((call) => call.url.endsWith("rmd_landing")).length, 1, "one session for the reader's life");
  const listing = calls.find((call) => call.url.includes(SYS_ID))!;
  assert.equal(listing.headers.Cookie, "JSESSIONID=abc");
  assert.equal(listing.headers["X-UserToken"], "tok123");
  assert.equal(listing.headers.Accept, "application/json");

  const broken = fccFilingStatusFromPortal(async () => { throw new Error("network down"); });
  assert.equal(await broken(URL), null);
});
