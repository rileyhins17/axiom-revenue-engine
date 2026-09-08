// Disposable test subprocess only. Receives a synthetic SQLite path and envelope
// over IPC; no runtime bindings, provider calls or environment-file loading.
import Database from "better-sqlite3";
import type { D1DatabaseLike, D1PreparedStatementLike } from "../../src/lib/cloudflare";
import { createOutboundSendIntentStore, type OutboundSendIntent } from "../../src/lib/revenue-engine/outbound-send-intent-store";

process.once("message", (input: { path: string; intent: OutboundSendIntent }) => {
  const sqlite = new Database(input.path, { timeout: 5000, fileMustExist: true });
  const database: D1DatabaseLike = { prepare(sql) {
    const statement = sqlite.prepare(sql);
    let args: unknown[] = [];
    const prepared: D1PreparedStatementLike = {
      bind(...values) { args = values; return prepared; },
      async first<T>() { return (statement.get(...args) ?? null) as T | null; },
      async all<T>() { return { results: statement.all(...args) as T[] }; },
      async run() { return { meta: { changes: statement.run(...args).changes } }; },
    };
    return prepared;
  } };
  process.once("message", async (message) => {
    try {
      if (message !== "GO") throw new Error("Invalid test barrier");
      const result = await createOutboundSendIntentStore(database).claim(input.intent);
      // Never transmit the attempt token, including in fixture output.
      process.send?.({ kind: result.kind, state: result.row.state });
    } catch (error) {
      if (error instanceof Error && error.message === "outbound budget unavailable") {
        process.send?.({ kind: "BUDGET_BLOCKED" });
      } else {
        process.exitCode = 1;
        process.send?.({ error: "SYNTHETIC_CHILD_FAILED" });
      }
    } finally {
      sqlite.close();
      process.disconnect();
    }
  });
  process.send?.({ ready: true });
});
