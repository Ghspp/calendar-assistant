/**
 * Event reminders.
 *
 * A PWA cannot schedule reliable background notifications: the Notification Triggers
 * API never shipped to stable Chrome, and Web Push needs a server to send the push,
 * which this project deliberately does not have.
 *
 * So we delegate. Every event we create carries its own reminder overrides, and the
 * native Google Calendar app on the phone fires a real OS notification at the right
 * time — with no infrastructure, and while this app is closed. The reminder belongs to
 * Google Calendar rather than to us, which is exactly why it is reliable.
 */

export type ReminderMethod = 'popup' | 'email';

export interface EventReminder {
  method: ReminderMethod;
  /** Minutes before the event start. Google allows 0 to 40320 (four weeks). */
  minutes: number;
}

/** Google's accepted range for a reminder offset. */
const MIN_REMINDER_MINUTES = 0;
const MAX_REMINDER_MINUTES = 40_320;

/** A popup ten minutes ahead — enough warning to walk to the thing. */
export const DEFAULT_REMINDERS: readonly EventReminder[] = [{ method: 'popup', minutes: 10 }];

export interface RemindersPayload {
  /** false means "use the overrides below instead of the calendar's defaults". */
  useDefault: boolean;
  overrides?: EventReminder[];
}

function isUsable(reminder: EventReminder): boolean {
  return (
    Number.isInteger(reminder.minutes) &&
    reminder.minutes >= MIN_REMINDER_MINUTES &&
    reminder.minutes <= MAX_REMINDER_MINUTES
  );
}

/**
 * Build the reminders field for a create request.
 *
 * An empty list falls back to the calendar's own defaults rather than creating an event
 * with no reminder at all — silently dropping a reminder is worse than using whatever
 * the user already configured in Google Calendar.
 */
export function buildReminders(
  reminders: readonly EventReminder[] = DEFAULT_REMINDERS,
): RemindersPayload {
  const usable = reminders.filter(isUsable);
  if (usable.length === 0) return { useDefault: true };

  // Google caps overrides at five per event.
  return { useDefault: false, overrides: usable.slice(0, 5) };
}
