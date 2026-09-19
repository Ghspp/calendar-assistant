import { describe, expect, it } from 'vitest';
import { FIRST_NUMBERED_RUN, formatVersion } from './version';

describe('formatVersion', () => {
  it('starts at 1.0', () => {
    expect(formatVersion(FIRST_NUMBERED_RUN)).toBe('1.0');
  });

  it('counts up one minor per deploy', () => {
    const versions = [0, 1, 2, 3].map((step) => formatVersion(FIRST_NUMBERED_RUN + step));
    expect(versions).toEqual(['1.0', '1.1', '1.2', '1.3']);
  });

  it('rolls over to the next major after .9', () => {
    // 1.10 reads as older than 1.9 to most people, so it never appears.
    expect(formatVersion(FIRST_NUMBERED_RUN + 9)).toBe('1.9');
    expect(formatVersion(FIRST_NUMBERED_RUN + 10)).toBe('2.0');
    expect(formatVersion(FIRST_NUMBERED_RUN + 11)).toBe('2.1');
  });

  it('keeps counting across several majors', () => {
    expect(formatVersion(FIRST_NUMBERED_RUN + 25)).toBe('3.5');
    expect(formatVersion(FIRST_NUMBERED_RUN + 100)).toBe('11.0');
  });

  it('clamps deploys from before the scheme began', () => {
    expect(formatVersion(FIRST_NUMBERED_RUN - 1)).toBe('1.0');
    expect(formatVersion(1)).toBe('1.0');
  });

  it('accepts the string a build variable actually supplies', () => {
    expect(formatVersion(String(FIRST_NUMBERED_RUN + 3))).toBe('1.3');
  });

  it.each([undefined, '', 'abc', 'v2'])('reports %s as a development build', (input) => {
    expect(formatVersion(input)).toBe('dev');
  });

  it('never returns an empty string', () => {
    for (const input of [undefined, '', 0, -5, 999]) {
      expect(formatVersion(input).length).toBeGreaterThan(0);
    }
  });
});
