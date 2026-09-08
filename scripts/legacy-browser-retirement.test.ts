import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import { launchAutomationBrowser, applyScrapeResourceBlocking } from "../src/lib/browser-rendering";
import { executeScrapeJob } from "../src/lib/scrape-engine";
import { executeScrapeJob as executeWorkerJob } from "../src/lib/scrape-engine-worker";
import { runCloudScrapeWorker } from "../src/lib/cloud-scrape-worker";
import { setCloudflareBindings } from "../src/lib/cloudflare";
import { LEGACY_BROWSER_RETIRED_REASON } from "../src/lib/retired-legacy-browser";

test("retired browser entrypoints cannot launch, inspect input or claim a job", async (context) => {
  context.mock.method(globalThis, "fetch", async () => { throw new Error("Network forbidden"); });
  const unreadable = new Proxy({}, { get() { throw new Error("Input or binding access forbidden"); } });
  setCloudflareBindings(unreadable);
  try {
    for (const operation of [launchAutomationBrowser, applyScrapeResourceBlocking, executeScrapeJob, executeWorkerJob]) {
      await assert.rejects(Reflect.apply(operation, undefined, [unreadable]), { message: LEGACY_BROWSER_RETIRED_REASON });
    }
    assert.deepEqual(await runCloudScrapeWorker(), { claimed: false, reason: LEGACY_BROWSER_RETIRED_REASON });
  } finally { setCloudflareBindings(null); }
});

test("retired implementations have no browser, database or provider runtime imports", () => {
  for (const name of ["browser-rendering", "public-web-discovery", "scrape-engine", "cloud-scrape-worker"]) {
    const source = readFileSync(`src/lib/${name}.ts`, "utf8");
    const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
    for (const statement of file.statements) {
      if (!ts.isImportDeclaration(statement)) continue;
      const clause = statement.importClause;
      const bindings = clause?.namedBindings;
      if (clause?.isTypeOnly || bindings && ts.isNamedImports(bindings) && bindings.elements.every(element => element.isTypeOnly)) continue;
      assert(ts.isStringLiteral(statement.moduleSpecifier));
      assert.equal(statement.moduleSpecifier.text, "@/lib/retired-legacy-browser", name);
    }
    assert.doesNotMatch(source, /\bimport\s*\(|\bnew\s+Function\b|\bfetch\s*\(|\.goto\s*\(|\.launch\s*\(|\.prepare\s*\(/, name);
  }
});
