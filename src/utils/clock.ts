/**
 * Injectable clock.
 *
 * RULE FOR THIS PROJECT: no module under src/services/parser, src/services/conflict,
 * src/services/validation or src/services/conversation may ever call `new Date()`,
 * `Date.now()` or read the ambient time zone directly. They receive a Clock.
 *
 * This is what makes "מחר בשש בערב" deterministically testable: the test pins the
 * clock to a known instant and asserts an exact calendar date, with no dependency on
 * when or where the test runs.
 */

/** IANA zone this assistant reasons in. All wall-clock times are Israel local time. */
export const APP_TIME_ZONE = 'Asia/Jerusalem';

export interface Clock {
  /** Current instant. */
  now(): Date;
  /** IANA time zone that wall-clock times should be interpreted in. */
  timeZone(): string;
}

/** The real clock. Only wired in at the application composition root. */
export const systemClock: Clock = {
  now: () => new Date(),
  timeZone: () => APP_TIME_ZONE,
};

/**
 * A clock frozen at a fixed instant, for tests.
 *
 * @param instant ISO 8601 string or Date. Include an explicit offset or `Z` —
 *                a bare "2026-09-13T18:00:00" is parsed in the runner's local zone
 *                and will make tests machine-dependent.
 * @param timeZone Zone to interpret wall-clock times in. Defaults to Asia/Jerusalem.
 */
export function fixedClock(instant: string | Date, timeZone: string = APP_TIME_ZONE): Clock {
  const frozen = typeof instant === 'string' ? new Date(instant) : new Date(instant.getTime());

  if (Number.isNaN(frozen.getTime())) {
    throw new Error(`fixedClock: invalid instant ${String(instant)}`);
  }

  return {
    now: () => new Date(frozen.getTime()),
    timeZone: () => timeZone,
  };
}

/**
 * A clock that starts at an instant and can be advanced by hand.
 * Useful for the conversation-state TTL tests in Stage 6.
 */
export function mutableClock(instant: string | Date, timeZone: string = APP_TIME_ZONE) {
  let current = typeof instant === 'string' ? new Date(instant) : new Date(instant.getTime());

  if (Number.isNaN(current.getTime())) {
    throw new Error(`mutableClock: invalid instant ${String(instant)}`);
  }

  return {
    now: () => new Date(current.getTime()),
    timeZone: () => timeZone,
    advanceBy(milliseconds: number): void {
      current = new Date(current.getTime() + milliseconds);
    },
    set(next: string | Date): void {
      current = typeof next === 'string' ? new Date(next) : new Date(next.getTime());
    },
  } satisfies Clock & {
    advanceBy(milliseconds: number): void;
    set(next: string | Date): void;
  };
}
