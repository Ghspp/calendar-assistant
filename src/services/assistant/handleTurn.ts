/**
 * One conversational turn.
 *
 * Wraps the single-shot pipeline with short-term memory, so an incomplete request can
 * be finished over several turns:
 *
 *     "תקבע לי פגישה עם דניאל מחר"  →  "באיזו שעה לקבוע?"
 *     "בשש"                          →  "בבוקר או בערב?"
 *     "בערב"                         →  "ולכמה זמן?"
 *     "לשעה"                         →  created
 *
 * The memory only ever accumulates slots. Every turn that completes a request still
 * goes through validation and conflict detection unchanged — multi-turn requests get no
 * shortcut to the calendar.
 */

import type { ParsedCommand, SlotName } from '../../types/parser';
import type { Clock } from '../../utils/clock';
import { executeCommand, type HandleCommandOptions } from './handleCommand';
import { applyChangeToEvent } from './updates';
import { parseUpdate } from './updateParsing';
import { parseCommand } from '../parser';
import { confirmDelete } from './deletes';
import { confirmMessage, startMessage } from './messages';
import {
  readChannelChoice,
  readChoice,
  readConfirmation,
  readSeriesScope,
} from '../conversation/choices';
import { CalendarError } from '../calendar/errors';
import { isActionExpired, type PendingAction } from '../conversation/ConversationManager';
import {
  clearPending,
  emptyConversation,
  planTurn,
  rememberPending,
  type ConversationState,
  type PendingRequest,
} from '../conversation/ConversationManager';
import { toParsedCommand } from '../conversation/slots';
import type { CommandOutcome } from './types';

export interface TurnOptions extends HandleCommandOptions {
  state?: ConversationState;
}

export interface TurnResult {
  outcome: CommandOutcome;
  /** Carry this into the next turn. */
  state: ConversationState;
}

/** The message shown when a user backs out of a half-finished request. */
export const CANCELLED_MESSAGE = 'בוטל. לא נקבע שום דבר.';

export async function handleTurn(text: string, options: TurnOptions): Promise<TurnResult> {
  const clock = options.clock;
  const state = options.state ?? emptyConversation;

  // An outstanding choice or confirmation takes precedence: while one of those is
  // open, 'השני' and 'כן' are answers to it, not new commands.
  const action = state.action;
  if (action !== undefined && !isActionExpired(action, clock)) {
    const resolved = await resolvePendingAction(action, text, options);
    if (resolved !== undefined) return resolved;
  }

  const plan = planTurn(text, state, clock);

  if (plan.kind === 'cancelled') {
    return {
      outcome: { kind: 'failed', errorKind: 'unknown', message: CANCELLED_MESSAGE },
      state: clearPending(),
    };
  }

  // The utterance did not answer the outstanding question. Nothing runs — in
  // particular nothing is created — and the request is kept so the user can retry.
  if (plan.kind === 'not-understood') {
    const question = questionFor(plan.pending);
    return {
      outcome: {
        kind: 'needs-input',
        parsed: toParsedCommand(plan.pending.slots, plan.pending.originalText),
        errors: [{ code: 'MISSING_SLOT', message: `לא הבנתי. ${question}` }],
      },
      state: { pending: { ...plan.pending, updatedAtMs: clock.now().getTime() } },
    };
  }

  const outcome = await executeCommand(plan.command, options);

  // Still incomplete: remember what we have and what we just asked, so the next
  // utterance can be read as an answer to it.
  if (outcome.kind === 'needs-input') {
    const first = outcome.errors[0];
    const asking: SlotName | 'ambiguity' =
      first?.code === 'AMBIGUOUS_TIME' ? 'ambiguity' : (first?.slot as SlotName) ?? 'startTime';

    // A past time or a malformed value is not something an answer can fix by
    // accumulating more slots, so those clear the memory instead of looping.
    const recoverable = first?.code === 'AMBIGUOUS_TIME' || first?.code === 'MISSING_SLOT';
    if (!recoverable) {
      return { outcome, state: clearPending() };
    }

    const originalText = plan.continuing ? plan.command.rawText : text;

    return {
      outcome,
      state: rememberPending(plan.command, asking, first?.candidates, originalText, clock),
    };
  }

  // An outcome that asks the user something must be remembered, or their answer has
  // nothing to attach to and the next turn would start from scratch.
  const followUp = pendingActionFor(outcome, plan.command, clock);
  if (followUp !== undefined) return { outcome, state: { action: followUp } };

  // Created, refused, failed or unsupported — the request is over either way.
  return { outcome, state: clearPending() };
}

