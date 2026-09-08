import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { fork } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import type { D1DatabaseLike, D1PreparedStatementLike } from "../src/lib/cloudflare";
import { createOutboundSendIntentStore, type OutboundSendIntent } from "../src/lib/revenue-engine/outbound-send-intent-store";
import { createOutboundDispatcher } from "../src/lib/revenue-engine/outbound-dispatch";
import { createExactEnvelopeTransport, outboundEnvelopeDigest, type OutboundEnvelope } from "../src/lib/revenue-engine/outbound-envelope";

const intent: OutboundSendIntent = {
  id: "a".repeat(64), ownerId: "fixture-owner", mailboxId: "fixture-mailbox",
  operationKey: "fixture-operation", payloadDigest: "b".repeat(64),
  mode: "MANUAL_REPLY", rfcMessageId: "<fixture-attempt@example.invalid>",
  budgetMonth: new Date().toISOString().slice(0, 7), reservedCostCents: 1,
};
function seedBudget(sqlite: Database.Database) {
  sqlite.prepare(`INSERT INTO "RuntimeBudgetMonth" ("month", "ceilingCents", "committedCents", "accountingDigest", "paused")
    VALUES (?, 5000, 0, ?, 0)`).run(intent.budgetMonth, "e".repeat(64));
}
function fixture() {
  const sqlite = new Database(":memory:");
  sqlite.exec(readFileSync("migrations/0073_outbound_send_intent.sql", "utf8"));
  seedBudget(sqlite);
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
  return { sqlite, database, store: createOutboundSendIntentStore(database) };
}

test("atomic claim has one winner across store instances sharing a SQLite connection", async () => {
  const { sqlite, database, store } = fixture();
  try {
    const other = createOutboundSendIntentStore(database);
    const results = await Promise.all([store.claim(intent), other.claim(intent), store.claim(intent)]);
    assert.equal(results.filter((result) => result.kind === "CLAIMED").length, 1);
    assert.equal((await createOutboundSendIntentStore(database).claim(intent)).kind, "EXISTING");
    assert.deepEqual(sqlite.prepare('SELECT count(*) n FROM "OutboundSendIntent"').get(), { n: 1 });
    await assert.rejects(store.claim({ ...intent, payloadDigest: "c".repeat(64) }), /CONFLICT/);
    await assert.rejects(store.claim({ ...intent, mailboxId: "other-mailbox" }), /CONFLICT/);
    assert.equal((await store.claim(intent)).row.state, "DISPATCHING");
  } finally { sqlite.close(); }
});

test("uncertainty never permits reclaim; exact acceptance is replayable but immutable", async () => {
  const { sqlite, store } = fixture();
  try {
    const claim = await store.claim(intent);
    assert.equal(claim.kind, "CLAIMED");
    if (claim.kind !== "CLAIMED") throw new Error("Expected claim");
    const token = claim.attemptToken;
    await assert.rejects(store.recordOutcome(intent, "0".repeat(32), { state: "REJECTED" }), /OUTBOUND_OUTCOME_CONFLICT/);
    await assert.rejects(store.recordOutcome(intent, "", { state: "REJECTED" }), /OUTBOUND_OUTCOME_CONFLICT/);
    assert.equal("attemptToken" in (await store.claim(intent)), false);
    assert.equal("attemptToken" in claim.row, false);
    await store.recordOutcome(intent, token, { state: "UNKNOWN" });
    assert.equal((await store.claim(intent)).kind, "EXISTING");
    await assert.rejects(store.recordOutcome(intent, token, { state: "REJECTED" }), /CONFLICT/);
    const acceptance = { state: "SENT" as const, providerMessageId: "fixture-message", providerThreadId: "fixture-thread" };
    const sent = await store.recordOutcome(intent, token, acceptance);
    assert.deepEqual(await store.recordOutcome(intent, token, acceptance), sent);
    await assert.rejects(store.recordOutcome(intent, token, { ...acceptance, providerMessageId: "different" }), /CONFLICT/);
    await assert.rejects(store.recordOutcome(intent, token, { state: "UNKNOWN" }), /CONFLICT/);
    assert.equal((await store.claim(intent)).kind, "EXISTING");
  } finally { sqlite.close(); }
});

