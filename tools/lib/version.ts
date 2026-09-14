/**
 * Canonical prerelease/version truth (#1231 M16; umbrella #1155).
 *
 * This module is the ONE implementation of the release line-version contract
 * `x.y.z` with optional SemVer prerelease identifiers. Build metadata and `v`
 * prefixes are outside the release-line domain and are rejected, as is
 * surrounding whitespace; publication and npm verification import from here
 * instead of re-rolling parse/compare logic.
 *
 * Generic SemVer grammar comes from @std/semver; this module adds only the
 * strict release-line boundary, the lossless identifier list, and the
 * prerelease channel/predecessor helpers the npm lane needs.
 */
import { parse } from '@std/semver';

export interface LineVersion {
  major: number;
  minor: number;
  patch: number;
  /** Prerelease label (`alpha`, `beta`, `rc`, …); absent for stable lines. */
  prerelease?: string;
  /**
   * Ordered SemVer identifiers, retained losslessly. Comparison and
   * successor logic must go through these identifiers rather than the
   * convenience `prereleaseNumber`.
   */
  identifiers?: readonly string[];
  /**
   * Convenience: the SECOND prerelease identifier when numeric
   * (`0.44.0-beta.2.3` → 2), else 0.
   */
  prereleaseNumber: number;
}

/**
 * Strict line-version parser. @std/semver tolerates `v` prefixes, build
 * metadata and surrounding whitespace; the release-line contract does not.
 */
export function parseLineVersion(version: string): LineVersion {
  if (
    version.trim() !== version || version.startsWith('v') || version.startsWith('V') ||
    version.includes('+')
  ) {
    throw new Error(`Invalid semver version: ${version}`);
  }
  let semver;
  try {
    semver = parse(version);
  } catch {
    throw new Error(`Invalid semver version: ${version}`);
  }
  const identifiers = (semver.prerelease ?? []).map((identifier) => String(identifier));
  return {
    major: semver.major,
    minor: semver.minor,
    patch: semver.patch,
    prereleaseNumber: identifiers[1] !== undefined && /^\d+$/.test(identifiers[1])
      ? Number(identifiers[1])
      : 0,
    ...(identifiers.length > 0 ? { prerelease: identifiers[0], identifiers } : {}),
  };
}

export function formatLineVersion(version: LineVersion): string {
  const base = `${version.major}.${version.minor}.${version.patch}`;
  return version.identifiers
    ? `${base}-${version.identifiers.join('.')}`
    : version.prerelease
    ? `${base}-${version.prerelease}.${version.prereleaseNumber}`
    : base;
}

/** Non-throwing variant for gates that probe arbitrary strings. */
export function tryParseLineVersion(version: string): LineVersion | undefined {
  try {
    return parseLineVersion(version);
  } catch {
    return undefined;
  }
}

/** Base/label/sequence of a prerelease line version; undefined for stable or invalid input. */
export function prereleaseParts(
  version: string,
): { base: string; name: string; num: number } | undefined {
  const parsed = tryParseLineVersion(version);
  if (parsed?.prerelease === undefined) return undefined;
  return {
    base: `${parsed.major}.${parsed.minor}.${parsed.patch}`,
    name: parsed.prerelease,
    num: parsed.prereleaseNumber,
  };
}

/** The npm dist-tag channels the release line publishes prereleases under (#607). */
export const PRERELEASE_CHANNELS = ['alpha', 'beta', 'rc'] as const;
export type PrereleaseChannel = typeof PRERELEASE_CHANNELS[number];

/**
 * The prerelease channel of a line version when its label is a publishable
 * channel; undefined for stable lines, invalid input, or non-channel labels.
 */
export function prereleaseChannel(version: string): PrereleaseChannel | undefined {
  const name = prereleaseParts(version)?.name;
  if (name === 'alpha' || name === 'beta' || name === 'rc') return name;
  return undefined;
}

/** Previous numeric prerelease on the same line, including multi-identifier checkpoints. */
export function previousPrereleaseVersion(version: string): string | null {
  const parsed = parseLineVersion(version);
  if (!parsed.identifiers || !prereleaseChannel(version)) return null;
  const ids = [...parsed.identifiers];
  const last = ids[ids.length - 1];
  if (!/^\d+$/.test(last)) return null;
  const n = BigInt(last);
  if (n <= 1n) {
    if (ids.length <= 2) return null;
    ids.pop();
  } else ids[ids.length - 1] = String(n - 1n);
  return formatLineVersion({ ...parsed, identifiers: ids });
}

/** Rejects any version outside the strict release-line contract. */
export function assertPublicReleaseVersion(version: string): void {
  parseLineVersion(version);
}
