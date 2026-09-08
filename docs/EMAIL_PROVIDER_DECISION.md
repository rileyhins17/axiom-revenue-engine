# Email without Google Workspace: the owner decision guide

Reviewed 2026-09-08. **Research complete; provider selection and spending are not
approved.** Nothing was purchased, connected, sent, deployed or changed in DNS.

## The answer in plain English

We can have real `riley@getaxiom.ca` and `aidan@getaxiom.ca` inboxes without paying
Google. The harder requirement is an email company that permits the engine's
carefully targeted prospecting, supports reliable replies, and fits beside the
rest of the app inside C$50/month.

**The earlier blanket claim that C$50 confidently covers all of that was too
strong.** This review did not verify a complete compliant non-Google outreach
setup within that ceiling. That is not proof that none exists; it means we must
not purchase or build around an unverified assumption.

My recommendation is to keep the C$50 ceiling unchanged for now, continue the
full rebuild locally, and treat **Mailforge as a conditional outreach candidate,
not a selected provider**. Ask for the narrow confirmations below before buying
anything. For ordinary correspondence only, Purelymail is a low-cost candidate.
Do not use it to send the prospecting campaign.

This does not replace the requested email engine with a manual-only product.
Automated, evidence-grounded email remains in scope; provider acceptance, safe
integration and an owner-approved operating budget are unresolved release gates.

## What the providers actually allow

Prices below are published base prices, not Canadian checkout totals. Annual
prices require upfront payment; dividing by twelve does not make them monthly.

| Option | Verified price / minimum | Fit for Axiom's outreach | Decision |
|---|---|---|---|
| Purelymail | US$10/year simple plan; additional users/domains are not individually priced, subject to resource-use limits | Explicitly forbids unsolicited, advertising and marketing email | Candidate for normal business correspondence only; reject for campaign transport |
| Migadu | Micro US$19/year, 20 outgoing/day across the account; Mini US$9/month, 100 outgoing/day | Positions service for human correspondence, rejects bulk use; no explicit approval of our automated prospecting established | Do not select for automated outreach |
| Zoho Mail | Price not pursued after the policy failure | Usage policy excludes promotional, marketing and automated mail | Reject for this transport |
| Mailforge | Minimum ten slots; US$30/month entry price from its published explanation | Terms explicitly allow lawful unsolicited B2B outreach, but also retain conflicting termination wording | Best candidate for clarification, not purchase approval |
| Maildoso SMTP, not its Google offering | Custom minimum ten SMTP mailboxes at US$2.50/month each, plus domain costs | Help centre allows targeted automated B2B outreach; DNS and message transformations conflict with our requirements | Do not select for the current `getaxiom.ca` design |
| Mailreef | US$249/month flexible plan plus per-send charges | Explicit cold-email support, but far beyond the entire budget | Exclude from pilot shortlist |

