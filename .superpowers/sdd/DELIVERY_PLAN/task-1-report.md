# Task 1 report — restore a trustworthy green unit-test baseline

## Result

The tracked decoder fixture now derives the `SHADOW_30D` object expiry from the
supplied `timing.availabilityValidThrough` value. This keeps the fixture clock
coherent with its availability check while leaving production expiry and
freshness validation unchanged. The dedicated expired-plan test remains
explicit and still constructs an expired plan from the real clock.

## TDD evidence

- RED command: `npx tsx --test src/lib/revenue-engine/artifact-reference-d1-source-decoder.test.ts`
- RED result: 26 tests, 4 passed, 22 failed. Every failure was the expected
  `A recorded object expiry must be later than the availability check.` error at
  the hard-coded `2026-09-20T00:00:00.000Z` fixture expiry.
- GREEN focused command: `npx tsx --test src/lib/revenue-engine/artifact-reference-d1-source-decoder.test.ts`
- GREEN focused result: 26 tests, 26 passed, 0 failed.
- GREEN full command: `npm test`
- GREEN full result: 488 tests, 488 passed, 0 failed.

## Files and commit

- Changed source: `src/lib/revenue-engine/artifact-reference-d1-source-decoder.test.ts`
- Required report: `.superpowers/sdd/DELIVERY_PLAN/task-1-report.md`
- Task 1 implementation commit: `67a8eb3b489f92ca2707d785c3a1c3f0c0fe8768`
- The copied untracked assessment-progress files were not touched or staged.

## Self-review and concerns

The one-line test-only change is minimal, uses an existing supplied timing field,
and applies only to the normal persisted fixture path. The explicit expired
history/plan assertions remain intact. No production files, expiry rules,
database code, or validation thresholds changed. No concerns remain for this
task; owner-UI verification and the preexisting untracked assessment files are
outside Task 1 scope.
