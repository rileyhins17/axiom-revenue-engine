import assert from "node:assert/strict";
import { mkdtempSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";

import {
  createCloudflareRevenueCostLedgerD1Boundary,
  type CostLedgerReservationRequest,
} from "@/lib/revenue-engine/cost-ledger-d1";

const migration = readFileSync(new URL("../../../migrations/0070_revenue_cost_reservations.sql", import.meta.url), "utf8");
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);

type SqliteStatement = {
  bind: (...values: unknown[]) => SqliteStatement;
  run: () => { success: true; results: Record<string, unknown>[]; meta: { changes: number } };
};

function periodRange(offsetMonths = 0): { month: string; startAt: string; endAt: string } {
  const localParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto", year: "numeric", month: "2-digit",
  }).formatToParts(new Date());
  const localYear = Number(localParts.find((part) => part.type === "year")?.value);
  const localMonth = Number(localParts.find((part) => part.type === "month")?.value);
  const localStart = new Date(Date.UTC(localYear, localMonth - 1 + offsetMonths, 1));
  const localEnd = new Date(Date.UTC(localStart.getUTCFullYear(), localStart.getUTCMonth() + 1, 1));
  const startAt = torontoMidnightUtc(localStart.getUTCFullYear(), localStart.getUTCMonth());
  const endAt = torontoMidnightUtc(localEnd.getUTCFullYear(), localEnd.getUTCMonth());
  return { month: localStart.toISOString().slice(0, 7), startAt, endAt };
}

function torontoMidnightUtc(year: number, zeroBasedMonth: number): string {
  for (const hour of [4, 5]) {
    const candidate = new Date(Date.UTC(year, zeroBasedMonth, 1, hour));
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(candidate);
    const part = (type: string) => parts.find((item) => item.type === type)?.value;
    if (Number(part("year")) === year && Number(part("month")) === zeroBasedMonth + 1 && part("day") === "01" &&
        part("hour") === "00" && part("minute") === "00" && part("second") === "00") return candidate.toISOString();
  }
  assert.fail(`Cannot find Toronto midnight for ${year}-${zeroBasedMonth + 1}`);
}

function wrongTorontoMonthBoundary(periodMonth: string): { startAt: string; endAt: string } {
  const [year, month] = periodMonth.split("-").map(Number);
  const wrong = (boundaryYear: number, boundaryMonth: number) => {
    const correct = new Date(torontoMidnightUtc(boundaryYear, boundaryMonth - 1));
    const otherHour = correct.getUTCHours() === 4 ? 5 : 4;
    return new Date(Date.UTC(boundaryYear, boundaryMonth - 1, 1, otherHour)).toISOString();
  };
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return { startAt: wrong(year, month), endAt: wrong(nextYear, nextMonth) };
}

function sqliteD1(db: Database.Database) {
  return {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      return {
        bind(...values: unknown[]) { bindings = values; return this; },
        run() {
          const prepared = db.prepare(sql);
          if (/^\s*SELECT/i.test(sql)) {
            return { success: true as const, results: prepared.all(...bindings) as Record<string, unknown>[], meta: { changes: 0 } };
          }
          const result = prepared.run(...bindings);
          return { success: true as const, results: [], meta: { changes: Number(result.changes) } };
        },
      } as SqliteStatement;
    },
    async batch(statements: SqliteStatement[]) {
      const transaction = db.transaction(() => statements.map((prepared) => prepared.run()));
      return transaction();
    },
  } as unknown as Pick<D1Database, "prepare" | "batch">;
}

function insertPeriod(db: Database.Database, options: { offsetMonths?: number; rateVersion?: string; fxVersion?: string; taxVersion?: string; reserveMicro?: number; fixedMicro?: number; startAt?: string; endAt?: string } = {}) {
  const range = periodRange(options.offsetMonths ?? 0);
  db.prepare(`INSERT INTO RevenueCostBudgetPeriod
    (month,startAt,endAt,capMicro,discretionaryStopMicro,warningMicro,essentialReserveMicro,fixedCommitmentsMicro,configDigest,rateVersion,fxVersion,taxVersion,configured)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)`)
    .run(range.month, options.startAt ?? range.startAt, options.endAt ?? range.endAt, 50_000_000, 42_500_000, 35_000_000, options.reserveMicro ?? 7_500_000,
      options.fixedMicro ?? 0, DIGEST_A, options.rateVersion ?? "rate-v1", options.fxVersion ?? "fx-v1", options.taxVersion ?? "tax-v1");
  return range;
}

