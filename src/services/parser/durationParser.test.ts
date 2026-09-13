import { describe, expect, it } from 'vitest';
import { parseCommand } from './index';
import { fixedClock } from '../../utils/clock';

const CLOCK = fixedClock('2026-09-13T09:00:00Z');

function durationOf(text: string): number | undefined {
  return parseCommand(text, CLOCK).durationMinutes;
}

describe('duration parsing', () => {
  it('parses לשעה as 60', () => {
    expect(durationOf('תקבע לי פגישה מחר ב-18:00 לשעה')).toBe(60);
  });

  it('parses לשעתיים as 120', () => {
    expect(durationOf('תקבע לי פגישה מחר ב-18:00 לשעתיים')).toBe(120);
  });

  it('parses לחצי שעה as 30', () => {
    expect(durationOf('תקבע לי פגישה מחר ב-18:00 לחצי שעה')).toBe(30);
  });

  it('parses לרבע שעה as 15', () => {
    expect(durationOf('תקבע לי פגישה מחר ב-18:00 לרבע שעה')).toBe(15);
  });

  it('parses ל-30 דקות', () => {
    expect(durationOf('תקבע לי פגישה מחר ב-18:00 ל-30 דקות')).toBe(30);
  });

  it('parses ל-90 דקות', () => {
    expect(durationOf('תקבע לי פגישה מחר ב-18:00 ל-90 דקות')).toBe(90);
  });

  it('parses ל-45 דקות', () => {
    expect(durationOf('תקבע לי פגישה מחר ב-18:00 ל-45 דקות')).toBe(45);
  });

  it('parses לשעה וחצי as 90', () => {
    expect(durationOf('תקבע לי פגישה מחר ב-18:00 לשעה וחצי')).toBe(90);
  });

  it('parses לשעתיים וחצי as 150', () => {
    expect(durationOf('תקבע לי פגישה מחר ב-18:00 לשעתיים וחצי')).toBe(150);
  });

  it('parses לשלוש שעות as 180', () => {
    expect(durationOf('תקבע לי פגישה מחר ב-18:00 לשלוש שעות')).toBe(180);
  });

  it('parses למשך שעה', () => {
    expect(durationOf('תקבע לי פגישה מחר ב-18:00 למשך שעה')).toBe(60);
  });

  it('parses של שעתיים', () => {
    expect(durationOf('מצא לי שעה פנויה של שעתיים מחר')).toBe(120);
  });

  it('reports no duration when none was given', () => {
    expect(durationOf('תקבע לי פגישה עם דניאל מחר בשש')).toBeUndefined();
  });
});

describe('duration versus clock time', () => {
  it('reads בשעה as a clock time, not a one-hour duration', () => {
    const parsed = parseCommand('תקבע לי אימון מחר בשעה 17:00', CLOCK);
    expect(parsed.startTime).toBe('17:00');
    expect(parsed.durationMinutes).toBeUndefined();
  });

  it('reads לשעה followed by a number as a clock time', () => {
    // 'תעביר לשעה 8' means move it to eight o'clock, not make it one hour long.
    const parsed = parseCommand('תעביר את הפגישה מחר לשעה 8', CLOCK);
    expect(parsed.durationMinutes).toBeUndefined();
    expect(parsed.ambiguities[0]?.candidates).toEqual(['08:00', '20:00']);
  });

  it('reads a trailing לשעה as a duration', () => {
    const parsed = parseCommand('שים לי חוג כדורגל מחר בחמש לשעה', CLOCK);
    expect(parsed.durationMinutes).toBe(60);
  });

  it('is not confused by של in a possessive phrase', () => {
    const parsed = parseCommand('תבטל את הפגישה של דניאל מחר', CLOCK);
    expect(parsed.durationMinutes).toBeUndefined();
    expect(parsed.title).toBe('הפגישה של דניאל');
  });
});
