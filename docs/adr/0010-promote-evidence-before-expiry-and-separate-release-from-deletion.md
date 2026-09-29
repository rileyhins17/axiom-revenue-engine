# ADR 0010 — Promote evidence before expiry and separate release from deletion

- Status: accepted
- Date: 2026-08-22

## Decision

Represent an artifact's verified storage location with an `ArtifactManifest`
derived only from a completed write or promotion receipt. Keep the public domain
reference content-addressed as `artifact:sha256:<digest>` while storage retention
is represented by the object-key prefix and validated metadata.

Bind every retention requirement to an `ArtifactEvidenceUse`:

| Evidence use | Minimum retention |
|---|---|
| Qualification snapshot | `QUALIFICATION_180D` |
| Outreach approval, consent evidence, or outreach touch | `OUTREACH_ACTIVE` |
| Legal hold | `LEGAL_HOLD` |

Promotion is monotonic. A source is copied only when its current class is weaker
than the strongest listed use; already sufficient protection returns a no-copy
receipt. Copies are create-if-absent. Source identity and an existing or newly
created target must match object key, length, digest, media type, storage class,
private cache policy, contract metadata, kind, retention class, ETag, and source
upload time where applicable. Partial copies are not rollback-deleted.

An `ArtifactReleaseRecord` is a separate immutable decision. It binds the exact
protected manifest, every evidence use reviewed, actor and role, decision time,
class-specific reason, rationale, and canonical decision digest. Approval needs
an exact confirmation. The record always keeps provider delete authority off,
records no deletion, and requires both a fresh reference check and another
explicit deletion release gate in the future.

Version 1 accepts only fixture stores, shadow mode, and a zero-dollar budget. It
has no Cloudflare import, R2 binding, provider copy/delete operation, D1 write, or
production path.

## Why

Lifecycle expiry can erase legitimate proof if a 30-day shadow screenshot later
supports qualification, contact consent, an approved message, or a dispute.
Keeping everything forever is also wrong: it increases privacy risk, storage
clutter, and operating uncertainty. Explicit use records let protection grow only
when the business has a real reason.

The artifact reference must not change when evidence is promoted. A claim points
to content, while a manifest tells the system where a currently protected copy
exists. This avoids rewriting every historical claim and makes duplicate bytes
safe to reuse.

A human release decision is necessary but not sufficient for deletion. References
can change after the review, and a legal/commercial record may still depend on the
object. Separating the decision from the destructive provider operation ensures a
future executor must check current state at the last possible moment.

## Consequences

- Shadow evidence must be promoted before its lifecycle deadline when it becomes
  qualification, outreach, consent, touch, or legal-hold proof.
- Qualification can later promote to outreach protection, and outreach can later
  promote to legal hold, without changing the artifact content reference.
- Stronger protection is never silently demoted because a weaker use is added.
- Retry reuses only an exactly matching destination; conflicts and missing source
  objects fail with bounded receipts and preserve any completed immutable copies.
- A release record cannot be treated as a delete command. A future persistence
  and deletion design must revalidate current references, authorization, budget,
  retention policy, and the exact record immediately before a provider call.
- Additive persistence tables, authenticated owner UI, R2 adapter, lifecycle
  installation, and a staging smoke test remain separate gates.
