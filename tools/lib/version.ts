/**
 * Canonical prerelease/version truth (#1231 M16; umbrella #1155).
 *
 * This module is the ONE implementation of the release line-version contract
 * `x.y.z` with optional SemVer prerelease identifiers (without build metadata
 * or `v` prefixes; core numbers must be safe integers). Publication and npm
 * verification import from here instead of re-rolling parse/compare regexes.
 *
 * Import-free on purpose because related release constants are loaded by Nitro/jiti under Node
 * (packages/adapter-vite/__fixtures__/nitro-proof/nitro.config.ts), so nothing
 * here may pull jsr:/npm: specifiers (no @std/semver). The hand-rolled grammar
 * below is exactly the strict domain every consumer already enforced on top of
 * @std/semver.
 */

/**
 * First historical release line covered by the immutable-tag policy.
 */
export const FIRST_TAGGED_VERSION = '0.41.0-alpha.14';

export interface LineVersion {
  major: number;
  minor: number;
  patch: number;
  /** Prerelease label (`alpha`, `beta`, `rc`, …); absent for stable lines. */
  prerelease?: string;
  /**
   * Legacy channel-level convenience: the SECOND prerelease identifier when
   * numeric (`0.44.0-beta.2.3` → 2), else 0. This is NOT the full prerelease
   * identity — multi-identifier checkpoints (beta.2.1) live only in
   * `identifiers`; succession and comparison must go through `identifiers`,
   * `compareVersions`, `nextCheckpointVersion` or `nextProductStageVersion`.
   */
  prereleaseNumber: number;
  /** Ordered SemVer identifiers, retained losslessly. */
  identifiers?: readonly string[];
}

const LINE_VERSION_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;

/** SemVer prereleases, intentionally excluding build metadata and v prefixes. */
export function parseLineVersion(version: string): LineVersion {
  const match = version.match(LINE_VERSION_RE);
  if (!match) throw new Error(`Invalid semver version: ${version}`);
  const [, major, minor, patch, pre] = match;
  const identifiers = pre?.split('.');
  if (
    [major, minor, patch].some((n) => !Number.isSafeInteger(Number(n))) ||
    identifiers?.some((id) => /^0\d+$/.test(id))
  ) throw new Error(`Invalid semver version: ${version}`);
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prereleaseNumber: identifiers && /^\d+$/.test(identifiers[1] ?? '')
      ? Number(identifiers[1])
      : 0,
    ...(identifiers ? { prerelease: identifiers[0], identifiers } : {}),
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

/**
 * The prerelease sequence number when the version's label equals `name`
 * (e.g. the `alpha` number of `0.41.0-alpha.7`); undefined otherwise. The
 * string form is what the stale-claim regexes interpolate.
 */
export function prereleaseSequence(version: string, name: string): string | undefined {
  const parts = prereleaseParts(version);
  return parts?.name === name ? String(parts.num) : undefined;
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

/** Numeric compare over the line-version domain; prerelease < stable at equal base. */
export function compareVersions(a: string, b: string): number {
  const pa = parseLineVersion(a);
  const pb = parseLineVersion(b);
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1;
  }
  if (pa.prerelease === undefined && pb.prerelease === undefined) return 0;
  if (pa.prerelease === undefined) return 1;
  if (pb.prerelease === undefined) return -1;
  const left = pa.identifiers!;
  const right = pb.identifiers!;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i] === undefined) return -1;
    if (right[i] === undefined) return 1;
    if (left[i] === right[i]) continue;
    const ln = /^\d+$/.test(left[i]);
    const rn = /^\d+$/.test(right[i]);
    if (ln !== rn) return ln ? -1 : 1;
    if (ln && left[i].length !== right[i].length) return left[i].length < right[i].length ? -1 : 1;
    return left[i] < right[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Next patch target: a prerelease line advances its prerelease counter
 * (0.44.0-beta.1 → 0.44.0-beta.2), a stable line its patch (0.43.3 → 0.43.4).
 */
export function nextPatchVersion(version: string): string {
  const parsed = parseLineVersion(version);
  if (version === '0.44.0-beta.2' || version.startsWith('0.44.0-beta.2.')) {
    return nextCheckpointVersion(version);
  }
  if (parsed.identifiers) {
    const ids = [...parsed.identifiers];
    const last = ids[ids.length - 1];
    if (/^\d+$/.test(last)) ids[ids.length - 1] = String(BigInt(last) + 1n);
    else ids.push('1');
    return formatLineVersion({ ...parsed, identifiers: ids });
  }
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}

/** Accepts the operator shorthand `x.y.z-alphaN` and normalizes to `x.y.z-alpha.N`. */
export function normalizeReleaseVersion(version: string): string {
  return version.replace(/-(alpha|beta|rc)(\d+)$/u, '-$1.$2');
}

/** Engineering checkpoints are deliberately finite, distinct from SemVer order. */
export function nextCheckpointVersion(version: string): string {
  const checkpoints = ['0.44.0-beta.2', '0.44.0-beta.2.1', '0.44.0-beta.2.2', '0.44.0-beta.2.3'];
  const index = checkpoints.indexOf(version);
  if (index < 0 || index === checkpoints.length - 1) {
    throw new Error(`No next Beta checkpoint for ${version}; product-stage admission is required`);
  }
  return checkpoints[index + 1];
}

/** Approved product-stage transition; this function grants no release authority. */
export function nextProductStageVersion(version: string): string {
  if (version === '0.44.0-beta.2.3') return '1.0.0-alpha.1';
  throw new Error(`No admitted product-stage successor for ${version}`);
}

export function isInternalAlphaWorkspace(version: string): boolean {
  const parsed = tryParseLineVersion(version);
  return parsed?.major === 0 && parsed.minor === 44 && parsed.patch === 0 &&
    parsed.identifiers?.length === 2 && parsed.prerelease === 'alpha' &&
    /^\d+$/.test(parsed.identifiers[1]) && parsed.prereleaseNumber <= 10;
}

/** Previous numeric prerelease on the same line, including Beta checkpoints. */
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

/** Admission classification only: all existing verification gates still apply. */
export function assertPublicReleaseVersion(version: string): void {
  parseLineVersion(version);
  if (isInternalAlphaWorkspace(version)) {
    throw new Error(`Historical internal Alpha workspace is not publishable: ${version}`);
  }
}
