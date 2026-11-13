# Engine rebuild: outreach-first screens and a Claude connector

Written Thu Nov 12, 2026, late night, from Riley's ask. Run by a cloud Claude session on
Fri Nov 13, 2026, from 3:01 pm Toronto. Branch with this file: `plan/engine-rebuild`.

Riley's words: "make the revenue engine be fully refactored ui/ux wise and actually be
useful and have a claude connector for it ... the revenue engine shows FCC as 1 of 3 tabs
but we dropped FCC as a whole ... needs to be actually perfectly optimal based on what
we're using it for."

This repository is public. Nothing private goes in commits, pull requests, screenshots or
test fixtures: no real contact names, email addresses, mailing address, keys or tokens.
Screens are previewed with made-up data only.

---

## 0. Before you write any code (about 20 minutes)

1. Read, in this order: `AGENTS.md`, `README.md`, the top of `docs/STATUS.md`,
   `docs/GOTCHAS.md` (WORKERS-001 above all), `docs/runbooks/CAMPAIGNS.md`,
   `docs/adr/0064-fcc-only-engine.md`, `docs/adr/0065-campaigns-beside-fcc.md`.
2. `git fetch origin` and confirm the live branch `codex/revenue-engine-production` tip.
   If it moved past `ac402db`, read every new commit and the new STATUS entries first:
   this plan may be out of date in places, and the code wins over this file.
