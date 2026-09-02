# Owner-Dossier Progress Append Design

**Status:** Approved by ADR 0044's next action and the persisted rebuild plan.

**Date:** 2026-09-01

## Outcome

Advance one exact trusted `OWNER_DOSSIER` input to one deeply frozen in-memory
shadow-progress checkpoint. The boundary must prove that exactly one selected
business moved from `CONTACT_REVIEW_PERSISTED` to
`OWNER_DOSSIER_ACCEPTED`, while every earlier receipt and every unrelated
business stayed unchanged.

This milestone does not authenticate Riley or Aidan, persist an owner decision,
write a progress file or database row, add an operator or UI action, use real
business data, connect a provider, deploy, contact a prospect, or spend money.

## Trust model

The existing owner-dossier adapter privately registers one exact frozen phase
input and binds it to the complete content-addressed contact-review parent. The
generic progress appender validates strict schemas and deterministic phase order,
but it cannot know that the input came from that exact in-process trust boundary.

The guarded append will therefore:

1. Require the exact owner-dossier input through
   `requireInProcessPrivateKwOwnerDossierProgressInputForParent`.
2. Require the content-equivalent manifest and exact parent ID/digest used when
   the input was derived.
3. Build the expected canonical phase receipt and delegate the deterministic
   transition to `appendPrivateKwShadowSliceProgress`.
4. Independently prove the complete one-business final transition.
5. Deep-freeze and privately register only the verified result.
6. Cache the result by exact input plus parent identity so an identical retry
   returns the same checkpoint object and a different parent fails closed.

Schema-valid copies of the input or result are not trusted. After process loss,
the bounded dossier read, proof construction, input derivation, and append must
be repeated against the current persisted parent rather than trusting saved JSON.

## Final-phase invariants

The append succeeds only when all of these are true:

- progress version, manifest, slice, source-plan, and zero-authority policy are
  unchanged;
- the result names the exact contact-review parent and uses the trusted input's
  recorded time;
- total phase receipts and fully completed businesses each increase by one;
- `CONTACT_REVIEW_PERSISTED` decreases by one and
  `OWNER_DOSSIER_ACCEPTED` increases by one;
- all other checkpoint counts remain unchanged;
- `nextIncompleteBusinessId` equals the first still-incomplete record in the
  canonical parent order after excluding the newly completed target, or `null`
  if the cohort is complete;
- the selected record remains at the same index, preserves its manifest-bound
  business/evaluation/source identity and exact four-receipt prefix, gains only
  the expected canonical owner-dossier receipt, ends
  at `OWNER_DOSSIER_ACCEPTED`, and has no next gate; and
- the other nine records are canonically unchanged.

The next-incomplete pointer is deliberately derived from the parent rather than
assumed unchanged. Completing the first incomplete business can legitimately
move that pointer; completing another business must not.

## Failure behavior

Fail closed on copied inputs, copied result trust, another manifest, any changed
or re-digested parent, an already-completed child, wrong phase, wrong canonical
receipt, altered summary, altered authority, changed unrelated record, or
attempted replay against another parent.

The boundary has no fallback, rebase, repair, serialization, or durable-output
path.

## Components

1. `private-kw-owner-dossier-progress-append.ts` owns exact checkpoint trust,
   exact retry caching, canonical append delegation, and independent final-state
   verification.
2. `private-kw-owner-dossier-progress.test.ts` proves success, both pointer
   movement and pointer stability, deep freeze, exact retry, clone rejection,
   manifest/parent drift, and completed-child replay.
3. `scripts/check-safety-config.mjs` requires the trust and transition checks and
   forbids operator, Worker, UI/API, file, database, runtime, provider, network,
   mutation, real-data, deployment, outreach, send, and cost wiring.
4. ADR 0045 records why the append remains separate from authentication, durable
   owner-decision storage, and operator/UI work.

## Verification

- Run the existing owner-dossier tests first to establish the green baseline.
- Add append imports and tests before the module exists; require the focused run
  to fail for the missing module/export.
- Implement the minimal boundary and require the focused tests to pass.
- Run fail-closed safety, the complete test suite, typecheck, lint, the sanitized
  Cloudflare build, the explicit no-upload Wrangler dry run, and only then the
  six-view owner UI browser gate.
- Review every changed file, staged secret safety, remote branch position, and
  local/remote equality before and after the atomic push.

## Alternatives rejected

### Call the generic progress appender directly

Smallest code change, but a copied schema-valid phase input would discard the
exact reader/proof/input provenance established by ADR 0044.

### Append inside the owner-dossier proof or input builder

Preserves provenance, but couples current dossier validation to state transition
and makes it harder to prove that proof construction itself has no advancement
authority.

### Persist owner acceptance and progress now

Would provide resume convenience, but would mix session authentication, owner
identity, durable decision storage, progress mutation, and operator/UI authority
before those boundaries have their own threat model and approval.

### Separate exact-parent in-memory append

Selected. It completes the synthetic five-phase integration contract while
keeping every durable and operational authority explicit and absent.
