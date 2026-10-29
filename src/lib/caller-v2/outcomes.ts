import type { ProspectOutcome } from '../revenue-engine/engine-prospects-d1';
import type { ResultEvent } from './protocol';

const legacy: Partial<Record<ResultEvent['outcome'], ProspectOutcome>> = {
  no_answer: 'NO_ANSWER', voicemail: 'VOICEMAIL', left_message: 'VOICEMAIL', wrong_number: 'WRONG_NUMBER',
  gatekeeper: 'GATEKEEPER', callback: 'CALL_BACK', interested: 'INTERESTED', meeting_booked: 'MEETING_BOOKED',
  not_interested: 'NOT_INTERESTED', do_not_contact: 'DO_NOT_CONTACT',
};
export function engineActivity(event: ResultEvent) {
  return {
    channel: event.attempted === true ? 'CALL' : 'NOTE',
    outcome: legacy[event.outcome] ?? 'NOTE',
    // The canonical full summary lives in CallerResult. This is the legacy list preview.
    note: `[Caller v2 · ${event.outcome.replaceAll('_', ' ')}] ${event.summary}`.slice(0, 1000),
    followUpAt: event.nextAction?.localDate ?? null,
  };
}
