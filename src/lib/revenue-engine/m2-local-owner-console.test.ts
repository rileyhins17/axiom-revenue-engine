import assert from "node:assert/strict";
import test from "node:test";
import { setCloudflareBindings } from "../cloudflare";
import { readLocalM2OwnerConsole } from "./m2-local-owner-console";

test("local M2 review refuses cloud contexts, absent opt-in and paths outside its fixed run directory", async (t) => {
  const enabled = process.env.AXIOM_M2_LOCAL_REVIEW_ENABLED;
  const run = process.env.AXIOM_M2_LOCAL_REVIEW_RUN;
  t.after(() => {
    setCloudflareBindings(null);
    if (enabled === undefined) delete process.env.AXIOM_M2_LOCAL_REVIEW_ENABLED;
    else process.env.AXIOM_M2_LOCAL_REVIEW_ENABLED = enabled;
    if (run === undefined) delete process.env.AXIOM_M2_LOCAL_REVIEW_RUN;
    else process.env.AXIOM_M2_LOCAL_REVIEW_RUN = run;
  });
  process.env.AXIOM_M2_LOCAL_REVIEW_RUN = "data/kw-evaluation/test.json";
  process.env.AXIOM_M2_LOCAL_REVIEW_ENABLED = "1";
  setCloudflareBindings({});
  assert.deepEqual(await readLocalM2OwnerConsole(), {
    status: "UNAVAILABLE", reason: "Local M2 review is not enabled on this server.",
  });
  setCloudflareBindings(null);
  delete process.env.AXIOM_M2_LOCAL_REVIEW_ENABLED;
  assert.deepEqual(await readLocalM2OwnerConsole(), {
    status: "UNAVAILABLE", reason: "Local M2 review is not enabled on this server.",
  });
  process.env.AXIOM_M2_LOCAL_REVIEW_ENABLED = "1";
  for (const invalid of ["", "../outside.json", "data/kw-evaluation/../../outside.json",
    "C:/private.json", "data/kw-evaluation/nested/run.json", "data/kw-evaluation/run.json --execute"]) {
    process.env.AXIOM_M2_LOCAL_REVIEW_RUN = invalid;
    assert.deepEqual(await readLocalM2OwnerConsole(), {
      status: "UNAVAILABLE", reason: "A valid local M2 run has not been configured.",
    });
  }
});