function fixture(options: Parameters<typeof insertPeriod>[1] = {}) {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(migration);
  const range = insertPeriod(db, options);
  const base: CostLedgerReservationRequest = {
    periodMonth: range.month,
    amountMicro: 10_000_000,
    kind: "DISCRETIONARY",
    idempotencyKey: "request-1",
    requestDigest: DIGEST_A,
    provider: "fixture-provider",
    operation: "bounded-audit",
    attemptIdentity: "attempt-1",
    quoteIdentity: "quote-1",
    quoteExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    rateVersion: "rate-v1",
    fxVersion: "fx-v1",
    taxVersion: "tax-v1",
    evidenceDigest: DIGEST_B,
  };
  return { db, base, ledger: createCloudflareRevenueCostLedgerD1Boundary(sqliteD1(db)) };
}

function request(base: CostLedgerReservationRequest, suffix: number, fields: Partial<CostLedgerReservationRequest> = {}): CostLedgerReservationRequest {
  return {
    ...base,
    idempotencyKey: `request-${suffix}`,
    attemptIdentity: `attempt-${suffix}`,
    quoteIdentity: `quote-${suffix}`,
    ...fields,
  };
}

test("admission is atomic across providers, enforces both ceilings, and replay has no call authority", async () => {
  const { ledger, base } = fixture();
  const first = await ledger.reserve(base);
  assert.equal(first.status, "HELD");
  assert.equal(first.forecast?.committedMicro, 10_000_000);

  const second = await ledger.reserve(request(base, 2, { amountMicro: 32_500_000, provider: "another-provider" }));
  assert.equal(second.status, "HELD");
  assert.equal(second.forecast?.committedMicro, 42_500_000);
  assert.equal((await ledger.reserve(request(base, 3, { amountMicro: 1 }))).status, "DENIED_BUDGET");

  const replay = await ledger.reserve(base);
  assert.equal(replay.status, "REPLAY_HELD_NO_AUTHORITY");
  assert.equal(replay.reservationId, first.reservationId);
  assert.equal(replay.forecast?.warningReached, true);
  await assert.rejects(() => ledger.reserve({ ...base, amountMicro: 11_000_000 }), /IDEMPOTENCY_CONFLICT/);
  await assert.rejects(() => ledger.reserve({ ...base, provider: "changed-provider" }), /IDEMPOTENCY_CONFLICT/);
  await assert.rejects(() => ledger.reserve({ ...base, quoteExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() }), /IDEMPOTENCY_CONFLICT/);
});

test("parallel reservations share the provider-independent budget with no cap race", async () => {
  const { ledger, base } = fixture({ fixedMicro: 2_500_000 });
  const results = await Promise.all(Array.from({ length: 6 }, (_, index) => ledger.reserve(request(base, index + 1, {
    amountMicro: 10_000_000,
    provider: index % 2 === 0 ? "provider-a" : "provider-b",
  }))));
  assert.equal(results.filter((item) => item.status === "HELD").length, 4);
  assert.equal(results.filter((item) => item.status === "DENIED_BUDGET").length, 2);
  assert.equal((await ledger.getForecast(base.periodMonth))?.committedMicro, 42_500_000);
});

test("failed D1 batch metadata cannot be mistaken for a successful hold", async () => {
  const { base } = fixture();
  const failedDatabase = {
    prepare() { return { bind() { return this; } }; },
    async batch(statements: unknown[]) {
      return statements.map(() => ({ success: false, error: "simulated D1 failure", meta: { changes: 0 }, results: [] }));
    },
  } as unknown as Pick<D1Database, "prepare" | "batch">;
  const ledger = createCloudflareRevenueCostLedgerD1Boundary(failedDatabase);
  await assert.rejects(() => ledger.reserve(base), /COST_LEDGER_SQL_FAILED:simulated D1 failure/);
});

test("essential work can use the full cap while discretionary work preserves the reserve", async () => {
  const { ledger, base } = fixture({ reserveMicro: 7_500_000 });
  assert.equal((await ledger.reserve(request(base, 1, { amountMicro: 42_500_000 }))).status, "HELD");
  assert.equal((await ledger.reserve(request(base, 2, { amountMicro: 7_500_000, kind: "ESSENTIAL" }))).status, "HELD");
  assert.equal((await ledger.reserve(request(base, 3, { amountMicro: 1, kind: "ESSENTIAL" }))).status, "DENIED_BUDGET");
  const forecast = await ledger.getForecast(base.periodMonth);
  assert.equal(forecast?.committedMicro, 50_000_000);
  assert.equal(forecast?.remainingMicro, 0);
  assert.equal(forecast?.warningReached, true);
});

