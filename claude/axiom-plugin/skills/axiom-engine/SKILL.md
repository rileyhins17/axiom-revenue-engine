---
name: axiom-engine
description: Which Axiom connector to use for what (Axiom Command for leads, tasks, calendar and Claude-to-Claude work; the Axiom Revenue Engine for sending, batches, replies and inbox health), and the engine's rules. Use for any question or job about Axiom's outreach emails, campaigns, batches, replies, bounces, sending inboxes, the do-not-email list, or "how is sending going".
---

# Axiom: which connector, and the engine's rules

Axiom (Riley and Aidan's web studio) has two connectors. Pick by what the question is about.

| The question is about | Use |
| --- | --- |
| Leads and conversations, tasks and the Work board, the calendar, the daily log, jobs and questions between the two founders' Claudes | **axiom-command** (start with its `today` tool) |
| Emails going out: campaigns, batches, what waits for an Approve, replies and who answers them, bounces, pauses, each inbox today, the do-not-email list, the week's numbers | **axiom-engine** (start with `engine_today`) |

A reply the engine found becomes a lead only when a founder decides it is one: the engine finds the reply, Command holds the conversation from there. Never copy a contact's email address or phone number into Command; link the thread instead.

## The engine in one paragraph

The engine sends each campaign's emails from the founders' two Gmail inboxes on weekdays, follows up in the same thread, reads the inboxes for replies and bounces every hour, and pauses itself when something looks wrong. A campaign has batches (each a loaded list with its own words). Nothing in a batch sends until the campaign's named approver has read its samples and approved it on the screen.

## Reading (safe, do it freely)

- `engine_today`: what needs a founder right now, emails out today per inbox, pauses. Start here.
- `list_campaigns`, `get_campaign`, `list_batches`, `get_batch`: where every campaign and batch stands; a batch's samples exactly as they go out; held rows with reasons.
- `list_replies`, `get_reply`: who wrote back, what they said, which inbox to answer from. "To answer" means a real person's reply nobody has marked answered.
- `find_contact`, `check_do_not_email`: where a person or organisation stands; whether an address or domain is blocked and why.
- `inbox_health`, `week_numbers`: each inbox today; any week's numbers per campaign.

Give times in Toronto time and say where a number came from ("from the engine, 2:10 p.m.").

## Writing (only these, and only when a founder asked)

- `pause_campaign`: always allowed. Say why in the reason. Resuming is a founder's button on the screen.
- `check_list` then `load_list`: check a list first (it saves nothing), read the held rows and samples, then load it. A loaded batch waits for its approver; tell the founder it is waiting and for whom.
- `send_test`: queues a batch's test emails to the asking founder's own inbox only.
- `mark_reply_answered`: after a founder says they answered, or to count a reply toward the campaign's success number.

## What the connector can't do, on purpose

Approve a batch, resume a campaign, stop a batch, change limits, inboxes, schedules or an approved batch's words, change the do-not-email list, or anything about FCC (it ended on Nov 12, 2026 and stays paused). Those are founders' actions on the screen at operations.getaxiom.ca. Explain that and name the screen; don't look for another way.

## Rules that always hold

- Never send a real email as a test, and never ask anyone to. Test emails go only to the founders' own inboxes.
- An approval belongs to the founder named on the campaign. Never say a batch is approved unless the engine says so.
- Raising a daily limit, adding an inbox or changing who is emailed needs both founders' yes.
- The engine only reads mail. Answers to replies are written by a founder in Gmail, from the inbox that sent the email.
- Contact lists, addresses and keys never go into a public repository, an issue, a pull request or a screenshot.