3. Read the latest decisions in Notion (Axiom HQ: the Work board, both founders' daily
   log for Nov 12 and Nov 13, and the board "Claude handoffs: Riley's Claude and Aidan's
   Claude"). Look for: anything about the engine, city email amounts, agency emails going
   through the engine, and any founders' decision to freeze engine work. If the founders
   decided to freeze engine work, stop, write one line saying so, and do nothing else.
4. Note what you found in the session (not in git) and carry on.

## 1. What the engine is for now (facts as of Nov 12)

- **FCC is dead.** Founders decided Nov 12. FCC sending has been paused since Wed Nov 11,
  4:24 pm (Aidan). It will not come back. Its tables stay (never drop live tables).
- **The engine is Axiom's outreach sender and reply catcher.** Live campaigns: US cities and
  counties (accessibility "free report" offer), school districts, and new lists aimed at
  city IT, web or communications contacts. Two Gmail sending inboxes (Aidan's and Riley's).
  Agency emails go from Aidan's Proton mail for now; whether the engine sends them too is
  still undecided, so design for "any number of campaigns", never for cities only.
- **Who does what on it:**
  - Aidan reads a batch's samples and presses Approve. This is the most frequent founder
    action and the only one that must happen on the screen.
  - Both founders want to know: did anyone real reply, who answers it, from which inbox.
  - Both want to know sending is healthy: per inbox today, pauses, bounces, an inbox
    resting for the day.
  - Claude (Riley's) loads most lists; founders can load from the screen.
  - The founders judge each test at the Thursday meeting by a few numbers per campaign
    (for cities: price requests per 100 emailed; replies; bounces; no thanks).
- **Leads live in Axiom Command**, not the engine. The engine finds replies; Command holds the
  conversation from there.
- **Today the phone app has three tabs: Today, FCC, More.** Campaigns, the thing actually in
  use, is hidden under More, and Today is all about FCC. That is the core problem.

## 2. Hard rules for this run

- Work on branches and open **draft** pull requests against `codex/revenue-engine-production`.
  **Never release, deploy, run `wrangler`, touch the production database or send any email.**
  Releasing is done later from Riley's PC with `scripts/release-production.mjs`, after a day's
  last send, on Riley's go. Write the release steps in the PR instead.
- No change to who is emailed, what they get, how many, when, or any pause. Sending code is
  out of scope except where a phase below says so, and those changes must leave the send
  schedule identical (prove it with a test).
- Migrations only add. The next free number is `0091`; add each new file to `KNOWN` in
  `scripts/release-production.mjs`.
- WORKERS-001: no module-level promises or caches of anything pending. Every screen and every
  connector call has a time limit (`src/lib/timeout.ts`) and fails to the retrying error
  screen or a clear error, never a hang.
- Engine running cost stays $0: free Cloudflare plan, no paid APIs, no new services.
- Tests whose fixtures carry real dates pin their clock. Commit before running the full
  suite (some tests read the migrations folder).
- Before each PR: `npm run check:safety`, `npm test`, `npm run typecheck`, `npm run lint`,
  `npm run build:cloudflare`. Put the results in the PR.
- Plain English everywhere a founder reads (screens, PRs, STATUS). Toronto time.
- Use subagents for independent work (for example the connector while you do screens), but
  check every subagent's result yourself before it goes in a PR.

## 3. Phase A: outreach-first screens (PR 1, the biggest value)

Branch `claude/engine-outreach-screens`. Keep the current look (cream, black, gold, serif
headings: `design-system/axiom-revenue-engine` and `src/components/owner/kit.tsx`), but
rebuild what each screen is for. Phone first: the founders mostly open it on iPhone.

### Navigation

- Phone tabs (4): **Today**, **Replies**, **Campaigns**, **More**.
- Desktop sidebar: the same four, with More's items listed under it.
- More: **Inboxes**, **Do-not-email list**, **FCC archive**, **Settings** (and the Claude
  connector, Phase B).
- FCC leaves the tabs and Today entirely. `/fcc` becomes the FCC archive (read-only numbers,
  "FCC ended Nov 12, 2026", no Resume button on the main path). Old links keep working.
- Update `src/lib/navigation.ts`, `app-shell.tsx`, `app-sidebar.tsx`, `navigation.test.ts`.

### Today (`/dashboard`): "what needs you, then is everything OK"

1. **Needs you** cards, most urgent first, each with one button:
   - A batch waiting for *your* approval ("Cities IT1: 35 emails wait for your Approve" →
     opens the batch). A founder who is not the approver sees "waits for Aidan" in a quieter
     line, not a card.
   - Real replies nobody has answered yet (count + the newest two, with "answer from Riley's
     inbox").
   - An automatic pause, an inbox resting for the day, or a reply check that stopped.
   - Nothing to do → one calm line: "Nothing needs you. Next email goes at 9:00 Mon."
2. **Sending today**: per inbox, "Aidan 30 of 60 · next 1:12 pm" / "resting today (3 bounces)".
   Total sent today across all campaigns as the big number (it replaces FCC's 0).
3. **Campaigns**: one row each: name, Live/Paused, sent today, waiting, replies this week.
4. **This week**: emails sent, real replies, no thanks, bounces, and each campaign's own
   success number where one is set (cities: price requests).
- No FCC anywhere on Today.

### Replies (`/replies`, new)

- One list of every reply the engine recorded (`OutreachReply`, plus FCC's replies under a
  filter "FCC (ended)"), newest first.
- Filters: **To answer** (default: real replies), Automatic, No thanks, All; and by campaign.
- Each row: person and organisation, campaign, when, the first lines of what they wrote, and
  **which inbox to answer from**. Tapping opens the full text.
- "Open in Gmail" link that searches that inbox's Gmail for the message (a link only; the
  engine never changes mail).
- "Answered" state: a founder can mark a reply answered (new nullable columns
  `answeredAt`, `answeredBy` on `OutreachReply`, migration `0091`). Stretch, only if time
  allows: the hourly reply check also notices our own later message in the same thread
  (read-only) and marks it answered by itself.

### Campaigns (`/campaigns`, `/campaigns/<key>`)

- List: same rows as Today's campaign rows, plus totals and reply rate since start.
- Campaign page, sections in this order: state and Pause/Resume (Resume only where the rules
  already allow it), **Batches** (waiting for approval first, then sending, then done, each
  with counts and held reasons), numbers (sent, replies, no thanks, bounces, success
  number, by batch), the words, schedule and limits (read-only), **People** (search by email
  or organisation: status, emails sent, reply), Load a list.
- The batch page keeps its 10 samples and Approve exactly as the rules require; make the
  samples readable on a phone and Approve impossible to press by accident (sticky footer
  button, confirm sheet that names the count).

### More → Inboxes (`/inboxes`, new, read-only)

- Each sending inbox: name, today's sent of its limit (and the ramp), bounces today, resting
  or not, last reply check and whether it could open the inbox, which campaigns use it.

### More → Do-not-email list (`/do-not-email`, new, read-only)

- Search an address or domain: is it blocked, why (bounce, no thanks), when, which campaign.

### FCC archive (`/fcc`)

- Read-only: all-time numbers and the reply list filter. FCC stays paused. Do not remove the
  FCC sending code in this PR.

### Health check and Monday email

- The health check must not keep alerting that FCC is paused. FCC paused is now normal.
  Keep every campaign and inbox alert.
- The Monday 8 am FCC numbers email becomes a Monday numbers email for **all campaigns**
  (same once-a-week and retry rules, `src/lib/fcc-weekly-numbers.ts`), FCC left out.

### Done when

- Every screen loads within its limit on a local copy with made-up data (several campaigns,
  batches waiting, replies of each kind, an inbox resting, empty states).
- Playwright screenshots at iPhone size and desktop, light and dark, of Today, Replies,
  Campaigns, a campaign, a batch, Inboxes, in the PR (made-up data only).
- New tests for the navigation, Today's "needs you" rules, reply filters, the answered
  marker, the health check no longer alerting on FCC, the all-campaigns Monday email.
- README "Screens" section rewritten; ADR `0066-outreach-first-engine.md` (FCC ended, what
  the engine is for, the screens).

## 4. Phase B: the engine's Claude connector (PR 2, stacked on PR 1)

Branch `claude/engine-claude-connector`, based on PR 1's branch. Goal: any founder's Claude
(Claude Code, claude.ai, the cloud routines) reads the engine's live data in one call instead
of a founder opening the screen or a PC job running SQL.

### Shape: copy Axiom Command's connector

Axiom Command already has one (repo `Mageester/AxiomCommand`, `worker/mcp.ts`): a small
hand-written MCP server over JSON-RPC (protocol versions `2025-06-18`, `2025-03-26`,
`2024-11-05`), a private key per founder made in Settings (only its hash stored), and a
second "link" form `/api/mcp/k/<key>` for claude.ai custom connectors, which can't send a
header. Read it if you can reach it; otherwise build the same shape from the MCP spec.
Use the same conventions so the two connectors feel like one family.

- Routes: `src/app/api/mcp/route.ts` and `src/app/api/mcp/k/[key]/route.ts` (POST for
  JSON-RPC; answer GET with 405 unless the spec version needs more). Add both to
  `public-paths.ts` (they do their own key check, not the cookie) and rate-limit them.
- Keys: table `EngineConnectorKey` (founder, key hash, last four, created, last used),
  migration `0092` (or `0091` if PR 1 ended up with none). Prefix `axe_` for the header key
  and `axel_` for the link key. Settings → **Claude connector**: make a key (shown once),
  see when it was last used, turn it off.
- Every call is logged with `writeAuditEvent` ("via Claude connector, Riley").
- Every tool has a time limit and returns a plain error, never hangs.

### Tools (names short, results plain JSON, Toronto times)

Read-only (annotate `readOnlyHint: true`):

| Tool | Gives |
| --- | --- |
| `engine_today` | the Today screen as data: needs-you items, sending today per inbox, pauses |
| `list_campaigns` | every campaign: state, today, totals, success number |
| `get_campaign` | one campaign: batches, numbers by batch, schedule, limits, words |
| `list_batches` | batches by state (waiting for approval, sending, done), any campaign |
| `get_batch` | one batch: samples exactly as they go, held rows with reasons |
| `list_replies` | replies with filters (to answer, automatic, no thanks, campaign, since) |
| `get_reply` | one reply's full text and which inbox to answer from |
| `find_contact` | by email or organisation: every campaign row, emails sent, replies, blocked or not |
| `inbox_health` | each inbox: sent of limit, bounces today, resting, last reply check |
| `week_numbers` | the Monday email's numbers for any week |
| `check_do_not_email` | is an address or domain blocked, and why |

Writes, safe ones only (each one a thing the screen already lets a founder do):

| Tool | Does |
| --- | --- |
| `pause_campaign` | pauses one campaign with a reason (pause is always allowed) |
| `check_list` | the screen's "Check the list": saves nothing, returns ready, held and samples |
| `load_list` | the screen's "Load this batch": saves a batch that waits for its approver |
| `send_test` | queues a batch's test emails to our own inboxes only |
| `mark_reply_answered` | the Replies screen's marker |

Not in the connector, on purpose: Approve, Resume, changing limits, inboxes, words of an
approved batch, the do-not-email list, anything FCC. Those stay on the screen with the
right founder signed in. Say so in each tool's description, so Claude explains it instead
of trying.

### Done when

- Tests for: key made, hashed and checked; wrong or turned-off key refused; link form works;
  `initialize`, `tools/list`, `tools/call` for every tool against made-up data; no write
  tool can approve or resume; time limit returns an error; audit row written.
- A local run where a real MCP client (`npx @modelcontextprotocol/inspector` or a short
  script) lists and calls the tools against the local copy, shown in the PR.
- `docs/runbooks/CLAUDE_CONNECTOR.md`: what it is, the tools, how a founder makes a key and
  adds it in Claude Code (`claude mcp add --transport http axiom-engine
  https://operations.getaxiom.ca/api/mcp --header "Authorization: Bearer <key>"`) and in
  claude.ai (Settings → Connectors → Add custom connector, the link form).

## 5. Phase C: the Axiom connector family (PR 3, small)

Branch `claude/axiom-claude-plugin`. Make "Claude has easy access to everything Axiom" one
install instead of tribal knowledge.

- `claude/axiom-plugin/` in this repo: a Claude Code plugin with
  - `.mcp.json` naming both connectors (Axiom Command and the engine), keys read from
    environment variables (`AXIOM_COMMAND_KEY`, `AXIOM_ENGINE_KEY`), never written in the file;
  - a skill `axiom-engine` saying when to use which connector: leads, tasks, calendar and
    Claude-to-Claude work → Command; sending, batches, replies, inbox health → engine; and the
    engine's rules (no real test emails, Approve and Resume are founders' screen actions);
  - a short README with the two install lines.
- Write in the PR (don't build) the next links, for the founders to say yes or no to:
  1. The engine sends the nightly numbers to Command's Scoreboard itself, so Riley's PC job
     `engine-scoreboard` can retire (needs a Command key as a Cloudflare secret, and Aidan,
     who deploys Command).
  2. Each real reply becomes a heads-up or a suggested lead in Command automatically.
  3. Riley's other PC jobs (`load-aidan-lists`, `engine-day-ping`) move to cloud routines
     that use the two connectors. Retire PC jobs only on Riley's word.

## 6. Phase D, only if A to C are done and clean: retire FCC's sending code

Separate branch `claude/engine-retire-fcc-sender`, separate draft PR. Stop FCC's tick from
running at all and remove FCC's sending path, keeping its tables, its do-not-email entries,
its reply history and the archive screen. The inbox budgets must then count campaigns only.
Prove with a replay test that the campaigns send exactly the same emails at the same times
with and without the change. The release script's allowed schedules must still match. If
there isn't time to prove it properly, skip this phase and say so.

## 7. Finish (last 20 minutes, whatever got done)

1. Each PR: what changed for a founder (three lines at the top, plain English), screenshots,
   checks, the migration and its `KNOWN` entry, the release steps for Riley's PC, the
   rollback (the current live version from STATUS), what was left out and why.
2. A STATUS.md entry at the top marked **not released**, naming the PRs and branches.
3. In Notion's Work board, one task for Riley: "Review the engine rebuild PRs and say when to
   release (after a day's last send)", due Mon Nov 16, with the PR links. Nothing in Slack.
4. End the session with five lines or fewer: what's ready, what isn't, the one decision Riley
   has to make.