/** The action to remember, when an outcome left a question hanging. */
function pendingActionFor(
  outcome: CommandOutcome,
  command: ParsedCommand,
  clock: Clock,
): PendingAction | undefined {
  const updatedAtMs = clock.now().getTime();

  if (outcome.kind === 'delete-confirm') {
    return { kind: 'confirm-delete', event: outcome.event, updatedAtMs };
  }

  if (outcome.kind === 'delete-scope') {
    return { kind: 'delete-scope', event: outcome.event, updatedAtMs };
  }

  if (outcome.kind === 'message-unclear') {
    // Only the two answerable reasons become a question worth remembering. A refused
    // mail scope or an unwired channel is not something the user can answer here.
    if (outcome.reason === 'no-recipient' || outcome.reason === 'no-body') {
      return {
        kind: 'compose-message',
        asking: outcome.reason === 'no-recipient' ? 'recipient' : 'body',
        ...(outcome.recipient !== undefined ? { recipient: outcome.recipient } : {}),
        ...(outcome.body !== undefined ? { body: outcome.body } : {}),
        updatedAtMs,
      };
    }
    return undefined;
  }

  if (outcome.kind === 'message-choose-channel') {
    return {
      kind: 'choose-message-channel',
      contact: outcome.contact,
      body: outcome.body,
      channels: outcome.channels,
      updatedAtMs,
    };
  }

  if (outcome.kind === 'message-confirm') {
    return {
      kind: 'confirm-message',
      contact: outcome.contact,
      body: outcome.body,
      channel: outcome.channel,
      updatedAtMs,
    };
  }

  if (outcome.kind === 'update-scope') {
    return {
      kind: 'update-scope',
      event: outcome.event,
      change: outcome.change,
      updatedAtMs,
    };
  }

  if (outcome.kind === 'conflict' && outcome.suggestion !== undefined) {
    return {
      kind: 'confirm-suggestion',
      event: outcome.event,
      startTime: outcome.suggestion.startTime,
      updatedAtMs,
    };
  }

  if (outcome.kind === 'delete-ambiguous') {
    return {
      kind: 'choose',
      intent: 'DELETE',
      matches: outcome.matches,
      context: outcome.matches,
      updatedAtMs,
    };
  }

  if (outcome.kind === 'update-ambiguous') {
    const request = parseUpdate(command);
    if (request === undefined || request.change.kind === 'unclear') return undefined;
    return {
      kind: 'choose',
      intent: 'UPDATE',
      change: request.change,
      matches: outcome.matches,
      context: outcome.matches,
      updatedAtMs,
    };
  }

  return undefined;
}

/** Re-ask whatever the pending request is waiting for. */
function questionFor(pending: PendingRequest): string {
  if (pending.asking === 'ambiguity') return 'בבוקר או בערב?';
  if (pending.asking === 'date') return 'באיזה תאריך לקבוע?';
  if (pending.asking === 'startTime') return 'באיזו שעה לקבוע?';
  if (pending.asking === 'duration') return 'ולכמה זמן?';
  return 'מה לקבוע?';
}

/**
 * Handle an utterance while a choice or a confirmation is outstanding.
 *
 * Returns undefined when the utterance is plainly something else, so it falls through
 * to the ordinary pipeline. Anything it cannot read as an answer is re-asked rather
 * than guessed — this is the path that decides whether an event gets destroyed.
 */
