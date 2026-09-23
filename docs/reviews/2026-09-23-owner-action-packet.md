# Owner action packet — 2026-09-23

Prepared by Claude for Riley. These are the only steps that need an owner,
because each changes an account, a public setting or a legal registration.
Everything else continues without you. Nothing here spends money.

## 1. Make the GitHub repository private (about 1 minute)

- **Why:** GitHub shows `rileyhins17/axiom-revenue-engine` as public, but it
  holds private business context. New local commits stay unpushed until this
  is fixed.
- **How:** GitHub → repository → Settings → General → Danger Zone → Change
  visibility → Private.
- **Consequence:** only invited people can see it. CI keeps working. The
  protected-environment reviewer setting may need rechecking (see GOTCHAS
  `DEPLOY-001`).
- **Rollback:** the same setting can make it public again.
- **Not included:** rewriting history to remove the old SQLite WAL blob. That
  is a separate decision after the repository is private.

## 2. Create the 7-day read-only D1 token (already prepared by you)

- **Why:** a checksum-pinned export of the isolated staging D1 is the first
  step toward a staging release.
- **Scope:** D1 Read only, 7 days. Not a write or deploy credential.
- **After:** put it in the local ignored `.dev.vars`/environment only; Claude
  runs read-only inventory and export and records hashes.

## 3. Finish Email Routing so replies reach you (about 5 minutes)

Your 20:39 UTC audit: Email Routing is enabled for `getaxiom.ca`, but there
are **0 routing rules**, the only destination is **Pending**, and the
catch-all is disabled. So no reply to `riley@` or `aidan@getaxiom.ca`
currently reaches anyone.

- **How:** open the pending destination's verification email and confirm it;
  add Aidan's inbox as a destination and have him confirm; then create two
  custom-address rules: `riley@getaxiom.ca` → Riley's inbox and
  `aidan@getaxiom.ca` → Aidan's inbox. Leave the catch-all disabled.
- **Cost:** C$0. **Rollback:** delete or disable the rules.
- **Proof step (Claude):** after you confirm, Claude checks the dashboard
  read-only; you then send one test message from a personal account to each
  address and confirm it arrived. No prospect is involved.

## 4. Register Axiom with the National DNCL (free, about 15 minutes)

- **Why:** owner-led calls are the only acceptable first-touch route today
  (no permitted cold-email sender exists). Even business-to-business callers
  must register and keep an internal do-not-call list.
- **How:** register the business as a telemarketer at the CRTC National DNCL
  operator site; record the registration number (not a secret) for STATUS.
- **Cost:** registration is free; downloading consumer lists is not needed
  for calls to businesses.
- **Not included:** any call. Calling still needs the owner-confirmed lead
  list and call controls.

## 5. Create a Google Places key so the engine can find businesses (about 15 minutes)

- **Why:** the engine now finds, checks and shortlists businesses by itself, but
  it needs a source of local businesses. OpenStreetMap knew only 1 of our 50
  test businesses. Google Places returns each business's website.
- **Cost:** expected **C$0**. Each request is a Text Search Enterprise event,
  and Google gives 1,000 free per month. A weekly sweep uses about 27. The
  engine hard-stops at 30 per run and 200 per month; even with no free tier
  that caps out at about US$5.60 (about C$8) a month.
- **How:** in Google Cloud console, create a project "axiom-revenue-engine";
  link a billing account (Google requires one even for free usage); enable
  **Places API (New)** only; create an API key restricted to **Places API
  (New)**; under Quotas set "SearchText requests per day" to **40**; add a
  budget alert at **C$5**. Then put the key in the local ignored `.env.local`
  as `AXIOM_GOOGLE_PLACES_KEY=...` and add `AXIOM_PLACES_DISCOVERY_ENABLED=1`.
  Do not paste the key into chat or Git.
- **After:** Claude runs `npx tsx scripts/engine-weekly-run.ts --places` and
  reports what it found and the request count.
- **Rollback:** delete the key or disable the API; the engine switch defaults off.

## Current lead evidence (for context, no action needed)

Ten saved businesses have been reviewed on desktop and phone: **2** look worth
a rebuild conversation, **1** needs only small fixes, **7** already have a
working website. See the `/leads/m2` Website reviews section in the local
app. These are delegated reviews pending your confirmation, not a call list.
