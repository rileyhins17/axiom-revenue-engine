# ADR 0067: A founder's own Claude can run a campaign end to end

Date: 2026-11-16. Status: accepted (both founders, Nov 16, 2026: Aidan answered the question card in Axiom Command "Yes, full control"; Riley: "claude can do anything it wants").

## Context

The Claude connector ([runbook](../runbooks/CLAUDE_CONNECTOR.md)) was built so a founder's Claude could read the engine and do five safe things. Approving a batch and resuming a campaign stayed on the screen on purpose: they are the two steps that let email go to real people.

In practice that left every campaign waiting on a founder's thumb. Both founders work day jobs during the send hours. On Nov 16 the cities campaign paused itself over bounces from one kind of address and nobody could hold those rows back or start it again until the evening. The agency emails, the only channel with replies, were queued ten days out for lack of a sender while the engine's inboxes sat half empty. The founders' cloud Claudes can draft but can't send, so the engine is the only thing that sends without a person.

## Decision

The connector gains four tools. Each calls the screen's own function, with the screen's own checks.

- `approve_batch`: the screen's Approve. It works only when the founder the key belongs to is one of the campaign's named approvers, and it approves the words the batch was loaded with. The approval note records that it came through that founder's Claude.
- `resume_campaign`: the screen's Resume. A campaign with unusable settings, no words, no inbox or no daily limit still can't start.
- `hold_contacts`: holds rows of one batch back, with a reason: only people who wait for their first email. `release` takes back holds made with this tool and no others, so a row the list check held (not verified, no mail server, do-not-email) can never be released this way.
- `create_campaign`: a new campaign, always paused and with no words. It sends from the calling founder's own inbox only, an inbox the engine already has, on the default schedule (weekdays, 9:00 to 2:30 Toronto time), up to 30 emails a day and never more than that inbox's own daily limit. It can't send until a list is loaded with its words, a named approver approves the batch and a founder (or their Claude) resumes it.

What stays off the connector: stopping a batch; changing an existing campaign's limits, inboxes, schedule or approvers; adding or changing an inbox; changing the words of an approved batch; the do-not-email list; anything about FCC. Raising a daily limit and adding an inbox still need both founders' yes.

## Consequences

- A founder's Claude can now put words in front of real people that no person has read. The tools and the plugin skill tell it to read every sample first and to approve only what it would put the founder's name under. The engine's own guards are unchanged: the do-not-email list, the mail-server check, per-inbox and per-campaign daily limits, send hours, and the pause after three bounces in a day.
- Every call is written to the audit log with the founder's name, the tool and the campaign or batch.
- A key is now worth more: whoever holds it can approve and start campaigns as that founder. Keys stay hashed, shown once, and can be turned off in Settings.
- The tests that proved the connector could not approve or resume now prove the narrower rule: only `approve_batch` by a named approver approves, only `resume_campaign` resumes, and nothing here changes limits, inboxes, the do-not-email list or FCC.
- No migration.
