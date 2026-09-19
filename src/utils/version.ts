/**
 * Turning a build number into a version people can read.
 *
 * The deploy workflow passes GitHub's run number, which only ever counts upward and
 * has no meaning to anyone. This maps it onto a familiar major.minor pair.
 *
 * Kept as a tested function rather than an expression inside the build config,
 * because an off-by-one here shows the wrong version on every screen and would be
 * noticed long before it was understood.
 */

/**
 * The run number that should read as 1.0.
 *
 * Runs before this one were earlier deploys of the same app; they are simply behind
 * the versioning scheme and clamp to 1.0.
 */
export const FIRST_NUMBERED_RUN = 12;

/** Minor versions per major. 1.9 is followed by 2.0, not by 1.10. */
const MINORS_PER_MAJOR = 10;

/**
 * '1.0', '1.1', … '1.9', '2.0', …
 *
 * Anything that is not a run number — a local build, an empty variable — is reported
 * as 'dev', so a development build is never mistaken for a release.
 */
export function formatVersion(runNumber: string | number | undefined): string {
  const parsed = typeof runNumber === 'number' ? runNumber : Number.parseInt(runNumber ?? '', 10);
  if (!Number.isFinite(parsed)) return 'dev';

  const offset = Math.max(0, parsed - FIRST_NUMBERED_RUN);
  const major = 1 + Math.floor(offset / MINORS_PER_MAJOR);
  const minor = offset % MINORS_PER_MAJOR;

  return `${major}.${minor}`;
}
