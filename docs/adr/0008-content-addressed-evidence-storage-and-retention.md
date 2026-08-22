# ADR 0008 — Use content-addressed evidence storage with explicit retention

- Status: accepted
- Date: 2026-08-22

## Decision

Store future website evidence as private, immutable, content-addressed objects.
An object key is derived from retention class, artifact kind, the first two
SHA-256 characters, the full SHA-256 digest, and the media extension. No business
name, URL, email, or other prospect identifier appears in object metadata.

Writes are single-part, Standard-storage, create-if-absent operations with an
explicit SHA-256 checksum, `private, no-store` cache metadata, and a small fixed
custom-metadata record. A retry that finds the key already present must read its
metadata and match key, length, digest, storage class, content type, cache policy,
kind, retention class, and contract version before reusing it. A mismatch stops
the batch.

Version 1 is fixture-only, shadow-only, provider-write unauthorized, and
zero-cost. It has no R2 import, binding, bucket, API call, or object write. A
completed fixture receipt can finalize Browser evidence only when every receipt
item exactly matches the originating content-addressed plan.

Retention classes are:

| Class | Planned lifecycle | Purpose |
|---|---:|---|
| `SHADOW_30D` | Delete after 30 days | Temporary evaluation and unapproved captures |
| `QUALIFICATION_180D` | Delete after 180 days | Current evidence for a qualified but uncontacted business |
| `OUTREACH_ACTIVE` | No automatic expiry | Evidence relied on for contact/compliance records |
| `LEGAL_HOLD` | No automatic expiry | Explicitly preserved incident or legal evidence |

Promotion to a longer-lived prefix will be a separate idempotent copy/receipt
operation before a shorter lifecycle can expire the source. Outreach-active and
legal-hold deletion requires a versioned owner/compliance release policy.

If a multi-object batch fails after one object is created, rollback does not
delete it. Content-addressed objects may be shared with another successful retry;
the failure receipt records the exact partial state and the normal lifecycle
removes an unreferenced shadow orphan.

## Why

Cloudflare R2 supports conditional puts, explicit SHA-256 checksums, object
metadata, and strong read-after-write consistency. Prefix-based lifecycle rules
can expire shadow and uncontacted evidence without listing and deleting objects
inside a workflow. Current limits are far above this bounded contract: 1,024-byte
keys and 8 KiB metadata, while each planned item is at most 5 MiB. [Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/),
[consistency](https://developers.cloudflare.com/r2/reference/consistency/),
[lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/), and
[limits](https://developers.cloudflare.com/r2/platform/limits/).

Standard storage is the pilot choice because Cloudflare currently includes 10
GB-month, one million Class A operations, and ten million Class B operations per
month at no charge. Infrequent Access has no free tier, retrieval fees, and a
30-day minimum duration, so its small storage discount does not improve this
low-volume pilot. [R2 pricing](https://developers.cloudflare.com/r2/pricing/).

The CRTC says CASL has no prescribed universal record-retention period and that
records should reflect how long the business is contacting recipients and its
documented compliance program. The engine therefore must not invent a three-year
expiry for evidence used in outreach. [CRTC FAQ](https://crtc.gc.ca/eng/com500/faq500.htm)
and [consent-record guidance](https://crtc.gc.ca/eng/com500/guide.htm).

## Consequences

- The same bytes under the same retention class and kind produce the same key,
  making retries idempotent and avoiding duplicate storage.
- Stored-object reconciliation is mandatory; a key alone is not proof that the
  expected bytes exist.
- Automatic lifecycle rules are allowed only for the two explicitly expiring
  prefixes. Outreach-active and legal-hold prefixes are excluded.
- Partial failures produce receipts and safe orphans, not compensating deletes.
- Promotion, reference counting, owner release, concrete R2 bindings, lifecycle
  installation, budget telemetry, and staging smoke tests remain separate gates.
- Enabling R2 billing or creating a bucket still requires Riley's explicit
  approval after the Cloudflare dashboard confirms the C$50 ceiling.