test("SQL guards reject direct identity rewrites, terminal resets, premature results and deletion", async () => {
  const { sqlite, store } = fixture();
  try {
    const claim = await store.claim(intent);
    if (claim.kind !== "CLAIMED") throw new Error("Expected claim");
    assert.throws(() => sqlite.exec(`UPDATE "OutboundSendIntent" SET "mailboxId" = 'other'`));
    assert.throws(() => sqlite.exec(`UPDATE "OutboundSendIntent" SET "state" = 'SENT'`));
    await store.recordOutcome(intent, claim.attemptToken, { state: "REJECTED" });
    assert.throws(() => sqlite.exec(`UPDATE "OutboundSendIntent" SET "state" = 'DISPATCHING'`));
    assert.throws(() => sqlite.exec(`DELETE FROM "OutboundSendIntent"`));
    assert.equal((await store.claim(intent)).row.state, "REJECTED");
  } finally { sqlite.close(); }
});

test("invalid envelopes fail before storage and missing schema never manufactures a claim", async () => {
  let calls = 0;
  const unavailable = createOutboundSendIntentStore({ prepare() { calls++; throw new Error("UNAVAILABLE"); } });
  await assert.rejects(unavailable.claim({ ...intent, id: "invalid" }));
  await assert.rejects(unavailable.claim({ ...intent, id: intent.id + "\n" }));
  await assert.rejects(unavailable.claim({ ...intent, ownerId: intent.ownerId + "\n" }));
  await assert.rejects(unavailable.claim({ ...intent, rfcMessageId: intent.rfcMessageId + "\n" }));
  await assert.rejects(unavailable.claim({ ...intent, rfcMessageId: "<x@example.invalid>\r\nBcc: attacker@example.invalid" }));
  assert.equal(calls, 0);
  await assert.rejects(unavailable.claim(intent), /UNAVAILABLE/);
  assert.equal(calls, 1);
});

test("lost database acknowledgements do not grant a second claim or lose recorded acceptance", async () => {
  const { sqlite, database, store } = fixture();
  let loseAcknowledgement = true;
  const lossy = createOutboundSendIntentStore({ prepare(sql) {
    const underlying = database.prepare(sql);
    const wrapper: D1PreparedStatementLike = {
      bind(...values) { underlying.bind(...values); return wrapper; },
      all: underlying.all.bind(underlying),
      run: underlying.run.bind(underlying),
      async first<T>() {
        const result = await underlying.first<T>();
        if (loseAcknowledgement) {
          loseAcknowledgement = false;
          throw new Error("SYNTHETIC_ACK_LOST_AFTER_COMMIT");
        }
        return result;
      },
    };
    return wrapper;
  } });
  try {
    await assert.rejects(lossy.claim(intent), /ACK_LOST/);
    const recovered = await store.claim(intent);
    assert.equal(recovered.kind, "EXISTING");
    assert.equal(recovered.row.state, "DISPATCHING");
    // A lost claim acknowledgement intentionally loses the caller capability.
    // Use a separate intent to exercise a lost result acknowledgement after a
    // known successful claim. Reconciliation of the first requires its own path.
    const second = { ...intent, id: "c".repeat(64), operationKey: "second-operation", rfcMessageId: "<second@example.invalid>" };
    const claim = await store.claim(second);
    if (claim.kind !== "CLAIMED") throw new Error("Expected claim");
    loseAcknowledgement = true;
    const acceptance = { state: "SENT" as const, providerMessageId: "fixture-message", providerThreadId: "fixture-thread" };
    await assert.rejects(lossy.recordOutcome(second, claim.attemptToken, acceptance), /ACK_LOST/);
    assert.equal((await store.recordOutcome(second, claim.attemptToken, acceptance)).state, "SENT");
    assert.equal((await store.claim(intent)).kind, "EXISTING");
  } finally { sqlite.close(); }
});

