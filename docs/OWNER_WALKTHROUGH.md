# Owner walkthrough: what actually works

Verified locally on 2026-09-08. All businesses and accounts in these captures are
synthetic. Nothing was sent, purchased or deployed. This is the existing app,
not a design mockup and not proof of production readiness.

## The result in plain English

You can browse an evidence-based lead, inspect its scores and recorded contact
routes, and label a separate 50-business review packet. Your review draft survives
a reload in the same browser after you import that packet again. You cannot yet
complete the intended seamless lead-to-saved-decision-to-outreach journey.

| Owner action | What this run proved | Remaining gap |
|---|---|---|
| Find a lead | Real Leads route renders the synthetic lead and separate scores | One seeded business does not prove ranking quality or real-market accuracy |
| Understand why | Dossier shows observations, severity, dates and source links | Links go to source pages; immutable proof images are not previewable |
| Choose a route | Phone, form and unverified email are visible; phone is recommended | Display is read-only, not an actionable manual-task workflow |
| Correct the engine | Quality Lab accepts Strong plus a reason and exports one review | Lab imports a separate packet; not a direct decision on the open dossier |
| Keep the decision | Same-browser draft restores after reload and packet reimport | Not a database save, cross-device sync or authenticated permanent submission |
| Prepare/send outreach | Not exercised or claimed | Non-Google provider unresolved; outbound integration and review unfinished |
| Manage revenue | Not assessed in this scoped walkthrough | Today, Outreach and Revenue need their own real owner-journey evidence |

## Actual screenshots

### Saved email summary privacy (latest local run)

The final authenticated desktop/mobile run proved that dashboard and automation
summaries show the admitted owner's saved messages, not another owner's private
mail. Opening a message displays plain text without loading tracking images.
Ordinary members are denied, and summary reads do not synchronize inboxes or
change saved application records. The stale Google connection prompt is removed;
the screen explicitly identifies saved metadata and the pending non-Google provider.

- [Desktop dashboard summary](../output/playwright/owner-walkthrough-32288-1788908892014/summary-dashboard-1440.png)
- [Mobile automation summary](../output/playwright/owner-walkthrough-32288-1788908892014/summary-automation-390.png)
- [Final acceptance result](../output/playwright/owner-walkthrough-32288-1788908892014/acceptance.json)

The parent inspected both captures. Six existing WCAG views and the new summary
journeys passed with zero external browser requests. This is still the old UI
structure, not the finished dark redesign. Shared business metrics remain shared.
Legacy operational/capacity labels are not live health checks or sending permission.
The complete approval/reply workflow remains unfinished; nothing was deployed.

### Updated mobile and status experience

The subsequent 2026-09-08 browser run verifies the first lead above the mobile
navigation without scrolling, a collapsed/expandable business queue, and one-step
evidence/verdict shortcuts with keyboard focus transferred to the target. The
sidebar no longer polls legacy counts or displays the hardcoded "prod" label.
Authoritative review counts remain on Leads. No permanent review save was added.

- [Mobile verdict controls after one shortcut](../output/playwright/owner-walkthrough-44852-1788892205564/mobile-verdict-controls.png)
- [Updated mobile lead view](../output/playwright/owner-walkthrough-44852-1788892205564/mobile-leads.png)
- [Updated desktop review](../output/playwright/owner-walkthrough-44852-1788892205564/desktop-review-restored.png)
- [Updated acceptance result](../output/playwright/owner-walkthrough-44852-1788892205564/acceptance.json)

This run passed all six WCAG views and the existing disposable security scenarios,
with zero external browser requests. Warm list/dossier readiness was 372/827 ms.
These checks establish the interaction, not Riley's actual review speed.

### Initial walkthrough (before those fixes)

Captures are ignored local artifacts, not committed customer data. These links
work in this checkout; rerun the command below to regenerate on another machine.

- [Desktop lead list](../output/playwright/owner-walkthrough-28768-1788891658830/desktop-leads.png)
- [Desktop evidence dossier](../output/playwright/owner-walkthrough-28768-1788891658830/desktop-dossier.png)
- [Desktop restored review draft](../output/playwright/owner-walkthrough-28768-1788891658830/desktop-review-restored.png)
- [Mobile lead list](../output/playwright/owner-walkthrough-28768-1788891658830/mobile-leads.png)
- [Mobile evidence dossier](../output/playwright/owner-walkthrough-28768-1788891658830/mobile-dossier.png)
- [Mobile restored review draft](../output/playwright/owner-walkthrough-28768-1788891658830/mobile-review-restored.png)
- [Machine-readable acceptance result](../output/playwright/owner-walkthrough-28768-1788891658830/acceptance.json)

