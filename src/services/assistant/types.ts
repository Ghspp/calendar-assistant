/**
 * Outcome of handling one command.
 *
 * A discriminated union so the responder must account for every case, and so a caller
 * can tell "we created it" from "we refused" without inspecting strings.
 */

import type {
  AllDayCalendarEvent,
  CalendarEvent,
  StructuredEvent,
  TimedCalendarEvent,
} from '../../types/calendar';
import type { DateRange, ParsedCommand } from '../../types/parser';
import type { Conflict } from '../conflict/detectConflicts';
import type { FreeSlot } from '../conflict/findFreeSlots';
import type { CreatedEvent } from '../calendar/CalendarProvider';
import type { ValidationError } from '../validation/validateEvent';
import type { CalendarErrorKind } from '../calendar/errors';
import type { UpdateChange } from './updateParsing';
import type { Contact } from '../../storage/contacts';

/**
 * One reading of an availability question.
 *
 * There are two of these when the hour was ambiguous. A read-only question does not
 * need to pick — see the note on `availability` below.
 */
export interface AvailabilityReading {
  startTime: string;
  endTime: string;
  free: boolean;
  conflicts: Conflict[];
}

export type CommandOutcome =
  /** The event was written to the calendar. */
  | {
      kind: 'created';
      event: StructuredEvent;
      created: CreatedEvent;
      /** Overlapping all-day events — worth mentioning, never a blocker. */
      informational: AllDayCalendarEvent[];
    }
  /** The slot was taken. NOTHING was written. */
  | {
      kind: 'conflict';
      event: StructuredEvent;
      conflicts: Conflict[];
      /**
       * A gap that would have worked. Purely a suggestion — the assistant never moves
       * an event on its own, so nothing happens until the user accepts it.
       */
      suggestion?: FreeSlot;
    }
  /** 'בזמן הפנוי הראשון' found no opening long enough. Nothing was written. */
  | { kind: 'no-free-slot'; date: string; timeZone: string }
  /** Something is missing or ambiguous; the user has to answer first. */
  | { kind: 'needs-input'; parsed: ParsedCommand; errors: ValidationError[] }
  /** What is on the calendar for a day or a week. Read-only. */
  | {
      kind: 'agenda';
      timeZone: string;
      date?: string;
      dateRange?: DateRange;
      events: CalendarEvent[];
    }
  /**
   * Whether a particular slot is free. Read-only.
   *
   * When the hour was ambiguous this carries BOTH readings rather than asking a
   * clarifying question. Nothing is being written, so answering both is strictly more
   * useful than a round trip — and it still never guesses which one was meant.
   */
  | {
      kind: 'availability';
      timeZone: string;
      date: string;
      readings: AvailabilityReading[];
    }
  /** Gaps long enough to hold something. Read-only. */
  | {
      kind: 'free-slots';
      timeZone: string;
      date: string;
      durationMinutes: number;
      slots: FreeSlot[];
      /** e.g. 'בערב', when the search was narrowed to part of the day. */
      dayPartLabel?: string;
    }
  /** Events matching a name the user asked about. Read-only. */
  | {
      kind: 'event-search';
      timeZone: string;
      query: string;
      matches: CalendarEvent[];
      /** How many days ahead were searched, for an honest "not found" answer. */
      daysSearched: number;
    }
  /** An existing event was changed. */
  | {
      kind: 'updated';
      timeZone: string;
      updated: CreatedEvent;
      /** Whether one occurrence changed, or the whole repeating series. */
      scope: 'instance' | 'series';
      previousTitle: string;
      newTitle: string;
      previousStart: string;
      previousEnd: string;
      newStart: string;
      newEnd: string;
    }
  /** More than one event matched. NOTHING was changed — the user must choose. */
  | {
      kind: 'update-ambiguous';
      timeZone: string;
      target: string;
      matches: TimedCalendarEvent[];
    }
  /**
   * The matched event repeats, and which occurrences to change has not been said.
   *
   * NOTHING is changed. Renaming one afternoon and renaming every afternoon are
   * different enough that the question is asked rather than answered by a default.
   */
  | {
      kind: 'update-scope';
      timeZone: string;
      event: TimedCalendarEvent;
      change: UpdateChange;
    }
  /** No event matched the name. Nothing was changed. */
  | { kind: 'update-not-found'; timeZone: string; target: string }
  /** Moving would have collided with something else. Nothing was changed. */
  | {
      kind: 'update-conflict';
      timeZone: string;
      event: TimedCalendarEvent;
      conflicts: Conflict[];
    }
  /** The request could not be read as a change. Nothing was changed. */
  | {
      kind: 'update-unclear';
      reason: 'no-target' | 'no-change' | 'word-not-in-title';
      target?: string;
      word?: string;
    }
  /** An event was deleted. Only reachable after an explicit confirmation. */
  | {
      kind: 'deleted';
      timeZone: string;
      event: TimedCalendarEvent;
      /** Whether one occurrence went, or the whole repeating series. */
      scope: 'instance' | 'series';
    }
  /** One event matched and we are waiting for a yes before removing it. */
  | { kind: 'delete-confirm'; timeZone: string; event: TimedCalendarEvent }
  /**
   * The match repeats, and which occurrences to remove has not been said.
   *
   * NOTHING is deleted. Both readings are destructive in different ways, so the
   * question is asked rather than resolved by a default.
   */
  | { kind: 'delete-scope'; timeZone: string; event: TimedCalendarEvent }
  /** Several matched. NOTHING was deleted — the user must choose. */
  | {
      kind: 'delete-ambiguous';
      timeZone: string;
      target: string;
      matches: TimedCalendarEvent[];
    }
  /** No event matched. Nothing was deleted. */
  | { kind: 'delete-not-found'; timeZone: string; target: string }
  /** We could not tell what to delete. Nothing was deleted. */
  | { kind: 'delete-unclear' }
  /**
   * A message is composed and waiting for a yes. NOTHING has been sent.
   *
   * Reaching this outcome is unconditional for a send request — there is no path that
   * delivers a message without the user first seeing the recipient and the exact text.
   * A message cannot be recalled, so the confirmation is not optional the way it might
   * be for a reversible action.
   */
  | {
      kind: 'message-confirm';
      contact: Contact;
      body: string;
      channel: 'gmail' | 'whatsapp';
      /** The user asked to send it later, which this app cannot do. Said, not ignored. */
      cannotSchedule?: true;
    }
  /** A channel was named that this contact cannot be reached on. Nothing was sent. */
  | {
      kind: 'message-channel-unavailable';
      contact: Contact;
      channel: 'gmail' | 'whatsapp';
    }
  /**
   * The contact can be reached two ways, so the question names both. NOTHING is sent.
   *
   * The message itself is in the question, so naming a channel both picks and
   * confirms — one turn, and still nothing decided on the user's behalf.
   */
  | {
      kind: 'message-choose-channel';
      contact: Contact;
      body: string;
      channels: Array<'gmail' | 'whatsapp'>;
      cannotSchedule?: true;
    }
  /** The message went out by itself. Only reachable after an explicit confirmation. */
  | { kind: 'message-sent'; contact: Contact; body: string }
  /**
   * WhatsApp cannot be sent for the user, so the chat is opened with the text ready.
   *
   * Reported separately from 'message-sent' because it is NOT sent — the user still
   * has to press send, and saying otherwise would be a lie about what happened.
   */
  | { kind: 'message-handoff'; contact: Contact; body: string; url: string }
  /** No contact by that name. Nothing was sent. */
  | { kind: 'message-contact-not-found'; name: string }
  /** Several contacts matched. NOTHING was sent — the user must choose. */
  | {
      kind: 'message-contact-ambiguous';
      name: string;
      matches: Contact[];
      /** Held so answering the question finishes the request rather than restarting it. */
      body: string;
    }
  /** The contact has neither an email nor a phone. Nothing was sent. */
  | { kind: 'message-no-channel'; contact: Contact }
  /** The request could not be read as a message. Nothing was sent. */
  | {
      kind: 'message-unclear';
      reason: 'no-recipient' | 'no-body' | 'not-available' | 'no-mail-permission';
      /**
       * Whatever was already understood, carried so the conversation layer can hold it
       * while it asks for the rest. Without this the question is a dead end: the
       * assistant asks 'מה לכתוב?' and has already forgotten who it was writing to.
       */
      recipient?: string;
      body?: string;
    }
  /** The user declined a pending confirmation, or backed out of a choice. */
  | { kind: 'abandoned'; message: string }
  /** A command we understood but do not act on. */
  | { kind: 'unsupported'; parsed: ParsedCommand }
  /** Auth or API failure. */
  | { kind: 'failed'; errorKind: CalendarErrorKind | 'unknown'; message: string };
