type SqlValue = string | number | null;
type Row = Record<string, unknown>;
type Statement = { sql: string; bindings: readonly SqlValue[] };
type BatchItem = { success: boolean; results: Row[]; meta: { changes: number }; error?: string };

const HEX_64 = /^[a-f0-9]{64}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const LIMITS = Object.freeze({ identity: 160, evidence: 512, timestamp: 40 });

export type CostKind = "ESSENTIAL" | "DISCRETIONARY";

export type CostLedgerReservationRequest = Readonly<{
  periodMonth: string;
  amountMicro: number;
  kind: CostKind;
  idempotencyKey: string;
  requestDigest: string;
  provider: string;
  operation: string;
  attemptIdentity: string;
  quoteIdentity: string;
  quoteExpiresAt: string;
  rateVersion: string;
  fxVersion: string;
  taxVersion: string;
  evidenceDigest: string;
}>;

export type CostLedgerReservation = Readonly<{
  reservationId: string;
  status: "HELD" | "REPLAY_HELD_NO_AUTHORITY" | "DENIED_BUDGET" | "DENIED_PERIOD" | "DENIED_QUOTE";
  forecast?: CostLedgerForecast;
}>;

export type CostLedgerForecast = Readonly<{
  periodMonth: string;
  active: boolean;
  capMicro: number;
  discretionaryStopMicro: number;
  warningMicro: number;
  essentialReserveMicro: number;
  fixedCommitmentsMicro: number;
  settledActualMicro: number;
  unresolvedHoldsMicro: number;
  committedMicro: number;
  remainingMicro: number;
  warningReached: boolean;
  overCap: boolean;
  versions: Readonly<{ rate: string; fx: string; tax: string }>;
}>;

export type CostLedgerAttemptStart = Readonly<{
  attemptId: string;
  status: "STARTED" | "REPLAY_NO_AUTHORITY";
  mayCallProvider: boolean;
}>;

export type CostLedgerBoundary = ReturnType<typeof createCloudflareRevenueCostLedgerD1Boundary>;

function fail(code: string): never { throw new Error(code); }

function identity(value: string, name: string, maxLength: number = LIMITS.identity): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || value.trim() !== value || value.trim().length === 0 || /[\u0000-\u001f\u007f]/.test(value)) {
    return fail(`${name}_INVALID`);
  }
  return value;
}

function digest(value: string, name: string): string {
  if (typeof value !== "string" || !HEX_64.test(value)) return fail(`${name}_INVALID`);
  return value;
}

function micro(value: number, name: string, positive = false): number {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) return fail(`${name}_INVALID`);
  return value;
}

function month(value: string): string {
  if (typeof value !== "string" || !MONTH.test(value)) return fail("periodMonth_INVALID");
  return value;
}

function timestamp(value: string, name: string): string {
  if (typeof value !== "string" || value.length > LIMITS.timestamp || !ISO_DATE_TIME.test(value) || !Number.isFinite(Date.parse(value))) {
    return fail(`${name}_INVALID`);
  }
  return value;
}

function torontoMonthBoundary(periodMonth: string): { startAt: string; endAt: string } {
  if (!MONTH.test(periodMonth)) return fail("periodMonth_INVALID");
  const [year, monthNumber] = periodMonth.split("-").map(Number);
  const boundary = (yearValue: number, monthValue: number): string => {
    for (const hour of [4, 5]) {
      const candidate = new Date(Date.UTC(yearValue, monthValue - 1, 1, hour));
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
      }).formatToParts(candidate);
      const part = (type: string) => parts.find((item) => item.type === type)?.value;
      if (Number(part("year")) === yearValue && Number(part("month")) === monthValue &&
          part("day") === "01" && part("hour") === "00" && part("minute") === "00" && part("second") === "00") {
        return candidate.toISOString();
      }
    }
    return fail("TORONTO_MONTH_BOUNDARY_UNAVAILABLE");
  };
  const next = monthNumber === 12 ? { year: year + 1, month: 1 } : { year, month: monthNumber + 1 };
  return { startAt: boundary(year, monthNumber), endAt: boundary(next.year, next.month) };
}