test("separate processes race at a barrier and a new process cannot reclaim after reopen", { timeout: 30000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "axiom-send-intent-"));
  const path = join(directory, "synthetic.sqlite");
  const setup = new Database(path);
  setup.exec(readFileSync("migrations/0073_outbound_send_intent.sql", "utf8"));
  seedBudget(setup);
  setup.close();
  const children: ReturnType<typeof fork>[] = [];
  const abort = AbortSignal.timeout(20000);
  const start = (input = intent) => {
    const child = fork(resolve("scripts/fixtures/outbound-intent-process.ts"), [], {
      execArgv: ["--import", "tsx"], cwd: process.cwd(),
      // The app augments ProcessEnv with required runtime bindings. This isolated
      // fixture deliberately receives none of them (or inherited credentials).
      env: { SystemRoot: process.env.SystemRoot } as unknown as NodeJS.ProcessEnv,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    children.push(child);
    const closed = once(child, "exit", { signal: abort });
    const ready = once(child, "message", { signal: abort });
    child.send({ path, intent: input });
    return { child, closed, ready };
  };
  try {
    const racers = [start(), start(), start()];
    for (const racer of racers) assert.deepEqual((await racer.ready)[0], { ready: true });
    const results = racers.map(({ child }) => once(child, "message", { signal: abort }));
    for (const { child } of racers) child.send("GO");
    const outcomes = (await Promise.all(results)).map(([result]) => result);
    assert.equal(outcomes.filter((result) => result.kind === "CLAIMED").length, 1);
    assert.equal(outcomes.filter((result) => result.kind === "EXISTING").length, 2);
    for (const outcome of outcomes) assert.deepEqual(Object.keys(outcome).sort(), ["kind", "state"]);
    for (const racer of racers) assert.deepEqual(await racer.closed, [0, null]);
    const restarted = start();
    assert.deepEqual((await restarted.ready)[0], { ready: true });
    const reply = once(restarted.child, "message", { signal: abort });
    restarted.child.send("GO");
    assert.deepEqual((await reply)[0], { kind: "EXISTING", state: "DISPATCHING" });
    assert.deepEqual(await restarted.closed, [0, null]);
    const reopened = new Database(path, { readonly: true, fileMustExist: true });
    try { assert.deepEqual(reopened.prepare('SELECT count(*) n FROM "OutboundSendIntent"').get(), { n: 1 }); }
    finally { reopened.close(); }

    const budgetSetup = new Database(path, { fileMustExist: true });
    budgetSetup.exec('UPDATE "RuntimeBudgetMonth" SET "committedCents" = 4999');
    budgetSetup.close();
    const spendRacers = ["c", "d", "e"].map((key) => start({ ...intent,
      id: key.repeat(64), operationKey: `budget-${key}`, rfcMessageId: `<budget-${key}@example.invalid>` }));
    for (const racer of spendRacers) assert.deepEqual((await racer.ready)[0], { ready: true });
    const spendResults = spendRacers.map(({ child }) => once(child, "message", { signal: abort }));
    for (const { child } of spendRacers) child.send("GO");
    const spendOutcomes = (await Promise.all(spendResults)).map(([result]) => result);
    assert.equal(spendOutcomes.filter((result) => result.kind === "CLAIMED").length, 1);
    assert.equal(spendOutcomes.filter((result) => result.kind === "BUDGET_BLOCKED").length, 2);
    for (const racer of spendRacers) assert.deepEqual(await racer.closed, [0, null]);
    const finalRead = new Database(path, { readonly: true, fileMustExist: true });
    try {
      assert.deepEqual(finalRead.prepare('SELECT "committedCents" FROM "RuntimeBudgetMonth"').get(), { committedCents: 5000 });
      assert.deepEqual(finalRead.prepare('SELECT count(*) n FROM "OutboundSendIntent"').get(), { n: 2 });
    } finally { finalRead.close(); }
  } finally {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill();
        await exited;
      }
    }
    // Exact task-created directory only; no user database is opened or removed.
    rmSync(directory, { recursive: true, force: true });
  }
});