## What needs improvement

1. **Review is not yet one simple saved action.** Packet import, browser-local
   drafts and downloading a file for Codex to record are transitional tooling.
   Target: an authenticated decision on the actual lead, durable save/replay,
   visible confirmation and recovery. Preserve current owner verification/MFA,
   origin, authorization and transaction gates before connecting a writer.
2. **Evidence needs to be visible inside the app.** The dossier currently says
   previews are unavailable. "Inspect proof" opens a current source URL rather
   than the saved capture that supports the claim. Private, authorized capture
   access is still needed; the link count test does not prove artifact retrieval.
3. **Mobile scrolling gap, locally addressed.** In the initial 390px-wide capture, the first
   lead begins near the bottom of the opening viewport and the verdict controls
   are far below the review queue and evidence. Bring the lead and decision
   controls forward, with expandable detail. The updated capture above proves
   the compact lead header, queue disclosure and direct verdict access. Passing contrast/overflow checks
   does not prove Riley can review a business in 30 seconds.
4. **Contradictory status labels, locally addressed.** The sidebar showed READY 0 while
   the lead view showed one ready-to-review business. It also said "prod" during
   this isolated local test. Unify the readiness definition and display actual
   deployment identity rather than implying a production connection. The sidebar
   now links to Leads for current review counts and makes no environment claim;
   it no longer requests the legacy stats endpoint every 30 seconds.
5. **Email is still unfinished; the saved-history view is now provider-neutral.**
   Client email activity reads saved outgoing replies without Google token refresh
   or inbox fetching. It shows the actual sender, exact plain text and whether
   acceptance, uncertainty or rejection was recorded. It is read-only, clearly not
   a live inbox, and does not silently import legacy emails. The old incompatible
   composer is removed; exact approval, usable replying, incoming messages and the
   chosen non-Google provider still need integration. No live email was used to test it.
   **Legacy client history now has its own local privacy checks:** the actual
   client-page props, full profile and shared message viewer render sender-owned
   plain text with no tracking-image requests. Business notes remain. Desktop and
   mobile checks caught and corrected horizontal overflow; the original visual
   design has not been replaced by the proposed redesign. Dashboard/automation
   summary privacy now has the separate authenticated proof above; the complete
   reply workflow remains unfinished.
   [Desktop legacy viewer](../output/playwright/legacy-email-history/desktop-viewer.png)
   and [mobile legacy viewer](../output/playwright/legacy-email-history/mobile-viewer.png)
   are synthetic captures; rerun `npm run test:legacy-email-ui` after builds/dry runs.

Next integration: connect the durable owner-decision journey through the existing
security boundaries, preserving this now-tested mobile navigation.
Vendor research can proceed independently; it must not block safe local UI work.

## Verification and limits

- Actual production-mode local Next build, disposable SQLite fixture and real
  browser; no live database or provider credentials.
- Six desktop/mobile views passed the existing WCAG, responsive and reduced-
  motion checks. Keyboard dossier navigation and mobile pointer access passed.
- Review label and reason restored in the same browser; export explicitly
  denied database, qualification, outreach, send and paid-provider authority.
- Zero browser external requests; browser errors and local 5xx checks passed.
- Existing owner admission, OAuth initiation, mailbox metadata, request-origin,
  session revocation and ban scenarios also passed using disposable accounts.
- Warm local list readiness: 400 ms; dossier: 93 ms. These are handler/render
  checks, not a human usability study or production performance guarantee.
- No proof here of real lead quality, permitted live outreach, production
  security, inbox delivery, cross-device review persistence or revenue results.

Run from `C:\Users\riley\Documents\ChatGPT\APE`, after all other Next/OpenNext/
Cloudflare builds and dry runs have exited:

```powershell
npm run test:owner-ui -- --capture-walkthrough
```

The runner retains synthetic screenshots and a final acceptance summary in a
unique `output/playwright/owner-walkthrough-*` folder. It does not retain the
successful run's disposable database or copy credentials/cookies/server logs into
that folder. Screenshots without a passing `acceptance.json` are partial evidence,
not a completed acceptance run. The default release command is unchanged.
