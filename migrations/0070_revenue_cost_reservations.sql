-- Provider-independent, append-only CAD micro-unit cost ledger. It grants no
-- provider, queue, mail, browser, deployment, or spend authority.
CREATE TABLE RevenueCostBudgetPeriod (
  month TEXT PRIMARY KEY,
  startAt TEXT NOT NULL,
  endAt TEXT NOT NULL,
  capMicro INTEGER NOT NULL,
  discretionaryStopMicro INTEGER NOT NULL,
  warningMicro INTEGER NOT NULL,
  essentialReserveMicro INTEGER NOT NULL DEFAULT 0,
  fixedCommitmentsMicro INTEGER NOT NULL DEFAULT 0,
  configDigest TEXT NOT NULL,
  rateVersion TEXT NOT NULL,
  fxVersion TEXT NOT NULL,
  taxVersion TEXT NOT NULL,
  configured INTEGER NOT NULL DEFAULT 1,
  CHECK (month GLOB '????-??' AND length(month)=7 AND substr(month,5,1)='-' AND month NOT GLOB '*[^0-9-]*' AND CAST(substr(month,6,2) AS INTEGER) BETWEEN 1 AND 12),
  CHECK (julianday(startAt) IS NOT NULL AND julianday(endAt) IS NOT NULL AND julianday(endAt) > julianday(startAt)),
  CHECK (strftime('%Y-%m',startAt)=month AND strftime('%d',startAt)='01'
    AND strftime('%H',startAt) IN ('04','05') AND strftime('%M:%f',startAt)='00:00.000'
    AND strftime('%d',endAt)='01' AND strftime('%H',endAt) IN ('04','05')
    AND strftime('%M:%f',endAt)='00:00.000' AND date(endAt)=date(startAt,'+1 month')),
  CHECK (typeof(capMicro)='integer' AND typeof(discretionaryStopMicro)='integer' AND typeof(warningMicro)='integer' AND typeof(essentialReserveMicro)='integer' AND typeof(fixedCommitmentsMicro)='integer'),
  CHECK (capMicro >= 0 AND discretionaryStopMicro >= 0 AND warningMicro >= 0 AND essentialReserveMicro >= 0 AND fixedCommitmentsMicro >= 0),
  CHECK (capMicro <= 9223372036854775807 AND discretionaryStopMicro <= 9223372036854775807 AND warningMicro <= 9223372036854775807 AND essentialReserveMicro <= 50000000 AND fixedCommitmentsMicro <= 50000000),
  CHECK (discretionaryStopMicro <= capMicro AND warningMicro <= discretionaryStopMicro),
  CHECK (fixedCommitmentsMicro + essentialReserveMicro <= capMicro),
  CHECK (capMicro = 50000000),
  CHECK (discretionaryStopMicro = 42500000),
  CHECK (warningMicro = 35000000),
  CHECK (length(configDigest)=64 AND configDigest NOT GLOB '*[^0-9a-f]*'),
  CHECK (configured=1)
);

CREATE TABLE RevenueCostReservation (
  reservationId TEXT PRIMARY KEY,
  idempotencyKey TEXT NOT NULL UNIQUE,
  requestDigest TEXT NOT NULL,
  periodMonth TEXT NOT NULL REFERENCES RevenueCostBudgetPeriod(month) ON DELETE RESTRICT,
  amountMicro INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ESSENTIAL','DISCRETIONARY')),
  provider TEXT NOT NULL, operation TEXT NOT NULL, attemptIdentity TEXT NOT NULL,
  quoteIdentity TEXT NOT NULL, quoteExpiresAt TEXT NOT NULL,
  rateVersion TEXT NOT NULL, fxVersion TEXT NOT NULL, taxVersion TEXT NOT NULL,
  evidenceDigest TEXT NOT NULL, createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (typeof(amountMicro)='integer' AND amountMicro > 0 AND amountMicro <= 50000000), CHECK (julianday(quoteExpiresAt) IS NOT NULL), CHECK (length(requestDigest)=64 AND requestDigest NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(evidenceDigest)=64 AND evidenceDigest NOT GLOB '*[^0-9a-f]*')
);