test("budget rejection rolls back the intent and exact replay does not reserve twice", async () => {
  const { sqlite, store } = fixture();
  try {
    sqlite.exec('UPDATE "RuntimeBudgetMonth" SET "committedCents" = 4999');
    await assert.rejects(store.claim({ ...intent, reservedCostCents: 2 }), /budget unavailable/);
    assert.deepEqual(sqlite.prepare('SELECT count(*) n FROM "OutboundSendIntent"').get(), { n: 0 });
    assert.deepEqual(sqlite.prepare('SELECT "committedCents" FROM "RuntimeBudgetMonth"').get(), { committedCents: 4999 });
    const claimed = await store.claim(intent);
    assert.equal(claimed.kind, "CLAIMED");
    assert.equal((await store.claim(intent)).kind, "EXISTING");
    assert.deepEqual(sqlite.prepare('SELECT "committedCents" FROM "RuntimeBudgetMonth"').get(), { committedCents: 5000 });
    await assert.rejects(store.claim({ ...intent, id: "f".repeat(64), operationKey: "new-operation",
      rfcMessageId: "<new@example.invalid>", reservedCostCents: 0 }), /budget unavailable/);
    assert.throws(() => sqlite.exec('UPDATE "RuntimeBudgetMonth" SET "ceilingCents" = 5001'));
    assert.throws(() => sqlite.exec('UPDATE "RuntimeBudgetMonth" SET "committedCents" = 0'));
    assert.throws(() => sqlite.exec('UPDATE "RuntimeBudgetMonth" SET "ceilingCents" = 4999'));
    sqlite.exec('UPDATE "RuntimeBudgetMonth" SET "paused" = 1, "committedCents" = 6000');
    assert.throws(() => sqlite.exec('UPDATE "RuntimeBudgetMonth" SET "paused" = 0'));
    assert.throws(() => sqlite.exec('DELETE FROM "RuntimeBudgetMonth"'));
  } finally { sqlite.close(); }
});

test("paused or unavailable billing policy blocks claims without a debit", async () => {
  const { sqlite, store } = fixture();
  try {
    sqlite.exec('UPDATE "RuntimeBudgetMonth" SET "paused" = 1');
    await assert.rejects(store.claim(intent), /budget unavailable/);
    sqlite.exec('UPDATE "RuntimeBudgetMonth" SET "paused" = 0');
    await assert.rejects(store.claim({ ...intent, budgetMonth: "2000-01" }), /budget unavailable/);
    assert.deepEqual(sqlite.prepare('SELECT "committedCents" FROM "RuntimeBudgetMonth"').get(), { committedCents: 0 });
    assert.deepEqual(sqlite.prepare('SELECT count(*) n FROM "OutboundSendIntent"').get(), { n: 0 });
  } finally { sqlite.close(); }
});