async function resolvePendingAction(
  action: PendingAction,
  text: string,
  options: TurnOptions,
): Promise<TurnResult | undefined> {
  const { clock, provider } = options;
  const timeZone = clock.timeZone();

  // BEFORE the recognised-command guard below, because the answer to 'מה לכתוב?' is
  // text to send, not an instruction to obey. 'מה קורה' is a perfectly good message
  // and must not be answered as a calendar question. See the branch for the details.
  if (action.kind === 'compose-message' && action.asking === 'body') {
    return composeMessage(action, text, options);
  }

  // A recognised command is a change of subject, not an answer. Letting it fall
  // through drops the pending confirmation, which is the safe direction: the worst
  // case is the user has to ask to delete again.
  if (parseCommand(text, clock).intent !== 'UNKNOWN') return undefined;

  if (action.kind === 'compose-message') {
    return composeMessage(action, text, options);
  }

  if (action.kind === 'confirm-suggestion') {
    const answer = readConfirmation(text);

    if (answer === 'no') {
      return {
        outcome: { kind: 'abandoned', message: 'בסדר, לא קבעתי כלום.' },
        state: clearPending(),
      };
    }

    if (answer === 'yes') {
      // Re-run the whole pipeline at the accepted hour, so the slot is checked again
      // against fresh events rather than trusted from a moment ago.
      const retry: ParsedCommand = {
        intent: 'CREATE',
        title: action.event.title,
        date: action.event.date,
        startTime: action.startTime,
        durationMinutes: action.event.durationMinutes,
        missing: [],
        ambiguities: [],
        confidence: 1,
        rawText: text,
        normalizedText: text,
      };

      const outcome = await executeCommand(retry, options);
      return { outcome, state: clearPending() };
    }

    return {
      outcome: {
        kind: 'abandoned',
        message: `לא הבנתי. לקבוע ב${'־'}${action.startTime}?`,
      },
      state: { action: { ...action, updatedAtMs: clock.now().getTime() } },
    };
  }

  if (action.kind === 'delete-scope') {
    const scope = readSeriesScope(text);

    if (readConfirmation(text) === 'no') {
      return {
        outcome: { kind: 'abandoned', message: 'בסדר, לא מחקתי כלום.' },
        state: clearPending(),
      };
    }

    if (scope === 'unclear') {
      // Never resolve this by default. One reading removes a single afternoon, the
      // other removes every one from here on.
      return {
        outcome: { kind: 'delete-scope', timeZone, event: action.event },
        state: { action: { ...action, updatedAtMs: clock.now().getTime() } },
      };
    }

    try {
      const outcome = await confirmDelete(action.event, { provider, clock }, scope);
      return { outcome, state: clearPending() };
    } catch (error) {
      return { outcome: toTurnFailure(error), state: clearPending() };
    }
  }

  if (action.kind === 'choose-message-channel') {
    if (readConfirmation(text) === 'no') {
      return {
        outcome: { kind: 'abandoned', message: 'בסדר, לא שלחתי כלום.' },
        state: clearPending(),
      };
    }

    const channel = readChannelChoice(text);

    if (channel === 'unclear') {
      // A bare 'כן' lands here too, and that is right: it answers a question that was
      // not asked. Which channel a message goes out on is not ours to assume.
      return {
        outcome: {
          kind: 'message-choose-channel',
          contact: action.contact,
          body: action.body,
          channels: action.channels,
        },
        state: { action: { ...action, updatedAtMs: clock.now().getTime() } },
      };
    }

    const messaging = options.messaging;
    if (messaging === undefined) {
      return {
        outcome: { kind: 'message-unclear', reason: 'not-available' },
        state: clearPending(),
      };
    }

    try {
      const outcome = await confirmMessage(action.contact, action.body, channel, messaging);
      return { outcome, state: clearPending() };
    } catch (error) {
      return { outcome: toTurnFailure(error), state: clearPending() };
    }
  }

  if (action.kind === 'confirm-message') {
    const answer = readConfirmation(text);

    if (answer === 'no') {
      return {
        outcome: { kind: 'abandoned', message: 'בסדר, לא שלחתי כלום.' },
        state: clearPending(),
      };
    }

    if (answer === 'yes') {
      const messaging = options.messaging;
      if (messaging === undefined) {
        return {
          outcome: { kind: 'message-unclear', reason: 'not-available' },
          state: clearPending(),
        };
      }

      try {
        const outcome = await confirmMessage(
          action.contact,
          action.body,
          action.channel,
          messaging,
        );
        return { outcome, state: clearPending() };
      } catch (error) {
        return { outcome: toTurnFailure(error), state: clearPending() };
      }
    }

    // Unclear. Ask again — an unrecognised noise is not permission to send.
    return {
      outcome: {
        kind: 'message-confirm',
        contact: action.contact,
        body: action.body,
        channel: action.channel,
      },
      state: { action: { ...action, updatedAtMs: clock.now().getTime() } },
    };
  }

  if (action.kind === 'update-scope') {
    const scope = readSeriesScope(text);

    if (readConfirmation(text) === 'no') {
      return {
        outcome: { kind: 'abandoned', message: 'בסדר, לא שיניתי כלום.' },
        state: clearPending(),
      };
    }

    if (scope === 'unclear') {
      // Same reasoning as the delete case: renaming one occurrence and renaming every
      // one are both plausible readings, so neither is assumed.
      return {
        outcome: {
          kind: 'update-scope',
          timeZone,
          event: action.event,
          change: action.change,
        },
        state: { action: { ...action, updatedAtMs: clock.now().getTime() } },
      };
    }

    try {
      const outcome = await applyChangeToEvent(
        action.event,
        action.change,
        [],
        { provider, clock },
        scope,
      );
      return { outcome, state: clearPending() };
    } catch (error) {
      return { outcome: toTurnFailure(error), state: clearPending() };
    }
  }

  if (action.kind === 'confirm-delete') {
    const answer = readConfirmation(text);

    if (answer === 'no') {
      return {
        outcome: { kind: 'abandoned', message: 'בסדר, לא מחקתי כלום.' },
        state: clearPending(),
      };
    }

    if (answer === 'yes') {
      try {
        const outcome = await confirmDelete(action.event, { provider, clock });
        return { outcome, state: clearPending() };
      } catch (error) {
        return { outcome: toTurnFailure(error), state: clearPending() };
      }
    }

    // Unclear. Ask again rather than treating silence-shaped input as consent.
    return {
      outcome: { kind: 'delete-confirm', timeZone, event: action.event },
      state: { action: { ...action, updatedAtMs: clock.now().getTime() } },
    };
  }

  const chosen = readChoice(text, action.matches, timeZone);

  if (chosen === undefined) {
    if (readConfirmation(text) === 'no') {
      return {
        outcome: { kind: 'abandoned', message: 'בסדר, לא שיניתי כלום.' },
        state: clearPending(),
      };
    }
    // Not a choice at all — let the ordinary pipeline handle it as a new command.
    return undefined;
  }

  if (action.intent === 'DELETE') {
    // A chosen event still has to be confirmed; picking is not consent to delete.
    return {
      outcome: { kind: 'delete-confirm', timeZone, event: chosen },
      state: {
        action: { kind: 'confirm-delete', event: chosen, updatedAtMs: clock.now().getTime() },
      },
    };
  }

  const change = action.change;
  if (change === undefined) {
    return { outcome: { kind: 'update-unclear', reason: 'no-change' }, state: clearPending() };
  }

  try {
    const outcome = await applyChangeToEvent(chosen, change, action.context, {
      provider,
      clock,
    });
    return { outcome, state: clearPending() };
  } catch (error) {
    return { outcome: toTurnFailure(error), state: clearPending() };
  }
}