CREATE TABLE RevenueCostAttempt (
  attemptId TEXT PRIMARY KEY, reservationId TEXT NOT NULL UNIQUE REFERENCES RevenueCostReservation(reservationId) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (state IN ('STARTED','RESOLVED','AMBIGUOUS')),
  startedAt TEXT NOT NULL, resolvedAt TEXT
);
CREATE TABLE RevenueCostAttemptEvent (
  eventId TEXT PRIMARY KEY, attemptId TEXT NOT NULL REFERENCES RevenueCostAttempt(attemptId) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (state IN ('RESOLVED','AMBIGUOUS')), recordedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE RevenueCostRelease (
  releaseId TEXT PRIMARY KEY, reservationId TEXT NOT NULL UNIQUE REFERENCES RevenueCostReservation(reservationId) ON DELETE RESTRICT,
  proof TEXT NOT NULL, releasedAt TEXT NOT NULL
);
CREATE TABLE RevenueCostSettlement (
  settlementId TEXT PRIMARY KEY, reservationId TEXT NOT NULL REFERENCES RevenueCostReservation(reservationId) ON DELETE RESTRICT,
  attemptId TEXT NOT NULL REFERENCES RevenueCostAttempt(attemptId) ON DELETE RESTRICT,
  actualMicro INTEGER NOT NULL, providerReceiptId TEXT NOT NULL, actualEvidenceDigest TEXT NOT NULL,
  settledAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (typeof(actualMicro)='integer' AND actualMicro >= 0 AND actualMicro <= 9223372036854775807), CHECK (length(actualEvidenceDigest)=64 AND actualEvidenceDigest NOT GLOB '*[^0-9a-f]*'),
  UNIQUE (reservationId), UNIQUE (providerReceiptId)
);

CREATE INDEX RevenueCostReservation_period_idx ON RevenueCostReservation(periodMonth);
CREATE INDEX RevenueCostAttempt_reservation_idx ON RevenueCostAttempt(reservationId);

CREATE TRIGGER RevenueCostBudgetPeriod_no_overlap BEFORE INSERT ON RevenueCostBudgetPeriod
WHEN EXISTS (SELECT 1 FROM RevenueCostBudgetPeriod p WHERE julianday(NEW.startAt) < julianday(p.endAt) AND julianday(NEW.endAt) > julianday(p.startAt))
BEGIN SELECT RAISE(ABORT,'OVERLAPPING_COST_PERIOD'); END;

CREATE TRIGGER RevenueCostReservation_period_guard BEFORE INSERT ON RevenueCostReservation
WHEN NOT EXISTS (SELECT 1 FROM RevenueCostBudgetPeriod p
  WHERE p.month=NEW.periodMonth AND p.configured=1
    AND julianday(p.startAt) <= julianday('now') AND julianday(p.endAt) > julianday('now'))
BEGIN SELECT RAISE(ABORT,'COST_PERIOD_INACTIVE'); END;

CREATE TRIGGER RevenueCostReservation_quote_guard BEFORE INSERT ON RevenueCostReservation
WHEN EXISTS (SELECT 1 FROM RevenueCostBudgetPeriod p
  WHERE p.month=NEW.periodMonth AND p.configured=1
    AND julianday(p.startAt) <= julianday('now') AND julianday(p.endAt) > julianday('now'))
  AND (julianday(NEW.quoteExpiresAt) IS NULL OR julianday(NEW.quoteExpiresAt) <= julianday('now'))
BEGIN SELECT RAISE(ABORT,'COST_QUOTE_EXPIRED'); END;

CREATE TRIGGER RevenueCostReservation_config_guard BEFORE INSERT ON RevenueCostReservation
WHEN EXISTS (SELECT 1 FROM RevenueCostBudgetPeriod p
  WHERE p.month=NEW.periodMonth AND p.configured=1
    AND julianday(p.startAt) <= julianday('now') AND julianday(p.endAt) > julianday('now'))
  AND julianday(NEW.quoteExpiresAt) > julianday('now')
  AND NOT EXISTS (SELECT 1 FROM RevenueCostBudgetPeriod p
    WHERE p.month=NEW.periodMonth AND p.configured=1
      AND p.rateVersion=NEW.rateVersion AND p.fxVersion=NEW.fxVersion AND p.taxVersion=NEW.taxVersion)
BEGIN SELECT RAISE(ABORT,'COST_CONFIG_MISMATCH'); END;

-- All CAD arithmetic is integer micro-units. The forecast includes configured
-- fixed commitments, every settled actual (including overruns), and every
-- reservation that has neither been released nor settled.
CREATE TRIGGER RevenueCostReservation_budget_guard BEFORE INSERT ON RevenueCostReservation
WHEN EXISTS (SELECT 1 FROM RevenueCostBudgetPeriod p
  WHERE p.month=NEW.periodMonth AND p.configured=1
    AND julianday(p.startAt) <= julianday('now') AND julianday(p.endAt) > julianday('now'))
  AND julianday(NEW.quoteExpiresAt) > julianday('now')
  AND EXISTS (SELECT 1 FROM RevenueCostBudgetPeriod p
    WHERE p.month=NEW.periodMonth AND p.configured=1
      AND p.rateVersion=NEW.rateVersion AND p.fxVersion=NEW.fxVersion AND p.taxVersion=NEW.taxVersion)
  AND COALESCE((SELECT p.fixedCommitmentsMicro FROM RevenueCostBudgetPeriod p WHERE p.month=NEW.periodMonth),0)
  + COALESCE((SELECT SUM(s.actualMicro) FROM RevenueCostSettlement s JOIN RevenueCostReservation r ON r.reservationId=s.reservationId WHERE r.periodMonth=NEW.periodMonth),0)
  + COALESCE((SELECT SUM(r.amountMicro) FROM RevenueCostReservation r WHERE r.periodMonth=NEW.periodMonth
    AND NOT EXISTS (SELECT 1 FROM RevenueCostRelease x WHERE x.reservationId=r.reservationId)
    AND NOT EXISTS (SELECT 1 FROM RevenueCostSettlement s WHERE s.reservationId=r.reservationId)),0)
  + NEW.amountMicro
  > COALESCE((SELECT CASE WHEN NEW.kind='DISCRETIONARY' THEN
                    CASE WHEN p.discretionaryStopMicro < p.capMicro-p.essentialReserveMicro
                         THEN p.discretionaryStopMicro ELSE p.capMicro-p.essentialReserveMicro END
                  ELSE p.capMicro END
              FROM RevenueCostBudgetPeriod p WHERE p.month=NEW.periodMonth),0)
BEGIN SELECT RAISE(ABORT,'COST_BUDGET_EXCEEDED'); END;

CREATE TRIGGER RevenueCostBudgetPeriod_no_update BEFORE UPDATE ON RevenueCostBudgetPeriod BEGIN SELECT RAISE(ABORT,'IMMUTABLE_COST_LEDGER'); END;
CREATE TRIGGER RevenueCostBudgetPeriod_no_delete BEFORE DELETE ON RevenueCostBudgetPeriod BEGIN SELECT RAISE(ABORT,'IMMUTABLE_COST_LEDGER'); END;
CREATE TRIGGER RevenueCostReservation_no_update BEFORE UPDATE ON RevenueCostReservation BEGIN SELECT RAISE(ABORT,'IMMUTABLE_COST_LEDGER'); END;
CREATE TRIGGER RevenueCostReservation_no_delete BEFORE DELETE ON RevenueCostReservation BEGIN SELECT RAISE(ABORT,'IMMUTABLE_COST_LEDGER'); END;
CREATE TRIGGER RevenueCostAttempt_no_update BEFORE UPDATE ON RevenueCostAttempt BEGIN SELECT RAISE(ABORT,'IMMUTABLE_COST_LEDGER'); END;
CREATE TRIGGER RevenueCostAttempt_no_delete BEFORE DELETE ON RevenueCostAttempt BEGIN SELECT RAISE(ABORT,'IMMUTABLE_COST_LEDGER'); END;
CREATE TRIGGER RevenueCostAttemptEvent_no_update BEFORE UPDATE ON RevenueCostAttemptEvent BEGIN SELECT RAISE(ABORT,'IMMUTABLE_COST_LEDGER'); END;
CREATE TRIGGER RevenueCostAttemptEvent_no_delete BEFORE DELETE ON RevenueCostAttemptEvent BEGIN SELECT RAISE(ABORT,'IMMUTABLE_COST_LEDGER'); END;
CREATE TRIGGER RevenueCostRelease_no_update BEFORE UPDATE ON RevenueCostRelease BEGIN SELECT RAISE(ABORT,'IMMUTABLE_COST_LEDGER'); END;
CREATE TRIGGER RevenueCostRelease_no_delete BEFORE DELETE ON RevenueCostRelease BEGIN SELECT RAISE(ABORT,'IMMUTABLE_COST_LEDGER'); END;
CREATE TRIGGER RevenueCostSettlement_no_update BEFORE UPDATE ON RevenueCostSettlement BEGIN SELECT RAISE(ABORT,'IMMUTABLE_COST_LEDGER'); END;
CREATE TRIGGER RevenueCostSettlement_no_delete BEFORE DELETE ON RevenueCostSettlement BEGIN SELECT RAISE(ABORT,'IMMUTABLE_COST_LEDGER'); END;

CREATE TRIGGER RevenueCostAttempt_reservation_guard BEFORE INSERT ON RevenueCostAttempt
WHEN NOT EXISTS (SELECT 1 FROM RevenueCostReservation r WHERE r.reservationId=NEW.reservationId)
BEGIN SELECT RAISE(ABORT,'ATTEMPT_RESERVATION_MISSING'); END;
CREATE TRIGGER RevenueCostAttempt_identity_guard BEFORE INSERT ON RevenueCostAttempt
WHEN NOT EXISTS (SELECT 1 FROM RevenueCostReservation r WHERE r.reservationId=NEW.reservationId AND r.attemptIdentity=NEW.attemptId)
BEGIN SELECT RAISE(ABORT,'ATTEMPT_IDENTITY_MISMATCH'); END;
CREATE TRIGGER RevenueCostAttempt_window_guard BEFORE INSERT ON RevenueCostAttempt
WHEN EXISTS (SELECT 1 FROM RevenueCostReservation r WHERE r.reservationId=NEW.reservationId)
  AND NOT EXISTS (SELECT 1 FROM RevenueCostReservation r JOIN RevenueCostBudgetPeriod p ON p.month=r.periodMonth
    WHERE r.reservationId=NEW.reservationId AND p.configured=1
      AND julianday(p.startAt) <= julianday('now') AND julianday(p.endAt) > julianday('now')
      AND julianday(r.quoteExpiresAt) > julianday('now'))
BEGIN SELECT RAISE(ABORT,'ATTEMPT_NOT_ADMITTED'); END;
CREATE TRIGGER RevenueCostAttempt_after_release BEFORE INSERT ON RevenueCostAttempt
WHEN EXISTS (SELECT 1 FROM RevenueCostRelease WHERE reservationId=NEW.reservationId)
BEGIN SELECT RAISE(ABORT,'ATTEMPT_AFTER_RELEASE'); END;
CREATE TRIGGER RevenueCostAttempt_after_settlement BEFORE INSERT ON RevenueCostAttempt
WHEN EXISTS (SELECT 1 FROM RevenueCostSettlement WHERE reservationId=NEW.reservationId)
BEGIN SELECT RAISE(ABORT,'ATTEMPT_AFTER_SETTLEMENT'); END;

CREATE TRIGGER RevenueCostAttemptEvent_attempt_guard BEFORE INSERT ON RevenueCostAttemptEvent
WHEN NEW.state='AMBIGUOUS' AND NOT EXISTS (SELECT 1 FROM RevenueCostAttempt WHERE attemptId=NEW.attemptId)
BEGIN SELECT RAISE(ABORT,'AMBIGUOUS_ATTEMPT_REQUIRED'); END;

CREATE TRIGGER RevenueCostRelease_no_attempt BEFORE INSERT ON RevenueCostRelease
WHEN EXISTS (SELECT 1 FROM RevenueCostAttempt WHERE reservationId=NEW.reservationId)
BEGIN SELECT RAISE(ABORT,'ATTEMPT_STARTED'); END;
CREATE TRIGGER RevenueCostRelease_after_settlement BEFORE INSERT ON RevenueCostRelease
WHEN EXISTS (SELECT 1 FROM RevenueCostSettlement WHERE reservationId=NEW.reservationId)
BEGIN SELECT RAISE(ABORT,'RELEASE_AFTER_SETTLEMENT'); END;

CREATE TRIGGER RevenueCostSettlement_attempt_match BEFORE INSERT ON RevenueCostSettlement
WHEN NOT EXISTS (SELECT 1 FROM RevenueCostAttempt WHERE attemptId=NEW.attemptId AND reservationId=NEW.reservationId)
BEGIN SELECT RAISE(ABORT,'ATTEMPT_MISMATCH'); END;
CREATE TRIGGER RevenueCostSettlement_released BEFORE INSERT ON RevenueCostSettlement
WHEN EXISTS (SELECT 1 FROM RevenueCostRelease WHERE reservationId=NEW.reservationId)
BEGIN SELECT RAISE(ABORT,'SETTLEMENT_AFTER_RELEASE'); END;