test("SQL validates opaque identities, Message-ID syntax, timestamps and replace attempts", async () => {
  const { sqlite, store } = fixture();
  try {
    const insert = (overrides: Record<string, unknown>) => {
      const row = { ...intent, attemptToken: "d".repeat(32), ...overrides };
      const keys = Object.keys(row);
      return sqlite.prepare(`INSERT INTO "OutboundSendIntent" (${keys.map((key) => `"${key}"`).join(",")})
        VALUES (${keys.map(() => "?").join(",")})`).run(...Object.values(row));
    };
    for (const field of ["ownerId", "mailboxId", "operationKey"]) {
      for (const value of ["space here", "x\u0000hidden", "x\r\nheader", "naïve", "", "x".repeat(257)]) {
        assert.throws(() => insert({ [field]: value }), `${field} must reject invalid identity`);
      }
    }
    for (const value of ["missing-brackets", "<@x>", "<x@>", "<x@y@z>", "<x@y>\u0000extra", "<x@y_z>"]) {
      assert.throws(() => insert({ rfcMessageId: value }));
    }
    for (const value of ["z".repeat(64), "a".repeat(64) + "\u0000hidden"]) assert.throws(() => insert({ id: value }));
    assert.throws(() => insert({ id: Buffer.from("a".repeat(64)) }));
    for (const value of [-1, 0.5, 9007199254740992]) assert.throws(() => insert({ createdAt: value, updatedAt: value }));
    const claim = await store.claim(intent);
    if (claim.kind !== "CLAIMED") throw new Error("Expected claim");
    await store.recordOutcome(intent, claim.attemptToken, { state: "REJECTED" });
    assert.throws(() => sqlite.prepare(`INSERT OR REPLACE INTO "OutboundSendIntent"
      ("id", "attemptToken", "ownerId", "mailboxId", "operationKey", "payloadDigest", "mode", "rfcMessageId", "budgetMonth", "reservedCostCents")
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(intent.id, "d".repeat(32), intent.ownerId, intent.mailboxId,
      intent.operationKey, intent.payloadDigest, intent.mode, intent.rfcMessageId, intent.budgetMonth, intent.reservedCostCents));
    assert.equal((await store.claim(intent)).row.state, "REJECTED");
  } finally { sqlite.close(); }
});

test("dispatcher never repeats provider effects when history projection fails", async () => {
  const { sqlite, store } = fixture();
  let sends = 0;
  let projections = 0;
  const dispatch = createOutboundDispatcher({
    // Synthetic policy only: this does not prove live consent/owner authorization.
    authorizeAndClaim: store.claim,
    recordOutcome: store.recordOutcome,
    async sendExactIntent() { sends++; return { messageId: "fixture-message", threadId: "fixture-thread" }; },
    async projectAccepted() { if (++projections === 1) throw new Error("Synthetic history failure"); },
  });
  try {
    assert.equal((await dispatch(intent)).state, "SENT_HISTORY_PENDING");
    assert.equal((await dispatch(intent)).state, "SENT");
    assert.equal(sends, 1);
    assert.equal(projections, 2);
    assert.deepEqual(sqlite.prepare('SELECT "committedCents" FROM "RuntimeBudgetMonth"').get(), { committedCents: 1 });
  } finally { sqlite.close(); }
});

test("dispatcher pauses ambiguous delivery even when its outcome write also fails", async () => {
  const { sqlite, store } = fixture();
  let sends = 0;
  const dispatch = createOutboundDispatcher({
    authorizeAndClaim: store.claim,
    async recordOutcome() { throw new Error("Synthetic unavailable store"); },
    async sendExactIntent() { sends++; throw new Error("Synthetic acceptance then network loss"); },
    async projectAccepted() { throw new Error("Must not project unknown delivery"); },
  });
  try {
    assert.equal((await dispatch(intent)).state, "DELIVERY_UNCERTAIN");
    assert.equal((await dispatch(intent)).state, "DELIVERY_UNCERTAIN");
    assert.equal(sends, 1);
    assert.equal((await store.claim(intent)).row.state, "DISPATCHING");
  } finally { sqlite.close(); }
});

test("dispatcher denial has no provider effect and concurrent calls deliver once", async () => {
  const { sqlite, store } = fixture();
  let sends = 0;
  const effects = { recordOutcome: store.recordOutcome,
    async sendExactIntent() { sends++; return { messageId: "fixture-message", threadId: "fixture-thread" }; },
    async projectAccepted() {},
  };
  try {
    const denied = createOutboundDispatcher({ ...effects, async authorizeAndClaim() { throw new Error("Synthetic policy stop"); } });
    await assert.rejects(denied(intent), /policy stop/);
    assert.equal(sends, 0);
    const dispatch = createOutboundDispatcher({ ...effects, authorizeAndClaim: store.claim });
    const results = await Promise.all([dispatch(intent), dispatch(intent), dispatch(intent)]);
    assert.equal(sends, 1);
    assert.equal(results.filter((result) => result.state === "SENT").length, 1);
    assert.equal(results.filter((result) => result.state === "DELIVERY_UNCERTAIN").length, 2);
  } finally { sqlite.close(); }
});

test("dispatcher recovers a committed acceptance after its acknowledgement is lost", async () => {
  const { sqlite, store } = fixture();
  let sends = 0;
  let projections = 0;
  const dispatch = createOutboundDispatcher({
    authorizeAndClaim: store.claim,
    async recordOutcome(...args) { await store.recordOutcome(...args); throw new Error("Synthetic lost commit acknowledgement"); },
    async sendExactIntent() { sends++; return { messageId: "fixture-message", threadId: "fixture-thread" }; },
    async projectAccepted() { projections++; },
  });
  try {
    assert.equal((await dispatch(intent)).state, "DELIVERY_UNCERTAIN");
    assert.equal(projections, 0);
    assert.equal((await dispatch(intent)).state, "SENT");
    assert.equal(projections, 1);
    assert.equal(sends, 1);
  } finally { sqlite.close(); }
});

test("confirmed transport rejection is durable, never resent and never projected", async () => {
  const { sqlite, store } = fixture();
  let sends = 0;
  const dispatch = createOutboundDispatcher({
    authorizeAndClaim: store.claim,
    recordOutcome: store.recordOutcome,
    async sendExactIntent() { sends++; return { rejected: true }; },
    async projectAccepted() { assert.fail("Rejected mail has no accepted history"); },
  });
  try {
    assert.deepEqual(await dispatch(intent), { state: "REJECTED", intentId: intent.id });
    assert.deepEqual(await dispatch(intent), { state: "REJECTED", intentId: intent.id });
    assert.equal(sends, 1);
    assert.equal((await store.claim(intent)).row.state, "REJECTED");
    assert.deepEqual(sqlite.prepare('SELECT "committedCents" FROM "RuntimeBudgetMonth"').get(), { committedCents: 1 });
  } finally { sqlite.close(); }
});

test("rejection acknowledgement loss and storage failure never allow redelivery", async () => {
  for (const commit of [true, false]) {
    const { sqlite, store } = fixture();
    let sends = 0;
    const dispatch = createOutboundDispatcher({
      authorizeAndClaim: store.claim,
      async recordOutcome(...args) {
        if (commit) await store.recordOutcome(...args);
        throw new Error("Synthetic receipt storage failure");
      },
      async sendExactIntent() { sends++; return { rejected: true }; },
      async projectAccepted() { assert.fail("Must not project rejection"); },
    });
    try {
      assert.equal((await dispatch(intent)).state, "DELIVERY_UNCERTAIN");
      assert.equal((await dispatch(intent)).state, commit ? "REJECTED" : "DELIVERY_UNCERTAIN");
      assert.equal(sends, 1);
      assert.equal((await store.claim(intent)).row.state, commit ? "REJECTED" : "DISPATCHING");
    } finally { sqlite.close(); }
  }
});

test("contradictory rejection receipt remains uncertain rather than discarding acceptance", async () => {
  const { sqlite, store } = fixture();
  let sends = 0;
  const dispatch = createOutboundDispatcher({
    authorizeAndClaim: store.claim,
    recordOutcome: store.recordOutcome,
    async sendExactIntent() { sends++; return { rejected: true, messageId: "fixture-message", threadId: "fixture-thread" }; },
    async projectAccepted() { assert.fail("Malformed receipt must not project"); },
  });
  try {
    assert.equal((await dispatch(intent)).state, "DELIVERY_UNCERTAIN");
    assert.equal((await store.claim(intent)).row.state, "UNKNOWN");
    assert.equal((await dispatch(intent)).state, "DELIVERY_UNCERTAIN");
    assert.equal(sends, 1);
  } finally { sqlite.close(); }
});

test("dispatcher composes exact-envelope transport with durable one-attempt storage", async () => {
  const { sqlite, store } = fixture();
  const approved: OutboundEnvelope = {
    version: "outbound-envelope-v1", ownerId: intent.ownerId, mailboxId: intent.mailboxId,
    connectionId: "fixture-connection", leadId: 1, policyVersion: "fixture-policy",
    mode: intent.mode, from: "sender@example.invalid", fromName: null, to: "lead@example.invalid",
    subject: "Final approved subject", bodyPlain: "Final approved reply.", bodyHtml: "",
    threadId: "fixture-thread", inReplyTo: "<original@example.invalid>", references: ["<original@example.invalid>"],
    rfcMessageId: intent.rfcMessageId,
  };
  const exactIntent = { ...intent, payloadDigest: await outboundEnvelopeDigest(approved) };
  let sends = 0;
  const transport = createExactEnvelopeTransport({
    async loadEnvelope() { return approved; },
    async resolveMailbox(identity) { return { ...identity, accessToken: "synthetic-token" }; },
    async send(options) {
      sends++;
      assert.equal(options.to, approved.to);
      assert.equal(options.subject, approved.subject);
      assert.equal(options.rfcMessageId, exactIntent.rfcMessageId);
      return { messageId: "fixture-message", threadId: "fixture-thread" };
    },
  });
  const dispatch = createOutboundDispatcher({
    authorizeAndClaim: store.claim, // synthetic authorization, not the real policy boundary
    recordOutcome: store.recordOutcome, sendExactIntent: transport,
    async projectAccepted() {},
  });
  try {
    assert.equal((await dispatch(exactIntent)).state, "SENT");
    assert.equal((await dispatch(exactIntent)).state, "SENT");
    assert.equal(sends, 1);
  } finally { sqlite.close(); }
});
