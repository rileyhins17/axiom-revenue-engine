# First-touch channel route review

**Checked:** 2026-09-23 (America/Toronto)
**Scope:** Identify a low-cost, provider-permitted and legally plausible first-touch route for Axiom under the C$50/month ceiling, without paid Google Workspace. Research only; no provider contact, account setup, service activation, or outreach occurred.

## Finding

Use owner-led manual business-to-business phone calls and separately reviewed manual tasks for first touch. The incremental provider cost is **C$0 if the owners use phone service they already have**; their plan/minute charges were not verified. No new dialer is needed. This is a practical route to pursue under the current constraints, not a launch-ready calling program: Axiom's National DNCL registration and operational controls have not been verified.

No provider-permitted cold-email route was identified. Resend expressly requires recipients to have opted in. Cloudflare Email Routing is inbound forwarding, and Cloudflare Email Service sending is currently described as transactional only. Existing DNS records do not prove active destinations, a sender, account access, or permission to send.

## Manual B2B calling

CRTC guidance says live voice calls to telephone numbers are governed by the Unsolicited Telecommunications Rules rather than CASL. The National DNCL Rules do not apply to telemarketing calls made to a business consumer. **All telemarketers must still register with the National DNCL before calling**, including those making only exempt business-to-business calls. Registration is free; a paid National DNCL subscription is required for non-exempt calls. Axiom's registration is **unverified**, so this route is on hold until it and the controls below are confirmed. Other applicable telemarketing requirements still matter. In particular:

- Keep Axiom's internal do-not-call list and process a stop request during the call; retain the name and number for at least three years and fourteen days and block further calls.
- Identify the caller and Axiom clearly and display a reachable caller-ID number. On request, provide a local or toll-free callback number and a representative's name and email or postal address. The callback must reach a person or voicemail with a three-business-day return commitment; keep the contact channels valid for at least 60 days.
- Follow the CRTC calling-hour limits in the recipient's local time: weekdays 9:00 a.m.–9:30 p.m.; weekends 10:00 a.m.–6:00 p.m., subject to any stricter applicable provincial rule.
- Do not use an automatic dialing-announcing device for solicitation without express consent. Keep calls live and manually initiated; do not use sequential dialing.

The route assumes a genuine business number/business recipient. If a number is personal, ambiguous, or the recipient is not acting as a business consumer, do not assume the business-to-business DNCL exclusion applies; check applicable rules before calling.

Sources: [CRTC business-to-business calling checklist](https://crtc.gc.ca/eng/phone/telemarketing/biz.htm), [CRTC registration and subscription guidance](https://crtc.gc.ca/eng/phone/telemarketing/tobligations/register-inscrire.htm), [CRTC Unsolicited Telecommunications Rules](https://crtc.gc.ca/eng/trules-reglest.htm), especially Part II rule 2, Part III rules 2, 8, 10, 16–17, 20–26 and 31, and Part IV rules 1–2; [CRTC CASL FAQ](https://www.crtc.gc.ca/eng/com500/faq500.htm), which distinguishes live voice from commercial electronic messages.

## Opt-in email and reply handling

Resend Free is a candidate only for email recipients who explicitly opted in, or a separately permitted transactional use. Its published price is US$0/month. The project's provider plan records the Free allowance as 3,000 messages/month and a 100/day limit; actual account eligibility, quota, billing/tax treatment, and sender state remain unverified. Do not treat the free tier as cold-email permission.

Cloudflare Email Routing can forward incoming mail to verified destination addresses; it does not provide an inbox or custom-domain send-as capability. Replies could reach the owners only after the destinations are verified, routing rules are active, and an end-to-end reply test succeeds. None of those conditions is proven by public DNS alone.

Before any permitted opt-in email use, prerequisites include a real eligible Resend account and verified sender domain, current SPF/DKIM configuration, verified quota and sender state, an active verified Cloudflare destination and tested reply path, named reply owners with monitoring, and working stop/suppression handling. Any message must carry required identification and unsubscribe functionality where applicable. No provider activation or send is authorized by this review.

Sources: [Resend Acceptable Use Policy](https://resend.com/legal/acceptable-use), [Resend pricing](https://resend.com/pricing), [Cloudflare Email Routing addresses and destinations](https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/).

## Why cold email remains unselected

Canadian law and provider policy are separate gates. The CRTC describes a narrow implied-consent basis for conspicuously published electronic addresses: the address must be published by or for the account holder, there must be no accompanying statement refusing unsolicited commercial messages, and the message must be relevant to the recipient's business, role, duties, or functions. The sender bears the burden of supporting the basis; public availability by itself is not enough. Applicable identification and unsubscribe requirements also remain. This can make a particular one-to-one message potentially lawful on its facts, but does not authorize a general list or establish provider permission.

Provider checks found:

- Resend: only explicitly opted-in recipients; unsolicited recipients are not permitted.
- Cloudflare Email Service: documentation currently says sending is intended only for transactional email; Email Routing is inbound only.
- Zoho Mail: its current usage policy excludes promotional and marketing emails. An ordinary mailbox is therefore not a workaround for cold outreach.
- AWS: its Acceptable Use Policy bars unsolicited mass email and other spam; SES documentation warns unsolicited sending can trigger enforcement. No compatible Axiom route was established.

Sources: [CRTC CASL FAQ, conspicuous-publication guidance](https://www.crtc.gc.ca/eng/com500/faq500.htm) (see the section on published addresses and implied consent); [Resend AUP](https://resend.com/legal/acceptable-use); [Cloudflare Email Service FAQ](https://developers.cloudflare.com/email-service/reference/faq/); [Zoho Mail Usage Policy](https://www.zoho.com/mail/help/usage-policy.html); [AWS Acceptable Use Policy](https://aws.amazon.com/aup/); [Amazon SES enforcement FAQ](https://docs.aws.amazon.com/ses/latest/dg/faqs-enforcement.html).

## Cost and readiness

| Route | Published / assumed incremental cost | Replies | Current status |
|---|---:|---|---|
| Manually initiated live B2B calls using existing phones | C$0 if included in current phone plan and exempt-only registration remains free; plan charges unknown | Direct callbacks to the used phone number | Candidate route; hold calls until National DNCL registration, internal suppression, caller identity and hours are verified |
| Resend Free for explicit opt-in/transactional email | US$0/month published; taxes, eligibility and actual account state unverified | Potentially via Reply-To to Cloudflare-forwarded address after destination/rule verification and round-trip test | Candidate only; not connected or verified |
| Unsolicited cold email | No compatible provider route identified | No verified sender or reply route | Not selected or authorized |

This review adds no permission to contact prospects, send email, create accounts, or spend money. Current known incremental provider spend remains C$0.