test("database time governs month activity and quote expiry; mismatched versions fail closed", async () => {
  const { db, base, ledger } = fixture();
  assert.equal((await ledger.reserve({ ...base, quoteExpiresAt: new Date(Date.now() - 1000).toISOString() })).status, "DENIED_QUOTE");
  assert.equal((await ledger.reserve({ ...base, periodMonth: "1900-01" })).status, "DENIED_PERIOD");
  const future = insertPeriod(db, { offsetMonths: 1 });
  assert.equal((await ledger.reserve({ ...base, periodMonth: future.month })).status, "DENIED_PERIOD");
  assert.equal((await ledger.reserve({ ...base, rateVersion: "rate-v2" })).status, "DENIED_PERIOD");
  assert.equal((await ledger.reserve({ ...base, fxVersion: "fx-v2" })).status, "DENIED_PERIOD");
  assert.equal((await ledger.reserve({ ...base, taxVersion: "tax-v2" })).status, "DENIED_PERIOD");
  await assert.rejects(() => ledger.reserve({ ...base, quoteExpiresAt: "tomorrow" }), /quoteExpiresAt_INVALID/);
});

test("Toronto month canonical windows cover DST transition months and reject schema-valid wrong hours", async () => {
  assert.equal(torontoMidnightUtc(2026, 2), "2026-03-01T05:00:00.000Z");
  assert.equal(torontoMidnightUtc(2026, 10), "2026-11-01T04:00:00.000Z");

  const range = periodRange();
  const wrongWindow = wrongTorontoMonthBoundary(range.month);
  const { db, base, ledger } = fixture(wrongWindow);
  assert.equal((await ledger.reserve(base)).status, "DENIED_PERIOD");
  assert.equal((await ledger.getForecast(base.periodMonth))?.active, false);

  const invalidWindowHold = { ...base, idempotencyKey: "sql-wrong-window", attemptIdentity: "sql-wrong-window-attempt" };
  db.prepare(`INSERT INTO RevenueCostReservation
    (reservationId,idempotencyKey,requestDigest,periodMonth,amountMicro,kind,provider,operation,attemptIdentity,quoteIdentity,quoteExpiresAt,rateVersion,fxVersion,taxVersion,evidenceDigest)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(`direct:${invalidWindowHold.idempotencyKey}`, invalidWindowHold.idempotencyKey,
      invalidWindowHold.requestDigest, invalidWindowHold.periodMonth, invalidWindowHold.amountMicro, invalidWindowHold.kind,
      invalidWindowHold.provider, invalidWindowHold.operation, invalidWindowHold.attemptIdentity, invalidWindowHold.quoteIdentity,
      invalidWindowHold.quoteExpiresAt, invalidWindowHold.rateVersion, invalidWindowHold.fxVersion, invalidWindowHold.taxVersion, invalidWindowHold.evidenceDigest);
  await assert.rejects(() => ledger.startAttempt({ reservationId: `direct:${invalidWindowHold.idempotencyKey}`, attemptId: invalidWindowHold.attemptIdentity }), /ATTEMPT_NOT_ADMITTED/);
  db.close();
});

test("attempt admission is exact, only the first write permits a call, and release is blocked after attempt", async () => {
  const { db, ledger, base } = fixture();
  const held = await ledger.reserve(base);
  const started = await ledger.startAttempt({ reservationId: held.reservationId, attemptId: base.attemptIdentity });
  assert.deepEqual(started, { attemptId: base.attemptIdentity, status: "STARTED", mayCallProvider: true });
  const replay = await ledger.startAttempt({ reservationId: held.reservationId, attemptId: base.attemptIdentity });
  assert.deepEqual(replay, { attemptId: base.attemptIdentity, status: "REPLAY_NO_AUTHORITY", mayCallProvider: false });
  await assert.rejects(() => ledger.startAttempt({ reservationId: held.reservationId, attemptId: "different-attempt" }), /ATTEMPT_IDENTITY_CONFLICT/);
  await assert.rejects(() => ledger.release({ reservationId: held.reservationId, releaseId: "release-1", proof: "owner-cancelled" }), /ATTEMPT_STARTED/);
  assert.throws(() => db.prepare(`INSERT INTO RevenueCostRelease(releaseId,reservationId,proof,releasedAt)
    VALUES('direct-release',?,?,CURRENT_TIMESTAMP)`).run(held.reservationId, "direct-proof"), /ATTEMPT_STARTED/);
});

test("release is exact and idempotent, and released holds cannot start or settle", async () => {
  const { db, ledger, base } = fixture();
  const held = await ledger.reserve(base);
  assert.deepEqual(await ledger.release({ reservationId: held.reservationId, releaseId: "release-1", proof: "owner-cancelled" }), { releaseId: "release-1", status: "RELEASED" });
  assert.deepEqual(await ledger.release({ reservationId: held.reservationId, releaseId: "release-1", proof: "owner-cancelled" }), { releaseId: "release-1", status: "REPLAY_NO_AUTHORITY" });
  await assert.rejects(() => ledger.release({ reservationId: held.reservationId, releaseId: "release-1", proof: "different-proof" }), /RELEASE_CONFLICT/);
  await assert.rejects(() => ledger.release({ reservationId: "missing-hold", releaseId: "release-2", proof: "proof" }), /HOLD_UNKNOWN/);
  await assert.rejects(() => ledger.startAttempt({ reservationId: held.reservationId, attemptId: base.attemptIdentity }), /ATTEMPT_NOT_ADMITTED/);
  await assert.rejects(() => ledger.settle({ settlementId: "settlement-1", reservationId: held.reservationId, attemptId: base.attemptIdentity,
    actualMicro: 0, providerReceiptId: "receipt-1", actualEvidenceDigest: DIGEST_B }), /ATTEMPT_UNKNOWN/);
  assert.throws(() => db.prepare(`INSERT INTO RevenueCostAttempt(attemptId,reservationId,state,startedAt)
    VALUES(?,?,'STARTED',CURRENT_TIMESTAMP)`).run(base.attemptIdentity, held.reservationId), /ATTEMPT_AFTER_RELEASE/);
});

test("ambiguity is durable and idempotent while its reservation remains held", async () => {
  const { ledger, base } = fixture();
  const held = await ledger.reserve(base);
  await ledger.startAttempt({ reservationId: held.reservationId, attemptId: base.attemptIdentity });
  assert.deepEqual(await ledger.markAttemptAmbiguous(base.attemptIdentity), { attemptId: base.attemptIdentity, state: "AMBIGUOUS", replayed: false, historical: false });
  assert.deepEqual(await ledger.markAttemptAmbiguous(base.attemptIdentity), { attemptId: base.attemptIdentity, state: "AMBIGUOUS", replayed: true, historical: false });
  assert.equal((await ledger.getForecast(base.periodMonth))?.unresolvedHoldsMicro, base.amountMicro);
  await assert.rejects(() => ledger.markAttemptAmbiguous("unknown-attempt"), /ATTEMPT_UNKNOWN/);
});

test("settlement is full-field idempotent, rejects unsafe amounts, records overruns, and blocks later admission", async () => {
  const { ledger, base } = fixture();
  const held = await ledger.reserve(base);
  await ledger.startAttempt({ reservationId: held.reservationId, attemptId: base.attemptIdentity });
  await ledger.markAttemptAmbiguous(base.attemptIdentity);
  const settlement = { settlementId: "settlement-1", reservationId: held.reservationId, attemptId: base.attemptIdentity,
    actualMicro: 60_000_000, providerReceiptId: "receipt-1", actualEvidenceDigest: DIGEST_A };
  const settled = await ledger.settle(settlement);
  assert.equal(settled.status, "SETTLED");
  assert.equal(settled.actualMicro, 60_000_000);
  assert.equal(settled.forecast?.overCap, true);
  assert.equal((await ledger.settle(settlement)).status, "REPLAY_NO_AUTHORITY");
  assert.deepEqual(await ledger.markAttemptAmbiguous(base.attemptIdentity), { attemptId: base.attemptIdentity, state: "AMBIGUOUS", replayed: true, historical: true });
  await assert.rejects(() => ledger.settle({ ...settlement, actualMicro: 59_000_000 }), /SETTLEMENT_CONFLICT/);
  await assert.rejects(() => ledger.settle({ ...settlement, providerReceiptId: "receipt-2" }), /SETTLEMENT_CONFLICT/);
  await assert.rejects(() => ledger.settle({ ...settlement, actualMicro: Number.MAX_SAFE_INTEGER + 1 }), /actualMicro_INVALID/);
  assert.equal((await ledger.reserve(request(base, 2, { amountMicro: 1 }))).status, "DENIED_BUDGET");
  await assert.rejects(() => ledger.settle({ ...settlement, settlementId: "second-settlement" }), /SETTLEMENT_CONFLICT/);
});

test("migration constraints reject direct mutation bypasses and persisted rows reload from disk", async () => {
  const directory = mkdtempSync(join(tmpdir(), "revenue-cost-ledger-"));
  const path = join(directory, "ledger.sqlite");
  let db: Database.Database | undefined;
  try {
    const original = new Database(path);
    db = original;
    original.pragma("foreign_keys = ON");
    original.exec(migration);
    const range = insertPeriod(original);
    const ledger = createCloudflareRevenueCostLedgerD1Boundary(sqliteD1(original));
    const base = fixtureRequest(range.month);
    const held = await ledger.reserve(base);
    assert.throws(() => original.prepare("UPDATE RevenueCostBudgetPeriod SET capMicro=1").run(), /IMMUTABLE_COST_LEDGER/);
    assert.throws(() => original.prepare("DELETE FROM RevenueCostReservation WHERE reservationId=?").run(held.reservationId), /IMMUTABLE_COST_LEDGER/);
    assert.throws(() => original.prepare("UPDATE RevenueCostReservation SET amountMicro=1 WHERE reservationId=?").run(held.reservationId), /IMMUTABLE_COST_LEDGER/);

    const directInsert = (reservation: CostLedgerReservationRequest) => original.prepare(`INSERT INTO RevenueCostReservation
      (reservationId,idempotencyKey,requestDigest,periodMonth,amountMicro,kind,provider,operation,attemptIdentity,quoteIdentity,quoteExpiresAt,rateVersion,fxVersion,taxVersion,evidenceDigest)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(`direct:${reservation.idempotencyKey}`, reservation.idempotencyKey, reservation.requestDigest,
        reservation.periodMonth, reservation.amountMicro, reservation.kind, reservation.provider, reservation.operation, reservation.attemptIdentity,
        reservation.quoteIdentity, reservation.quoteExpiresAt, reservation.rateVersion, reservation.fxVersion, reservation.taxVersion, reservation.evidenceDigest);
    const initialCount = Number((original.prepare("SELECT COUNT(*) AS count FROM RevenueCostReservation").get() as { count: number }).count);
    assert.throws(() => directInsert({ ...fixtureRequest(range.month), idempotencyKey: "direct-over-cap", amountMicro: 42_500_001 }), /COST_BUDGET_EXCEEDED/);
    for (const [field, value] of [["rateVersion", "rate-v2"], ["fxVersion", "fx-v2"], ["taxVersion", "tax-v2"]] as const) {
      assert.throws(() => directInsert({ ...fixtureRequest(range.month), idempotencyKey: `direct-${field}`, [field]: value }), /COST_CONFIG_MISMATCH/);
    }
    assert.throws(() => directInsert({ ...fixtureRequest(range.month), idempotencyKey: "direct-expired-quote", quoteExpiresAt: new Date(Date.now() - 60_000).toISOString() }), /COST_QUOTE_EXPIRED/);
    const futureRange = insertPeriod(original, { offsetMonths: 1 });
    assert.throws(() => directInsert({ ...fixtureRequest(futureRange.month), idempotencyKey: "direct-future-period" }), /COST_PERIOD_INACTIVE/);
    const finalCount = Number((original.prepare("SELECT COUNT(*) AS count FROM RevenueCostReservation").get() as { count: number }).count);
    assert.equal(finalCount, initialCount);
    original.close();

    db = new Database(path);
    db.pragma("foreign_keys = ON");
    const reloaded = createCloudflareRevenueCostLedgerD1Boundary(sqliteD1(db));
    assert.equal((await reloaded.getForecast(base.periodMonth))?.unresolvedHoldsMicro, base.amountMicro);
    db.close();
  } finally {
    db?.close();
    unlinkSync(path);
    rmdirSync(directory);
  }
});

function fixtureRequest(periodMonth: string): CostLedgerReservationRequest {
  return {
    periodMonth, amountMicro: 10_000_000, kind: "DISCRETIONARY", idempotencyKey: "disk-request", requestDigest: DIGEST_A,
    provider: "fixture-provider", operation: "disk-check", attemptIdentity: "disk-attempt", quoteIdentity: "disk-quote",
    quoteExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), rateVersion: "rate-v1", fxVersion: "fx-v1", taxVersion: "tax-v1", evidenceDigest: DIGEST_B,
  };
}
