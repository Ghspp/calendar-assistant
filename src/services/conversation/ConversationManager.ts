/**
 * Short-term conversation state.
 *
 * Holds one half-finished scheduling request so that 'מחר' → 'בשש' → 'בערב' → 'לשעה'
 * accumulates into a single event. Pure and clock-injected: the state goes in, a new
 * state comes out, nothing is stored in the module.
 *
 * Deliberately NOT a general dialogue system. It tracks exactly one pending CREATE, it
 * forgets it after a few minutes, and any recognised command verb abandons it — because
 * a stale half-request silently absorbing a new command is far worse than asking again.
 */

import type { Clock } from '../../utils/clock';
import type { ParsedCommand, SlotName } from '../../types/parser';
import type {
  CalendarEvent,
  StructuredEvent,
  TimedCalendarEvent,
} from '../../types/calendar';
import type { UpdateChange } from '../assistant/updateParsing';
import type { Contact } from '../../storage/contacts';
import { parseCommand } from '../parser';
import {
  isCancellation,
  mergeAnswer,
  slotsFromCommand,
  toParsedCommand,
  type CommandSlots,
} from './slots';

/**
 * How long a half-finished request survives.
 *
 * Long enough to answer two or three questions, short enough that yesterday's abandoned
 * request cannot capture today's first words.
 */
export const PENDING_TTL_MS = 3 * 60 * 1000;

export interface PendingRequest {
  slots: CommandSlots;
  /** What the last question was about, so the answer can be interpreted. */
  asking: SlotName | 'ambiguity';
  candidates?: readonly string[];
  /** The utterance that started the request, kept for context and debugging. */
  originalText: string;
  updatedAtMs: number;
}

/**
 * An action waiting on the user, distinct from a half-filled CREATE.
 *
 * `choose` means several events matched and the assistant listed them. `confirm-delete`
 * means one event was singled out and the assistant is waiting for a yes. Neither has
 * touched the calendar yet.
 */
export type PendingAction =
  | {
      kind: 'choose';
      /** What to do once an event is picked. */
      intent: 'UPDATE' | 'DELETE';
      change?: UpdateChange;
      matches: TimedCalendarEvent[];
      /** The events loaded alongside, so a move re-checks conflicts against them. */
      context: CalendarEvent[];
      updatedAtMs: number;
    }
  | { kind: 'confirm-delete'; event: TimedCalendarEvent; updatedAtMs: number }
  /**
   * A repeating event was matched and the scope is still open: this occurrence, or
   * the whole series. Nothing has been deleted.
   */
  | { kind: 'delete-scope'; event: TimedCalendarEvent; updatedAtMs: number }
  /**
   * The same open question for a change rather than a deletion. The change is held
   * here, unapplied, until the scope is settled. Only non-move changes reach this, so
   * no surrounding events need to be carried for a conflict re-check.
   */
  | {
      kind: 'update-scope';
      event: TimedCalendarEvent;
      change: UpdateChange;
      updatedAtMs: number;
    }
  /**
   * A message is half-stated: one of the recipient and the text is still missing, and
   * the assistant has asked for it. NOTHING has been sent.
   *
   * This exists because asking a question without recording it is worse than not
   * asking at all — the answer arrives as a brand-new command and is refused.
   */
  | {
      kind: 'compose-message';
      recipient?: string;
      body?: string;
      /** Which of the two was just asked for, so the answer is read correctly. */
      asking: 'recipient' | 'body';
      updatedAtMs: number;
    }
  /**
   * A message is composed, but the contact can be reached two ways and which one has
   * not been said. NOTHING has been sent.
   *
   * Naming a channel resolves this AND confirms, because the question quoted the
   * message in full — so there is no second yes to collect.
   */
  | {
      kind: 'choose-message-channel';
      contact: Contact;
      body: string;
      channels: Array<'gmail' | 'whatsapp'>;
      updatedAtMs: number;
    }
  /**
   * A message is composed and waiting for a yes. NOTHING has been sent.
   *
   * The exact text is held here rather than re-derived on confirmation, so what goes
   * out is word-for-word what the user was read back.
   */
  | {
      kind: 'confirm-message';
      contact: Contact;
      body: string;
      channel: 'gmail' | 'whatsapp';
      updatedAtMs: number;
    }
  /**
   * An alternative slot was offered after a conflict. NOTHING has been written; the
   * offer becomes an action only on an explicit yes.
   */
  | {
      kind: 'confirm-suggestion';
      event: StructuredEvent;
      startTime: string;
      updatedAtMs: number;
    };

