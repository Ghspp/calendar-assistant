import { describe, expect, it } from 'vitest';
import { DEFAULT_REMINDERS, buildReminders } from './reminders';

describe('buildReminders', () => {
  it('defaults to a popup ten minutes before', () => {
    expect(buildReminders()).toEqual({
      useDefault: false,
      overrides: [{ method: 'popup', minutes: 10 }],
    });
  });

  it('exposes the default for callers that want to show it', () => {
    expect(DEFAULT_REMINDERS).toEqual([{ method: 'popup', minutes: 10 }]);
  });

  it('accepts custom reminders', () => {
    const payload = buildReminders([
      { method: 'popup', minutes: 30 },
      { method: 'email', minutes: 1440 },
    ]);
    expect(payload.overrides).toHaveLength(2);
    expect(payload.useDefault).toBe(false);
  });

  it('accepts a reminder at the moment the event starts', () => {
    expect(buildReminders([{ method: 'popup', minutes: 0 }]).overrides).toEqual([
      { method: 'popup', minutes: 0 },
    ]);
  });

  it('falls back to the calendar defaults rather than creating a silent event', () => {
    // Dropping the reminder entirely would be worse than using whatever the user
    // already configured in Google Calendar.
    expect(buildReminders([])).toEqual({ useDefault: true });
  });

  it('drops out-of-range offsets', () => {
    expect(buildReminders([{ method: 'popup', minutes: -5 }])).toEqual({ useDefault: true });
    expect(buildReminders([{ method: 'popup', minutes: 40_321 }])).toEqual({ useDefault: true });
  });

  it('drops a fractional offset', () => {
    expect(buildReminders([{ method: 'popup', minutes: 10.5 }])).toEqual({ useDefault: true });
  });

  it('keeps the valid reminders when only some are bad', () => {
    const payload = buildReminders([
      { method: 'popup', minutes: -1 },
      { method: 'popup', minutes: 15 },
    ]);
    expect(payload.overrides).toEqual([{ method: 'popup', minutes: 15 }]);
  });

  it('caps at the five overrides Google allows', () => {
    const many = Array.from({ length: 8 }, (_, index) => ({
      method: 'popup' as const,
      minutes: index + 1,
    }));
    expect(buildReminders(many).overrides).toHaveLength(5);
  });
});