Sources: [Purelymail pricing](https://purelymail.com/pricing) and
[terms](https://purelymail.com/termsofservice);
[Migadu pricing](https://migadu.com/pricing/) and
[limitations](https://migadu.com/procon/);
[Zoho usage policy](https://www.zoho.com/mail/help/usage-policy.html);
[Mailforge pricing](https://www.mailforge.ai/pricing) and
[entry-price explanation](https://www.mailforge.ai/blog/scaling-domains-and-mailboxes-best-practices);
[Maildoso minimum and pricing](https://intercom.help/maildoso/en/articles/16443027-how-much-do-smtp-mailboxes-cost-volume-pricing-tiers),
[allowed B2B use](https://intercom.help/maildoso/en/articles/16440085-what-are-the-guidelines-for-sending-targeted-automated-b2b-cold-emails-using-maildoso);
[Mailreef pricing](https://www.mailreef.com/pricing).

## The important catches

### Mailforge needs clarification, not blind trust

Section 3.4 permits lawful unsolicited B2B outreach and requires verified
addresses, sender identification and an unsubscribe link. Later in that section,
termination language refers to messages recipients did not specifically request.
Obtain a written explanation for our actual Canadian use case. The same terms
describe automatic renewal and cancellation through support at least seven days
before renewal. A public "cancel anytime" headline is not the complete exit
process. [Mailforge terms, sections 3.4 and 5.2](https://www.mailforge.ai/terms).

Standard SMTP/IMAP mailbox access is documented. That is useful: the Revenue
Engine can be the sending/reply application rather than requiring Salesforge as
another subscription. But this interoperability is **not yet tested in our
Cloudflare app**. API mailbox management is not proof of an HTTP message-send or
reply-sync API. Never export mailbox passwords into Git or agent logs.
[Mailbox access documentation](https://help.salesforge.ai/en/articles/9892755-access-mailforgeinfraforge-mailboxes-from-your-phone),
[API guide](https://www.mailforge.ai/blog/mailforge-api).

### Maildoso's cheaper headline conceals material integration tradeoffs

Its managed-DNS guide requires provider nameservers and restricts independent DNS
changes. A separate article says manual external DNS is possible: these documents
conflict. Its website-hosting article disallows custom A/CNAME records on managed
domains. **Do not move `getaxiom.ca` nameservers or transfer its registration to
make this service work.** That could affect the website and other services.
Subdomain coexistence is not established.
[Managed DNS](https://intercom.help/maildoso/en/articles/15478052-custom-dns-nameservers-and-tracking-domains-managed-dns),
[conflicting manual-DNS article](https://intercom.help/maildoso/en/articles/16595346-how-do-i-manage-and-verify-dns-records-for-my-domain-with-maildoso),
[website restrictions](https://intercom.help/maildoso/en/articles/15841065-can-i-host-a-website-or-add-a-cname-records-on-my-maildoso-sending-domain).

The provider also documents automatic link transformation and removal of
List-Unsubscribe headers. Our exact-message approval and unsubscribe tests must
cover what actually arrives, not merely what we submitted. Its recommended
third-party warm-up adds another dependency and potentially another bill; it is
not included in our approved plan. Do not activate artificial warm-up or copy
vendor volume recommendations into Axiom's policy.
[Message transformations](https://intercom.help/maildoso/en/articles/14166572-how-to-level-up-my-deliverability),
[warm-up guidance](https://intercom.help/maildoso/en/articles/15435524-how-warmup-works-and-how-to-start-it).

### Cheap ordinary inboxes are still useful, but not campaign permission

Purelymail supports SMTP/IMAP and multiple users, but expressly rules out
unsolicited/marketing mail. Its site acknowledges no 24/7 support and occasional
delivery blocks. It documents two-factor authentication; an independent security
audit and guaranteed response time were not established in this review. That
makes it an inexpensive ordinary-mail candidate, not a blanket commercial-quality
endorsement. [Service features and limitations](https://purelymail.com/),
[security documentation](https://purelymail.com/docs/security).

## What it would cost

The latest Bank of Canada daily value displayed during this review was
**C$1.3840 per US$1 for September 4, 2026**. That is an indicative historical
reference, not today's card checkout rate.
[Bank of Canada daily exchange rates](https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/).

At that reference rate, before taxes and card fees:

- Mailforge's US$30 minimum is **C$41.52/month**.
- Maildoso's US$25 minimum is **C$34.60/month**, before domains or other tools.
- Purelymail's US$10 annual base is **C$13.84 upfront per year**, subject to usage.

The existing non-mail planning allowances total C$26/month: Cloudflare C$7,
runtime AI C$7, acquisition C$5, verification C$5 and current-domain reserve C$2.
These are allocation targets, not fresh vendor quotes or proven hard caps.
Mailforge plus those allowances alone is C$67.52 before extras. Maildoso plus
them is C$60.60. Neither fits the current ceiling with the planned allocations.

### A conditional C$85/month scenario, not a budget change

| Monthly allowance | CAD |
|---|---:|
| Mailforge ten-slot minimum, with conservative conversion/tax/card-fee allowance | 49 |
| Ordinary business email reserve | 2 |
| Existing non-mail engine allocations | 26 |
| Optional separate outreach-domain renewal reserve | 2 |
| Remaining tax/usage/incident buffer | 6 |
| **Illustrative ceiling to evaluate** | **85** |

The C$49 calculation uses US$30 × 1.40 CAD/USD × 1.13 tax allowance × 1.025 card
fee allowance = C$48.65, rounded up. These are conservative scenario assumptions,
not a statement of taxes/fees charged by a specific checkout. The extra domain is
optional and **not approved**; support must first confirm whether the requested
`hello.getaxiom.ca` arrangement works without disrupting existing DNS.

No paid sequencer, artificial warm-up, dedicated IP or premium support is included.
If any is required, this is not an all-in solution and the estimate must change.
Year-one cash planning at this illustrative ceiling is C$1,020, not a contract
quote. Do not extrapolate a guaranteed three-year cost or buy annual outreach
capacity before acceptance. Setup/integration still costs engineering time even
when no extra subscription appears on the bill.

With C$50 unchanged, keep building and locally evaluating the complete engine.
Do not quietly label cheap ordinary mail as an operational prospecting solution,
strip out lead verification to fit a price, or call the project complete.

## How email would actually travel

This is the intended flow, **not something currently running**:

1. The engine finds a qualified business and proves why it is worth contacting.
2. It finds a relevant address, verifies it and records the consent basis.
3. You approve the exact recipient, sender and specific message.
4. The engine rechecks limits and suppression, then submits that approved message
   once to the chosen mail provider. The provider delivers it, not the AI model.
5. Replies enter the real mailbox. The engine imports them into the lead's
   conversation, flags opportunities and immediately suppresses opt-outs.

SMTP is a standard way to submit outgoing mail; IMAP is a standard way to read
mailbox contents. A provider API can perform these functions when documented.
We will not assume every API supports both. Cloudflare's own email sending is
currently transactional-only, so it is not the prospecting transport. Workers
also restrict port-25 connections; compatibility with the chosen provider's
authenticated submission and mailbox-reading connection must be demonstrated.
[Cloudflare email FAQ](https://developers.cloudflare.com/email-service/reference/faq/),
[Workers TCP restrictions](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/).

Two identities remain the launch plan. Ten purchased slots would be a provider
minimum, **not permission to operate ten senders or raise volume**. Aliases such
as `billing@` are routing names, not extra capacity. All addresses on one domain
remain connected to that domain; do not promise a subdomain makes the main brand
immune to reputation damage.

## The Canadian permission check stays separate

Provider permission is not legal consent. CRTC guidance requires case-by-case
evidence that the recipient caused an address to be publicly displayed, did not
reject unsolicited commercial messages there, and that our message is relevant
to their role. A purchased or scraped address alone does not prove those facts.
Retain the URL, capture time and role-relevance evidence. This is a product
compliance requirement, not legal certification for a particular campaign.
[CRTC conspicuous-publication guidance](https://crtc.gc.ca/eng/com500/faq500.htm/).

## Questions to resolve before Riley spends anything

Prepared for a future support enquiry; **not sent**:

1. Does your policy permit our Ontario website agency to send up to 50 total,
   individually relevant B2B first touches per week, each owner-approved, with
   documented Canadian consent basis, verified address and immediate opt-out?
   Please resolve the conflicting unsolicited-message wording in your terms.
2. Can we use `hello.getaxiom.ca` while retaining our current DNS host, website,
   root-domain mail and domain registration? Which exact records change?
3. Can our own application use authenticated SMTP and IMAP without a paid
   sequencer? Are sending/reply HTTPS APIs available, and what do they cost?
4. Can all open/click tracking, link rewriting and automatic warm-up be disabled?
   Are Message-ID, References and unsubscribe headers preserved end to end?
5. What MFA, individual administrator access, recovery, credential revocation,
   audit logs, retention, deletion and mailbox export controls are included?
6. What is the exact Canadian monthly invoice, minimum commitment, cancellation
   deadline, refund rule and required add-on cost for this configuration?

No credentials, lead list or private customer correspondence is needed to answer
those questions. A vendor sales claim or support promise is not a successful
integration test.

## Developer handoff: next implementation boundary

Current source has a `MailboxAdapter` interface in `src/engine/adapters.ts`, not a
working non-Google implementation. The unfinished outbound mailbox loader still
joins `GmailConnection`; it must not become the new provider-neutral connection
model by relabelling it.

Keep approval, suppression, verification, exact-message binding, spend reservation
and send-intent recovery independent of transport. Model a provider connection's
capabilities explicitly: send, read replies, preserve headers, disable tracking,
authentication and delivery reconciliation. Unknown capability means not ready.
SMTP acceptance is not proof of inbox placement. A connection loss after possible
acceptance is an ambiguous send; do not automatically resend or assume a stable
Message-ID provides provider-side deduplication.

The next local integration proof should use fake mail services, no real domains
or credentials: approve an exact message, submit once, survive an ambiguous
response without duplication, import one reply once, and suppress an opt-out.
Retain evidence across reload. Live compatibility and delivered-header testing
must wait for the finished-app deployment decision. The owner hold is unchanged.
