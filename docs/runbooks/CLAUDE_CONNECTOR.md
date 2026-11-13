# The engine's Claude connector

**What it is.** A small server inside the engine that a founder's own Claude can talk to (an MCP server, at `/api/mcp`). With it, Claude can read what the engine's screens show and do a few safe things for that founder. It is the sibling of Axiom Command's connector and works the same way. It costs nothing to run: no new service, no paid API.

Each founder makes their own key in the engine: **Settings, Claude connector**. Claude signs in with that key, never with the sign-in cookie, and everything it does is done as that founder.

## What Claude can read

| Tool | What it gives |
| --- | --- |
| `engine_today` | The Today screen: what needs this founder, emails sent today per inbox, pauses, each campaign's row. Start here. |
| `list_campaigns` | Every campaign: live or paused, today's count, totals, its success number and what that number is called. |
| `get_campaign` | One campaign: its batches, numbers, schedule, limits, the email words, follow-ups coming and on hold. |
| `list_batches` | Batches in any campaign: waiting for approval, sending, done or stopped. |
| `get_batch` | One batch: up to 10 sample emails exactly as they go, and the held rows with reasons. |
| `list_replies` | Replies: to answer (the default), answered, automatic, no thanks or all; one campaign, or `fcc` for FCC's old replies. |
| `get_reply` | One reply: the stored words, and who answers it from which inbox. |
| `find_contact` | Someone by email or organisation: every campaign row, emails sent, replies, and whether they are blocked. |
| `inbox_health` | Each inbox today: sent of its limit, bounces, resting or not, next send, last reply check, its campaigns. |
| `check_do_not_email` | Whether an address or a whole domain is blocked, and why. |

Every time is given twice: as stored, and in Toronto time (the field whose name ends in `Toronto`).

## What Claude can do

Each of these is something the screen already lets a founder do. None of them makes an email go to a contact.

| Tool | What it does |
| --- | --- |
| `pause_campaign` | Pauses one campaign, with a reason. Pausing is always allowed. |
| `check_list` | The screen's "Check the list": saves nothing; shows ready rows, held rows with reasons and sample emails. |
| `load_list` | The screen's "Load this batch": saves a batch that waits for its approver. |
| `send_test` | Queues a batch's test emails to the founder's own inbox. There is no way to name another address. |
| `mark_reply_answered` | The Replies screen's marks: answered, and whether the reply counts toward the success number. |

Lists through the connector are small: up to 10 rows at a time. The list loader asks the database once or twice per row, and the free Cloudflare plan allows about 50 database queries per request. Bigger lists load on the campaign's Load a list screen or from a PC (`docs/runbooks/CAMPAIGNS.md`).

## What it can't do, and why

Approve a batch. Resume a campaign. Stop a batch. Change limits, inboxes or schedules. Change the words of an approved batch. Change the do-not-email list. Anything about FCC.

Those are the decisions that let email go out or change who gets it, so they stay on the screen with the right founder signed in. There is no tool for them and no code path to them from the connector; a test (`src/lib/connector/connector.test.ts`) fails if one appears. When asked, Claude says so and names the screen.

## Make a key and add it to Claude

1. Sign in to the engine and open **Settings, Claude connector**.
2. For **Claude Code**: press **Make a key**. Copy it at once: it is shown one time. Then run this on your computer, with your key in place of `<key>` (the Settings screen shows the line with your own address and key filled in):

   ```
   claude mcp add --transport http axiom-engine https://operations.getaxiom.ca/api/mcp --header "Authorization: Bearer <key>"
   ```

3. For **claude.ai and the Claude app**: press **Make a link** and copy the link address. In Claude open **Settings, Connectors, Add custom connector** and paste it. The address looks like `https://operations.getaxiom.ca/api/mcp/k/<link key>`.

The two are separate. A key (`axe_...`) only works in the header, and a link key (`axel_...`) only works in the address.

Anyone holding your key or link can read the engine's data and pause a campaign, as you. Keep it private: never in a chat, a file in this repository or a screenshot. The link carries its key in the address, so treat the whole address as the secret.

## Turn a key off

**Settings, Claude connector, Turn off.** It stops working at once. **Make a new key** also turns the old one off at once, so do that if a key may have got out. The engine stores only a fingerprint of each key (its SHA-256) and its last four characters, so nobody can read a key back, including us.

## What is logged

Every tool call writes one row to the audit log (`AuditEvent`): the tool (`connector.pause_campaign`), the founder, whether it worked, whether it saves anything, where the call came from, and the campaign, batch or reply it was about. It never holds a list, CSV text or an email address (an address inside a reply's id is replaced by a short fingerprint). Making a key and turning one off are logged too, never the key.

To read the latest rows:

```
SELECT "createdAt", "action", "targetId", "metadata" FROM "AuditEvent" WHERE "action" LIKE 'connector.%' ORDER BY "createdAt" DESC LIMIT 50;
```

Settings shows when each key was last used (Toronto time).

## Limits and errors

- 120 calls a minute per key. Calls without a valid key: 10 a minute per IP address. Over the limit the answer is HTTP 429 with a plain message.
- Every tool call has 10 seconds. One that takes longer answers with a plain error instead of hanging.
- No key or a wrong key: HTTP 401, telling Claude to make a key in Settings.
- A web page on another site can't use the connector, even holding a key.
- One tool call per request.

## Try it on a local copy

Nothing here touches the live engine or sends an email. All the data is made up.

```
npx tsx scripts/demo-data.ts /tmp/connector-demo/demo.db busy
APP_BASE_URL=http://localhost:3311 BETTER_AUTH_SECRET=<any 32 or more characters> AUTH_PASSWORD_SIGNIN=true AXIOM_LOCAL_SYNTHETIC_SIGNUP=1 AUTH_ALLOWED_EMAILS=<a founder's account address> DATABASE_PATH=/tmp/connector-demo/demo.db FCC_CAMPAIGN_MAILING_ADDRESS="100 Example Street, Kitchener, ON N0N 0N0, Canada" NEXT_TELEMETRY_DISABLED=1 npx next dev --webpack -p 3311
```

A founder's account address is one of the two in `src/lib/owner-login.ts`. Sign that account up on the local copy (local only), open `http://localhost:3311/settings`, and make a key. Then:

```
CONNECTOR_KEY=<your local key> node scripts/connector-smoke.mjs http://localhost:3311
```

The script calls the connector the way Claude does and prints one line per tool. On a local copy it also checks a made-up 3-row list and pauses the demo's `school-districts` campaign. Against any other address it only reads, unless you add `--writes`. It never prints the key.

## Where the code is

| What | Where |
| --- | --- |
| Keys (make, check, turn off) | `src/lib/connector/connector-keys.ts`, table `EngineConnectorKey` (migration 0092) |
| The protocol | `src/lib/connector/mcp-server.ts` |
| The tools | `src/lib/connector/mcp-tools.ts` (adding one is a single entry in `TOOLS`) |
| The two addresses, the key check, the limits | `src/lib/connector/mcp-http.ts`, `src/app/api/mcp/route.ts`, `src/app/api/mcp/k/[key]/route.ts` |
| Settings panel and its API | `src/app/settings/SettingsClient.tsx`, `src/app/api/connector/keys/route.ts` |
| Tests | `src/lib/connector/connector.test.ts` |