export interface ConversationState {
  pending?: PendingRequest;
  action?: PendingAction;
}

export const emptyConversation: ConversationState = {};

export type TurnPlan =
  /** Run this command through the normal pipeline. */
  | { kind: 'command'; command: ParsedCommand; continuing: boolean }
  /** The user backed out. Nothing to run. */
  | { kind: 'cancelled' }
  /**
   * A pending question was not answered by this utterance.
   *
   * Crucially this is NOT the same as a fresh command: nothing is run, and the pending
   * request is kept so the user can try again. Folding an unanswerable utterance into
   * the pending request is how a misunderstood edit turns into a brand new event.
   */
  | { kind: 'not-understood'; pending: PendingRequest };

export function isExpired(pending: PendingRequest, clock: Clock): boolean {
  return clock.now().getTime() - pending.updatedAtMs > PENDING_TTL_MS;
}

/**
 * Decide what this utterance means, given what came before.
 *
 * An utterance is treated as an ANSWER only when all of these hold: a request is
 * pending, it has not expired, and the utterance carries no command verb of its own.
 * Anything else starts fresh.
 */
export function planTurn(
  text: string,
  state: ConversationState,
  clock: Clock,
): TurnPlan {
  const pending = state.pending;

  if (pending !== undefined && !isExpired(pending, clock) && isCancellation(text)) {
    return { kind: 'cancelled' };
  }

  const fresh = parseCommand(text, clock);

  const continuing =
    pending !== undefined &&
    !isExpired(pending, clock) &&
    // A recognised verb means a new instruction, not an answer. Without this check,
    // 'בטל את הפגישה' mid-conversation would be folded in as a title.
    fresh.intent === 'UNKNOWN';

  if (!continuing || pending === undefined) {
    return { kind: 'command', command: fresh, continuing: false };
  }

  const merged = mergeAnswer(
    pending.slots,
    text,
    {
      asking: pending.asking,
      ...(pending.candidates !== undefined ? { candidates: pending.candidates } : {}),
    },
    clock,
  );

  // An answer has to actually answer the question. If the slot we asked about is still
  // empty, this utterance was something else — and absorbing it would let a request the
  // assistant did not understand quietly become a new calendar event.
  if (!answersQuestion(merged, pending)) {
    return { kind: 'not-understood', pending };
  }

  return {
    kind: 'command',
    command: toParsedCommand(merged, `${pending.originalText} ${text}`.trim()),
    continuing: true,
  };
}

/** Did the merge fill the slot the outstanding question was about? */
function answersQuestion(merged: CommandSlots, pending: PendingRequest): boolean {
  switch (pending.asking) {
    case 'ambiguity':
      // Either the hour got settled, or a different ambiguous hour was offered.
      return (
        merged.startTime !== undefined ||
        merged.pendingAmbiguity?.candidates.join() !== pending.candidates?.join()
      );
    case 'startTime':
      return merged.startTime !== undefined || merged.pendingAmbiguity !== undefined;
    case 'date':
      return merged.date !== undefined;
    case 'duration':
      return merged.durationMinutes !== undefined || merged.endTime !== undefined;
    case 'title':
      // A title answer is taken literally, so anything at all counts.
      return merged.title !== undefined;
    case 'recipient':
    case 'messageBody':
      // This accumulator only ever builds a CREATE; a half-finished send is tracked as
      // a PendingAction instead. Refusing here is the safe direction anyway — it keeps
      // the utterance from being folded into a scheduling request.
      return false;
  }
}

/**
 * Remember a request that still needs an answer.
 *
 * `asking` comes from the validator's first error, so the slot we record always matches
 * the question the user actually heard.
 */
export function rememberPending(
  command: ParsedCommand,
  asking: SlotName | 'ambiguity',
  candidates: readonly string[] | undefined,
  originalText: string,
  clock: Clock,
): ConversationState {
  return {
    pending: {
      slots: slotsFromCommand(command),
      asking,
      ...(candidates !== undefined ? { candidates } : {}),
      originalText,
      updatedAtMs: clock.now().getTime(),
    },
  };
}

/** Forget everything. Used once a request completes, fails, or is abandoned. */
export function clearPending(): ConversationState {
  return {};
}

/** True when a pending action has gone stale and should be forgotten. */
export function isActionExpired(action: PendingAction, clock: Clock): boolean {
  return clock.now().getTime() - action.updatedAtMs > PENDING_TTL_MS;
}