function canonicalPeriodWindow(row: Row): boolean {
  const expected = torontoMonthBoundary(stringField(row, "periodMonth"));
  const startAt = stringField(row, "startAt");
  const endAt = stringField(row, "endAt");
  return Date.parse(startAt) === Date.parse(expected.startAt) && Date.parse(endAt) === Date.parse(expected.endAt);
}

function kind(value: CostKind): CostKind {
  if (value !== "ESSENTIAL" && value !== "DISCRETIONARY") return fail("kind_INVALID");
  return value;
}

function statement(sql: string, bindings: readonly SqlValue[] = []): Statement { return { sql, bindings }; }

function numberField(row: Row, field: string): number {
  const value = row[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return fail(`LEDGER_${field.toUpperCase()}_UNSAFE`);
  return value;
}

function stringField(row: Row, field: string): string {
  const value = row[field];
  if (typeof value !== "string") return fail(`LEDGER_${field.toUpperCase()}_INVALID`);
  return value;
}

function sameRequest(row: Row, request: CostLedgerReservationRequest): boolean {
  return row.requestDigest === request.requestDigest && row.periodMonth === request.periodMonth &&
    numberField(row, "amountMicro") === request.amountMicro && row.kind === request.kind &&
    row.provider === request.provider && row.operation === request.operation &&
    row.attemptIdentity === request.attemptIdentity && row.quoteIdentity === request.quoteIdentity &&
    row.quoteExpiresAt === request.quoteExpiresAt && row.rateVersion === request.rateVersion &&
    row.fxVersion === request.fxVersion && row.taxVersion === request.taxVersion &&
    row.evidenceDigest === request.evidenceDigest;
}

const FORECAST_SELECT = `
  SELECT p.month AS periodMonth,p.startAt,p.endAt,
    CASE WHEN julianday(p.startAt) <= julianday('now') AND julianday(p.endAt) > julianday('now') AND p.configured=1 THEN 1 ELSE 0 END AS active,
    p.capMicro, p.discretionaryStopMicro, p.warningMicro, p.essentialReserveMicro, p.fixedCommitmentsMicro,
    COALESCE((SELECT SUM(s.actualMicro) FROM RevenueCostSettlement s JOIN RevenueCostReservation r ON r.reservationId=s.reservationId WHERE r.periodMonth=p.month),0) AS settledActualMicro,
    COALESCE((SELECT SUM(r.amountMicro) FROM RevenueCostReservation r WHERE r.periodMonth=p.month
      AND NOT EXISTS (SELECT 1 FROM RevenueCostRelease x WHERE x.reservationId=r.reservationId)
      AND NOT EXISTS (SELECT 1 FROM RevenueCostSettlement s WHERE s.reservationId=r.reservationId)),0) AS unresolvedHoldsMicro,
    p.rateVersion, p.fxVersion, p.taxVersion
  FROM RevenueCostBudgetPeriod p WHERE p.month=?`;

function forecastFrom(row: Row): CostLedgerForecast {
  const capMicro = numberField(row, "capMicro");
  const discretionaryStopMicro = numberField(row, "discretionaryStopMicro");
  const warningMicro = numberField(row, "warningMicro");
  const essentialReserveMicro = numberField(row, "essentialReserveMicro");
  const fixedCommitmentsMicro = numberField(row, "fixedCommitmentsMicro");
  const settledActualMicro = numberField(row, "settledActualMicro");
  const unresolvedHoldsMicro = numberField(row, "unresolvedHoldsMicro");
  const committedMicro = fixedCommitmentsMicro + settledActualMicro + unresolvedHoldsMicro;
  if (!Number.isSafeInteger(committedMicro)) return fail("LEDGER_FORECAST_UNSAFE");
  return {
    periodMonth: stringField(row, "periodMonth"), active: Number(row.active) === 1 && canonicalPeriodWindow(row), capMicro,
    discretionaryStopMicro, warningMicro, essentialReserveMicro, fixedCommitmentsMicro,
    settledActualMicro, unresolvedHoldsMicro, committedMicro, remainingMicro: capMicro - committedMicro,
    warningReached: committedMicro >= warningMicro, overCap: committedMicro > capMicro,
    versions: { rate: stringField(row, "rateVersion"), fx: stringField(row, "fxVersion"), tax: stringField(row, "taxVersion") },
  };
}

export function createCloudflareRevenueCostLedgerD1Boundary(database: Pick<D1Database, "prepare" | "batch">) {
  async function batch(statements: readonly Statement[]): Promise<BatchItem[]> {
    let results: D1Result<Row>[];
    try {
      const prepared = statements.map(({ sql, bindings }) => database.prepare(sql).bind(...bindings));
      results = await database.batch<Row>(prepared);
    } catch (error) {
      throw new Error("COST_LEDGER_BATCH_FAILED", { cause: error });
    }
    if (!Array.isArray(results) || results.length !== statements.length) return fail("COST_LEDGER_BATCH_INCOMPLETE");
    return results.map((result) => {
      if (!result || result.success !== true || !result.meta || !Number.isSafeInteger(result.meta.changes) || result.meta.changes < 0 || !Array.isArray(result.results)) {
        return fail(`COST_LEDGER_SQL_FAILED${result?.error ? `:${result.error}` : ""}`);
      }
      return { success: true, meta: { changes: result.meta.changes }, results: result.results as Row[], error: result.error };
    });
  }

  async function forecast(periodMonth: string): Promise<CostLedgerForecast | null> {
    const result = await batch([statement(FORECAST_SELECT, [month(periodMonth)])]);
    const row = result[0].results[0];
    return row ? forecastFrom(row) : null;
  }

  async function reserve(request: CostLedgerReservationRequest): Promise<CostLedgerReservation> {
    month(request.periodMonth);
    micro(request.amountMicro, "amountMicro", true);
    kind(request.kind);
    identity(request.idempotencyKey, "idempotencyKey");
    digest(request.requestDigest, "requestDigest");
    identity(request.provider, "provider"); identity(request.operation, "operation");
    identity(request.attemptIdentity, "attemptIdentity"); identity(request.quoteIdentity, "quoteIdentity");
    const expiry = timestamp(request.quoteExpiresAt, "quoteExpiresAt");
    identity(request.rateVersion, "rateVersion"); identity(request.fxVersion, "fxVersion"); identity(request.taxVersion, "taxVersion");
    digest(request.evidenceDigest, "evidenceDigest");
    const window = torontoMonthBoundary(request.periodMonth);

    const reservationId = `cost-reservation:${request.idempotencyKey}`;
    const insert = `INSERT INTO RevenueCostReservation
      (reservationId,idempotencyKey,requestDigest,periodMonth,amountMicro,kind,provider,operation,attemptIdentity,quoteIdentity,quoteExpiresAt,rateVersion,fxVersion,taxVersion,evidenceDigest)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
      WHERE EXISTS (SELECT 1 FROM RevenueCostBudgetPeriod p WHERE p.month=? AND p.startAt=? AND p.endAt=? AND julianday(p.startAt)<=julianday('now') AND julianday(p.endAt)>julianday('now') AND p.configured=1
        AND p.rateVersion=? AND p.fxVersion=? AND p.taxVersion=?)
        AND julianday(?)>julianday('now')
        AND (SELECT p.fixedCommitmentsMicro
          + COALESCE((SELECT SUM(s.actualMicro) FROM RevenueCostSettlement s JOIN RevenueCostReservation sr ON sr.reservationId=s.reservationId WHERE sr.periodMonth=p.month),0)
          + COALESCE((SELECT SUM(hr.amountMicro) FROM RevenueCostReservation hr WHERE hr.periodMonth=p.month AND NOT EXISTS(SELECT 1 FROM RevenueCostRelease x WHERE x.reservationId=hr.reservationId) AND NOT EXISTS(SELECT 1 FROM RevenueCostSettlement ss WHERE ss.reservationId=hr.reservationId)),0)
          FROM RevenueCostBudgetPeriod p WHERE p.month=?) + ? <=
          (SELECT CASE WHEN ?='DISCRETIONARY' THEN MIN(p.discretionaryStopMicro,p.capMicro-p.essentialReserveMicro) ELSE p.capMicro END FROM RevenueCostBudgetPeriod p WHERE p.month=?)
      ON CONFLICT(idempotencyKey) DO NOTHING`;
    const params: SqlValue[] = [reservationId, request.idempotencyKey, request.requestDigest, request.periodMonth, request.amountMicro, request.kind,
      request.provider, request.operation, request.attemptIdentity, request.quoteIdentity, expiry, request.rateVersion, request.fxVersion,
      request.taxVersion, request.evidenceDigest, request.periodMonth, window.startAt, window.endAt, request.rateVersion, request.fxVersion, request.taxVersion, expiry,
      request.periodMonth, request.amountMicro, request.kind, request.periodMonth];
    const admitted = await batch([
      statement(insert, params),
      statement(`SELECT reservationId,idempotencyKey,requestDigest,periodMonth,amountMicro,kind,provider,operation,attemptIdentity,quoteIdentity,quoteExpiresAt,rateVersion,fxVersion,taxVersion,evidenceDigest
        FROM RevenueCostReservation WHERE idempotencyKey=?`, [request.idempotencyKey]),
      statement(`SELECT 1 AS active FROM RevenueCostBudgetPeriod WHERE month=? AND startAt=? AND endAt=? AND julianday(startAt)<=julianday('now') AND julianday(endAt)>julianday('now') AND configured=1 AND rateVersion=? AND fxVersion=? AND taxVersion=?`,
        [request.periodMonth, window.startAt, window.endAt, request.rateVersion, request.fxVersion, request.taxVersion]),
      statement("SELECT julianday(?)>julianday('now') AS quoteActive", [expiry]),
      statement(FORECAST_SELECT, [request.periodMonth]),
    ]);
    const row = admitted[1].results[0];
    const beforeOrAfter = admitted[4].results[0] ? forecastFrom(admitted[4].results[0]) : undefined;
    if (row) {
      if (!sameRequest(row, request)) return fail("IDEMPOTENCY_CONFLICT");
      return { reservationId: stringField(row, "reservationId"), status: admitted[0].meta.changes === 1 ? "HELD" : "REPLAY_HELD_NO_AUTHORITY", forecast: beforeOrAfter };
    }
    if (!admitted[2].results[0]) return { reservationId, status: "DENIED_PERIOD", forecast: beforeOrAfter };
    if (Number(admitted[3].results[0]?.quoteActive) !== 1) return { reservationId, status: "DENIED_QUOTE", forecast: beforeOrAfter };
    return { reservationId, status: "DENIED_BUDGET", forecast: beforeOrAfter };
  }

  async function startAttempt(input: { reservationId: string; attemptId: string }): Promise<CostLedgerAttemptStart> {
    identity(input.reservationId, "reservationId");
    identity(input.attemptId, "attemptId");
    const monthRead = await batch([statement("SELECT periodMonth FROM RevenueCostReservation WHERE reservationId=?", [input.reservationId])]);
    const heldPeriod = monthRead[0].results[0];
    const window = heldPeriod ? torontoMonthBoundary(stringField(heldPeriod, "periodMonth")) : undefined;
    const result = await batch([
      statement(`INSERT INTO RevenueCostAttempt(attemptId,reservationId,state,startedAt)
        SELECT r.attemptIdentity,r.reservationId,'STARTED',CURRENT_TIMESTAMP FROM RevenueCostReservation r
        JOIN RevenueCostBudgetPeriod p ON p.month=r.periodMonth
        WHERE r.reservationId=? AND r.attemptIdentity=? AND p.startAt=? AND p.endAt=? AND p.configured=1
          AND julianday(p.startAt)<=julianday('now') AND julianday(p.endAt)>julianday('now')
          AND julianday(r.quoteExpiresAt)>julianday('now')
          AND NOT EXISTS(SELECT 1 FROM RevenueCostRelease x WHERE x.reservationId=r.reservationId)
          AND NOT EXISTS(SELECT 1 FROM RevenueCostSettlement s WHERE s.reservationId=r.reservationId)
        ON CONFLICT DO NOTHING`, [input.reservationId, input.attemptId, window?.startAt ?? "", window?.endAt ?? ""]),
      statement("SELECT attemptId,reservationId FROM RevenueCostAttempt WHERE attemptId=?", [input.attemptId]),
      statement("SELECT attemptId,reservationId FROM RevenueCostAttempt WHERE reservationId=?", [input.reservationId]),
    ]);
    const exact = result[1].results[0];
    if (result[0].meta.changes === 1 && exact && exact.reservationId === input.reservationId) {
      return { attemptId: input.attemptId, status: "STARTED", mayCallProvider: true };
    }
    if (exact) {
      if (exact.reservationId !== input.reservationId) return fail("ATTEMPT_IDENTITY_CONFLICT");
      return { attemptId: input.attemptId, status: "REPLAY_NO_AUTHORITY", mayCallProvider: false };
    }
    if (result[2].results[0]) return fail("ATTEMPT_IDENTITY_CONFLICT");
    return fail("ATTEMPT_NOT_ADMITTED");
  }

  async function markAttemptAmbiguous(attemptId: string): Promise<{ attemptId: string; state: "AMBIGUOUS"; replayed: boolean; historical: boolean }> {
    identity(attemptId, "attemptId");
    const result = await batch([
      statement(`INSERT INTO RevenueCostAttemptEvent(eventId,attemptId,state)
        SELECT ?,?,'AMBIGUOUS' WHERE EXISTS(SELECT 1 FROM RevenueCostAttempt WHERE attemptId=?)
          AND NOT EXISTS(SELECT 1 FROM RevenueCostSettlement WHERE attemptId=?)
        ON CONFLICT(eventId) DO NOTHING`, [`cost-event:${attemptId}:AMBIGUOUS`, attemptId, attemptId, attemptId]),
      statement("SELECT eventId,attemptId,state FROM RevenueCostAttemptEvent WHERE eventId=?", [`cost-event:${attemptId}:AMBIGUOUS`]),
      statement("SELECT 1 AS settled FROM RevenueCostSettlement WHERE attemptId=?", [attemptId]),
      statement("SELECT 1 AS existsAttempt FROM RevenueCostAttempt WHERE attemptId=?", [attemptId]),
    ]);
    const event = result[1].results[0];
    if (!event || event.attemptId !== attemptId || event.state !== "AMBIGUOUS") {
      if (result[2].results[0]) return fail("ATTEMPT_ALREADY_SETTLED");
      if (!result[3].results[0]) return fail("ATTEMPT_UNKNOWN");
      return fail("AMBIGUITY_NOT_ADMITTED");
    }
    return { attemptId, state: "AMBIGUOUS", replayed: result[0].meta.changes === 0, historical: Boolean(result[2].results[0]) };
  }

  async function release(input: { reservationId: string; releaseId: string; proof: string }): Promise<{ releaseId: string; status: "RELEASED" | "REPLAY_NO_AUTHORITY" }> {
    identity(input.reservationId, "reservationId"); identity(input.releaseId, "releaseId"); identity(input.proof, "proof", LIMITS.evidence);
    const result = await batch([
      statement(`INSERT INTO RevenueCostRelease(releaseId,reservationId,proof,releasedAt)
        SELECT ?,?, ?,CURRENT_TIMESTAMP WHERE EXISTS(SELECT 1 FROM RevenueCostReservation WHERE reservationId=?)
          AND NOT EXISTS(SELECT 1 FROM RevenueCostAttempt WHERE reservationId=?)
          AND NOT EXISTS(SELECT 1 FROM RevenueCostSettlement WHERE reservationId=?)
        ON CONFLICT DO NOTHING`, [input.releaseId, input.reservationId, input.proof, input.reservationId, input.reservationId, input.reservationId]),
      statement("SELECT releaseId,reservationId,proof FROM RevenueCostRelease WHERE releaseId=?", [input.releaseId]),
      statement("SELECT releaseId,reservationId,proof FROM RevenueCostRelease WHERE reservationId=?", [input.reservationId]),
      statement("SELECT reservationId FROM RevenueCostReservation WHERE reservationId=?", [input.reservationId]),
      statement("SELECT attemptId FROM RevenueCostAttempt WHERE reservationId=?", [input.reservationId]),
    ]);
    const release = result[1].results[0];
    if (release) {
      if (release.reservationId !== input.reservationId || release.proof !== input.proof) return fail("RELEASE_CONFLICT");
      return { releaseId: input.releaseId, status: result[0].meta.changes === 1 ? "RELEASED" : "REPLAY_NO_AUTHORITY" };
    }
    const existing = result[2].results[0];
    if (existing) return fail("RELEASE_CONFLICT");
    if (!result[3].results[0]) return fail("HOLD_UNKNOWN");
    if (result[4].results[0]) return fail("ATTEMPT_STARTED");
    return fail("RELEASE_NOT_ADMITTED");
  }

  async function settle(input: { settlementId: string; reservationId: string; attemptId: string; actualMicro: number; providerReceiptId: string; actualEvidenceDigest: string }): Promise<{ settlementId: string; actualMicro: number; status: "SETTLED" | "REPLAY_NO_AUTHORITY"; forecast?: CostLedgerForecast }> {
    identity(input.settlementId, "settlementId"); identity(input.reservationId, "reservationId"); identity(input.attemptId, "attemptId");
    micro(input.actualMicro, "actualMicro"); identity(input.providerReceiptId, "providerReceiptId"); digest(input.actualEvidenceDigest, "actualEvidenceDigest");
    const result = await batch([
      statement(`INSERT INTO RevenueCostSettlement(settlementId,reservationId,attemptId,actualMicro,providerReceiptId,actualEvidenceDigest)
        SELECT ?,?,?, ?,?,? WHERE EXISTS(SELECT 1 FROM RevenueCostAttempt a WHERE a.attemptId=? AND a.reservationId=?)
        ON CONFLICT DO NOTHING`, [input.settlementId, input.reservationId, input.attemptId, input.actualMicro, input.providerReceiptId,
        input.actualEvidenceDigest, input.attemptId, input.reservationId]),
      statement("SELECT settlementId,reservationId,attemptId,actualMicro,providerReceiptId,actualEvidenceDigest FROM RevenueCostSettlement WHERE settlementId=?", [input.settlementId]),
      statement("SELECT settlementId,reservationId,attemptId,actualMicro,providerReceiptId,actualEvidenceDigest FROM RevenueCostSettlement WHERE reservationId=?", [input.reservationId]),
      statement("SELECT attemptId,reservationId FROM RevenueCostAttempt WHERE attemptId=?", [input.attemptId]),
      statement("SELECT periodMonth FROM RevenueCostReservation WHERE reservationId=?", [input.reservationId]),
      statement(`SELECT p.month AS periodMonth,p.startAt,p.endAt,
          CASE WHEN julianday(p.startAt)<=julianday('now') AND julianday(p.endAt)>julianday('now') AND p.configured=1 THEN 1 ELSE 0 END AS active,
          p.capMicro,p.discretionaryStopMicro,p.warningMicro,p.essentialReserveMicro,p.fixedCommitmentsMicro,
          COALESCE((SELECT SUM(s.actualMicro) FROM RevenueCostSettlement s JOIN RevenueCostReservation r ON r.reservationId=s.reservationId WHERE r.periodMonth=p.month),0) AS settledActualMicro,
          COALESCE((SELECT SUM(r.amountMicro) FROM RevenueCostReservation r WHERE r.periodMonth=p.month AND NOT EXISTS(SELECT 1 FROM RevenueCostRelease x WHERE x.reservationId=r.reservationId) AND NOT EXISTS(SELECT 1 FROM RevenueCostSettlement s WHERE s.reservationId=r.reservationId)),0) AS unresolvedHoldsMicro,
          p.rateVersion,p.fxVersion,p.taxVersion FROM RevenueCostBudgetPeriod p WHERE p.month=(SELECT periodMonth FROM RevenueCostReservation WHERE reservationId=?)`, [input.reservationId]),
    ]);
    const row = result[1].results[0];
    const reservationSettlement = result[2].results[0];
    if (!row) {
      if (reservationSettlement) return fail("SETTLEMENT_CONFLICT");
      if (!result[3].results[0] || result[3].results[0].reservationId !== input.reservationId) return fail("ATTEMPT_UNKNOWN");
      return fail("SETTLEMENT_NOT_RECORDED");
    }
    if (row.reservationId !== input.reservationId || row.attemptId !== input.attemptId || numberField(row, "actualMicro") !== input.actualMicro || row.providerReceiptId !== input.providerReceiptId || row.actualEvidenceDigest !== input.actualEvidenceDigest) {
      return fail("SETTLEMENT_CONFLICT");
    }
    const forecastRow = result[5].results[0];
    const forecastData = forecastRow ? forecastFrom(forecastRow) : undefined;
    return { settlementId: input.settlementId, actualMicro: input.actualMicro, status: result[0].meta.changes === 1 ? "SETTLED" : "REPLAY_NO_AUTHORITY", forecast: forecastData };
  }

  return { reserve, startAttempt, markAttemptAmbiguous, release, settle, getForecast: forecast, getStatus: forecast, reload: forecast };
}
