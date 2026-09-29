# ADR 0016 — End evidence uses and project current reference lineage

- Status: accepted
- Date: 2026-08-24

## Context

Migration 0056 records immutable evidence uses and links promoted manifests to
those uses. It deliberately had no way to say that the business-record purpose
for a use ended. Treating every historical link as active forever would prevent
retention review. Treating an old release review or a missing link as proof that
an artifact is unreferenced could erase legitimate qualification, outreach,
consent, touch, or legal evidence.

One use can also appear in several successive copies. For example, qualification
evidence can be copied to outreach retention and later to legal hold. The newest
or strongest copy is not automatically the current protecting copy. After a
legal hold ends, a still-active outreach use should select the valid outreach
copy, leaving the legal copy eligible for a separate review.

## Decision

Add migration `0058_artifact_reference_projections.sql`, a deterministic
fixture-only lineage projector, and a validation-only persistence planner.

### Evidence-use endings

`RevenueArtifactEvidenceUseEnd` is one immutable end fact for one exact use
version. It binds the original use digest, effective and recording times,
versioned reason and basis, actor and role, and canonical digest/JSON. A
replacement also binds the replacement use ID, record version, and digest. The
persistence bundle must carry both exact use records so business, time, identity,
and version can be rechecked. A use cannot end twice or reopen. Revival requires
a new evidence-use identity.

- Normal retention completion requires an owner/compliance review basis.
- Replacement requires the exact replacement use and cannot cross businesses or
  postdate the ending.
- Legal hold can end only with a versioned legal-clearance basis recorded by the
  compliance role.
- Ending a use never authorizes release, object deletion, or a provider call.

An existing `ArtifactReleaseRecord` cannot end a use. That record is a historical
review of one protected manifest and a caller-supplied use set; it does not prove
that the underlying business-record purpose ended everywhere.

### Fixture-asserted reference snapshots

`RevenueArtifactReferenceProjection` is an immutable, time-bounded snapshot for
one promotion lineage. Its source digest binds the workflow/business identity,
explicit evidence-use set, every supplied manifest, promotion plan/receipt,
manifest-use link, use ending, availability fact, and source count.

This checkpoint has no transactional D1 loader. Its fixture helper therefore
records `FIXTURE_ASSERTED`, keeps `snapshotComplete=false`, and cannot mint a
completeness receipt. Even when every asserted use has ended, the projection is
`INDETERMINATE` and cannot suggest retention review. Only a later atomic loader
may introduce transactionally complete snapshots and the
`NO_CURRENT_REFERENCES` conclusion.

Only completed promotion receipts create lineage edges. A no-copy receipt is a
use-link event, not a cycle. The root must be `SHADOW_30D`, have `ARTIFACT_WRITE`
provenance, and match its write receipt identity; every promoted manifest must
have its exact completed promotion and ancestor chain. Every completed promotion
use needs its exact result-manifest link and every link/use must agree with the
explicit use set. Failed promotions,
disconnected manifests, cross-workflow/business data, retention decreases,
divergent manifests, missing promotion/use pairs, stale snapshots, and incomplete
availability fail closed.

Fixture freshness is capped at five minutes. Availability receipts bind all of
their fields by digest and must remain valid through the projection window. All
manifest, promotion, use, link, ending, and availability timestamps must be no
later than the asserted snapshot, and availability cannot predate its manifest.
Currentness cannot begin before `projectedAt` and deterministically reproduces the
full projection; a merely redigested assignment is a conflict.

For each active use, the projector selects the weakest verified-present,
unexpired linked manifest whose retention satisfies the policy:

| Evidence use | Minimum protecting copy |
|---|---|
| Qualification snapshot | `QUALIFICATION_180D` |
| Approval, consent, or outreach touch | `OUTREACH_ACTIVE` |
| Legal hold | `LEGAL_HOLD` |

Equal minimum-rank candidates remain visible as ambiguous. A missing valid
candidate remains unassigned. Either condition makes the whole projection
`INDETERMINATE`; it cannot produce `NO_CURRENT_REFERENCES`. Stronger historical
manifests are never rewritten or demoted.

Projection uses and assignments are normalized in
`RevenueArtifactReferenceProjectionUse` and
`RevenueArtifactReferenceProjectionAssignment`. The exact asserted source and
projection also remain canonical JSON with SHA-256 digests.

### No destructive authority

Fixture projections cannot produce `NO_CURRENT_REFERENCES`. Every ending,
projection, currentness result, and persistence plan fixes retention conclusion,
release, deletion, provider-delete, provider-operation, and cost authority to
zero/false. A later retention review must recompute and compare a transactionally
complete source digest inside one fresh atomic database read. Provider deletion
remains a separate explicit release gate.

The persistence planner uses collision-complete preflights with no `LIMIT 1`.
It checks primary and alternate identities, rejects multiple matches, emits only
ordered insert-if-absent SQL artifacts, and has no D1 client or executor.

Migration 0058 is additive and is tested only against isolated local SQLite/D1
stores in this checkpoint. It is not applied to staging or production.

## Options considered

| Option | Benefit | Rejected cost or risk |
|---|---|---|
| Boolean `active` on the use row | Simple query | Erases history and makes retries/actors/basis unverifiable |
| Count every unended manifest link | Easy reference count | Keeps every older promoted copy active forever |
| Assign only the strongest/latest manifest | Simple selection | Prevents safe fallback and retains expensive legal copies unnecessarily |
| Mutable current-reference counter | Cheap read | Drifts under retries, late facts, and deployment interruption |
| Fixture-asserted projection now; transactionally complete loader later | Auditable, replayable, and honest about current proof | More explicit records and loader work; selected |

## Consequences

- Retention review can distinguish ended purposes from active uses without
  mutating historical evidence.
- The engine can explain which exact manifest currently protects each use and
  why an older or stronger copy is unassigned.
- Ambiguous, missing, stale, fixture-asserted, or incomplete evidence increases
  protection by blocking a zero-reference conclusion.
- The projection is not a live materialized counter. A future loader must
  reproduce a complete transaction snapshot and compare its digest before using
  the result in any retention review.
- No Cloudflare binding, D1/R2 executor, provider operation, lifecycle rule, or
  production mutation is introduced.

## Follow-up

1. Specify atomic D1 snapshot loading, fence acquisition, insert-if-absent
   execution, and post-verification without yet authorizing an executor.
2. Design a separate owner/compliance retention-review UI and release gate that
   always recomputes a fresh current-reference snapshot.
3. Keep Browser, R2, Workflow, and provider adapters behind their own staging,
   budget, rollback, and approval gates.