/**
 * Take an answer to 'למי לשלוח?' or 'מה לכתוב?' and carry the request forward.
 *
 * The two questions are answered by deliberately different rules:
 *
 *   - **The text is taken literally, always.** 'מה קורה', 'תבטל הכל' and 'תקבע פגישה'
 *     are all things a person might genuinely want to send, so no word is treated as
 *     an instruction here. That is the opposite of every other pending action, and it
 *     is why this runs before the recognised-command guard.
 *
 *     There is no cancel word, on purpose. Any word reserved for escaping is a word
 *     that can no longer be sent, and silently dropping a message someone meant is
 *     worse than the alternative: the confirmation step is the escape hatch. A user
 *     who answers 'לא, עזוב' is asked whether to send 'לא, עזוב' and says no.
 *
 *   - **The recipient is matched against a closed set**, so a plain no can safely mean
 *     no — nobody is called 'לא' — and a recognised command still falls through as a
 *     change of subject, because this branch is reached after that guard.
 */
async function composeMessage(
  action: Extract<PendingAction, { kind: 'compose-message' }>,
  text: string,
  options: TurnOptions,
): Promise<TurnResult> {
  const { clock } = options;
  const answer = text.trim();

  if (action.asking === 'recipient' && readConfirmation(text) === 'no') {
    return {
      outcome: { kind: 'abandoned', message: 'בסדר, לא שלחתי כלום.' },
      state: clearPending(),
    };
  }

  const recipient = action.asking === 'recipient' ? answer : action.recipient;
  const body = action.asking === 'body' ? answer : action.body;

  // Still short of something. Ask for it and keep what we have.
  if (recipient === undefined || recipient.length === 0) {
    return {
      outcome: {
        kind: 'message-unclear',
        reason: 'no-recipient',
        ...(body !== undefined ? { body } : {}),
      },
      state: {
        action: {
          kind: 'compose-message',
          asking: 'recipient',
          ...(body !== undefined ? { body } : {}),
          updatedAtMs: clock.now().getTime(),
        },
      },
    };
  }

  if (body === undefined || body.length === 0) {
    return {
      outcome: { kind: 'message-unclear', reason: 'no-body', recipient },
      state: {
        action: {
          kind: 'compose-message',
          asking: 'body',
          recipient,
          updatedAtMs: clock.now().getTime(),
        },
      },
    };
  }

  const messaging = options.messaging;
  if (messaging === undefined) {
    return {
      outcome: { kind: 'message-unclear', reason: 'not-available' },
      state: clearPending(),
    };
  }

  // Rebuild a command and run the ordinary path, so contact matching, the channel
  // question and the confirmation all behave exactly as they do for a one-shot
  // request. There is no second, looser route to sending.
  const retry: ParsedCommand = {
    intent: 'SEND_MESSAGE',
    recipient,
    messageBody: body,
    missing: [],
    ambiguities: [],
    confidence: 1,
    rawText: text,
    normalizedText: text,
  };

  const outcome = startMessage(retry, messaging);
  const followUp = pendingActionFor(outcome, retry, clock);

  return followUp !== undefined
    ? { outcome, state: { action: followUp } }
    : { outcome, state: clearPending() };
}

function toTurnFailure(error: unknown): CommandOutcome {
  if (error instanceof CalendarError) {
    return { kind: 'failed', errorKind: error.kind, message: error.hebrewMessage };
  }
  return { kind: 'failed', errorKind: 'unknown', message: 'אירעה שגיאה. שום דבר לא שונה.' };
}
