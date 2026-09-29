# ADR 0034 — Bind staging console release packets without deploy authority

**Status:** Accepted
**Date:** 2026-08-28
**Deciders:** Riley Hinsperger and the Revenue Engine integration owner

## Context

The owner-first Leads list, evidence dossier, and Quality Lab are verified
locally, but publishing them changes the isolated staging Worker. A branch name,
chat approval, screenshot, or green-looking UI is not enough to identify what
would change, which resources it would bind, or how to roll it back.

The staging packet must remain useful after a Codex task ends without quietly
becoming permission to deploy, migrate, use providers, or process real leads.

## Decision

Create a committed, content-addressed JSON release packet for each staging
console candidate. The packet binds:

- the exact candidate commit, tree, parent, and scoped source blob identities;
- the Leads list, evidence dossier, Quality Lab, and their three private APIs;
- the isolated staging Worker URL, D1 identity, Browser/assets bindings, expected
  auth-secret name, and absence of services, queues, crons, and provider secrets;
- the exact local release commands and owner-browser results;
- explicit pending Linux CI and staging smoke gates;
- the currently deployed staging version and exact rollback action; and
- an all-false/zero authority block plus a pending owner approval.

A local verifier checks the packet digest and every Git object using argument-safe
`git` subprocess calls. It performs no network or deployment operation.

## Consequences

- Another task can identify and verify the precise staging candidate without
  reconstructing terminal history.
- The packet cannot authorize its own deployment. Owner approval must bind its
  exact digest in a later, separate release gate.
- The packet does not approve a remote migration, R2, the engine Worker,
  providers, real-business data, mailbox work, prospect contact, or spend.
- Post-deploy authentication, route, zero-activity, and rollback checks remain
  impossible until deployment is separately approved and performed.

## Action items

1. [x] Add the strict packet contract, digest, scoped Git verifier, and tests.
2. [x] Assemble the first Quality Lab staging candidate packet.
3. [x] Record exact Linux CI evidence against the candidate: run
   `33221735787` passed on packet commit
   `c201122446439914517ea0ec4ce06a94b9cdf8fd`.
4. [ ] Obtain a separate owner approval bound to the exact packet digest.
5. [ ] Deploy only the console to isolated staging and perform synthetic smoke
   and rollback-readiness checks.
