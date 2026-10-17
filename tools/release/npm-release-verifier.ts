/**
 * npm registry verification for a published release.
 *
 * Post-publish truth: exact-version and dist-tag checks with a bounded retry
 * schedule, plus the same-line predecessor continuity invariant (#869-2.5) so
 * a release can never skip a number. Read-only: this module never publishes or
 * moves a dist-tag. `tools/release/publish-npm.ts` owns the publish
 * orchestration and calls `verifyNpmRelease`.
 */

import { npmPublishTag } from './npm-publisher.ts';
import { spawnCommand } from '../repo/node-command.ts';
import {
  type PrereleaseChannel,
  prereleaseChannel,
  previousPrereleaseVersion,
  tryParseLineVersion,
} from '../lib/version.ts';

// ---------------------------------------------------------------------------
// npm release verification
//
// Post-publish registry verification: exact-version and dist-tag checks with
// a bounded per-field retry ladder, plus the same-line predecessor continuity
// invariant (#869-2.5) so a release can never skip a number.
//
// Budget discipline (M-T6): the old ladder slept 710s per field and every
// package verified serially — 1420s for one package's two fields already
// breaks the release job's 20-minute ceiling, and six packages stacked to
// 142-213min worst case. The ladder below is ceiling-derived: each field gets
// at most 110s of sleeps, packages verify concurrently, and a total deadline
// caps the whole phase at 15 minutes. The per-field attempt counts are logged
// so a future schedule can be fitted to measured propagation p95 from real
// release runs; until then the ceiling arithmetic above is the stated basis.
// ---------------------------------------------------------------------------

/** Per-field retry ladder: 110s of sleeps worst case (M-T6). */
export const DEFAULT_FIELD_DELAYS_MS = [0, 5_000, 15_000, 30_000, 60_000] as const;

/**
 * Total verification budget across every package and field: 15 minutes of
 * the release job's 20-minute ceiling, leaving room for publish, alias
 * re-point, and registry sync (M-T6).
 */
export const VERIFY_TOTAL_BUDGET_MS = 15 * 60_000;

export class NpmViewError extends Error {
  /** Explicit field (no parameter property): node's strip-only TS mode rejects them. */
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
    this.name = 'NpmViewError';
  }
}

/**
 * Slow propagation (M-T6): the registry answered, but the value never
 * converged to the expected one within the field ladder. Retrying longer is
 * the remedy — the transport works, the data is stale.
 */
export class NpmSlowPropagationError extends Error {
  readonly label: string;
  readonly expected: string;
  readonly observed: string;
  readonly attempts: number;

  constructor(label: string, expected: string, observed: string, attempts: number) {
    super(
      `${label}: registry served a stale value after ${attempts} attempts ` +
        `(slow propagation, not a transport failure): expected=${expected}, observed=${observed}`,
    );
    this.label = label;
    this.expected = expected;
    this.observed = observed;
    this.attempts = attempts;
    this.name = 'NpmSlowPropagationError';
  }
}

/**
 * Verification timeout (M-T6): the total budget ran out, or the registry
 * never answered a query at all. Distinct from slow propagation — here there
 * is no observed value to wait on, only transport failures or an exhausted
 * deadline.
 */
export class NpmVerifyTimeoutError extends Error {
  readonly label: string;

  constructor(label: string, detail: string) {
    super(`${label}: verification timed out (${detail})`);
    this.label = label;
    this.name = 'NpmVerifyTimeoutError';
  }
}

type NpmReleaseQuery = (specifier: string, field: string) => Promise<string>;

/** Run `npm view <specifier> <field> --json` and parse the JSON string value. */
export async function npmView(specifier: string, field: string): Promise<string> {
  const output = await spawnCommand('npm', {
    args: ['view', specifier, field, '--json'],
    stdout: 'piped',
    stderr: 'piped',
  });
  const stderr = new TextDecoder().decode(output.stderr);
  if (!output.success) {
    const retryable = !/\b(?:E401|E403)\b/u.test(stderr);
    throw new NpmViewError(`npm view ${specifier} ${field} failed: ${stderr.trim()}`, retryable);
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(output.stdout)) as unknown;
  } catch (error) {
    throw new NpmViewError(`Invalid npm JSON for ${specifier} ${field}: ${error}`, false);
  }
  if (typeof value !== 'string') {
    // Array-valued fields (e.g. `versions`) keep their JSON encoding so the
    // string contract holds; callers JSON.parse it back (predecessor check).
    if (Array.isArray(value)) return JSON.stringify(value);
    throw new NpmViewError(`Unexpected npm value for ${specifier} ${field}`, false);
  }
  return value;
}

export interface VerifyNpmReleaseOptions {
  version: string;
  packages: string[];
  query: NpmReleaseQuery;
  sleep?: (ms: number) => Promise<void>;
  delaysMs?: readonly number[];
  log?: (message: string) => void;
  /** Total budget for the whole verify phase (default VERIFY_TOTAL_BUDGET_MS). */
  totalBudgetMs?: number;
  /** Clock for the budget check, injectable for tests (default Date.now). */
  clock?: () => number;
}

// Strict x.y.z(-label.n) parsing is the canonical line-version contract in
// ./lib/version.ts (#1231 M16); the v/= prefixes and build metadata that
// @std/semver would tolerate are rejected there.

export function prereleaseTag(version: string): PrereleaseChannel | null {
  const parsed = tryParseLineVersion(version);
  if (parsed && parsed.prerelease === undefined) return null;
  const channel = prereleaseChannel(version);
  if (channel) return channel;
  throw new Error(`Expected version x.y.z or x.y.z-alpha|beta|rc.n, got: ${version}`);
}

// #869-2.5: the version immediately before the target on the same line, so a
// release can never skip a number (alpha.8-style hole).
export function previousPrerelease(version: string): string | null {
  return previousPrereleaseVersion(version);
}

interface VerifyRuntime {
  query: NpmReleaseQuery;
  sleep: (ms: number) => Promise<void>;
  delaysMs: readonly number[];
  deadline: number;
  clock: () => number;
  log?: (message: string) => void;
}

async function verifyField(
  label: string,
  specifier: string,
  field: string,
  expected: string,
  runtime: VerifyRuntime,
): Promise<void> {
  let lastObserved = '<not queried>';
  let answered = false;
  let lastDiagnostic = '';

  for (let attempt = 0; attempt < runtime.delaysMs.length; attempt++) {
    if (runtime.clock() >= runtime.deadline) {
      throw new NpmVerifyTimeoutError(label, 'total verification budget exceeded');
    }
    const delay = runtime.delaysMs[attempt];
    if (delay > 0) await runtime.sleep(delay);
    try {
      const observed = await runtime.query(specifier, field);
      answered = true;
      lastObserved = observed;
      lastDiagnostic = '';
      if (observed === expected) {
        // Attempt count per field: the raw material a future p95 fit needs.
        runtime.log?.(`[verify] ${label}: converged on attempt ${attempt + 1}.`);
        return;
      }
    } catch (error) {
      if (!(error instanceof NpmViewError) || !error.retryable) throw error;
      lastDiagnostic = error.message;
      lastObserved = '<query failed>';
    }
  }

  if (!answered) {
    throw new NpmVerifyTimeoutError(
      label,
      `registry never answered within ${runtime.delaysMs.length} attempts; ` +
        `final diagnostic: ${lastDiagnostic}`,
    );
  }
  throw new NpmSlowPropagationError(label, expected, lastObserved, runtime.delaysMs.length);
}

/**
 * Budgeted read of a package's published version list for the predecessor
 * continuity check. Transport failures retry inside the field ladder and the
 * shared deadline; a malformed (non-JSON) answer still fails hard, and an
 * answer that never parses as a list preserves the legacy fallthrough (an
 * empty list takes the line-first path below).
 */
async function readPublishedVersions(
  label: string,
  packageName: string,
  runtime: VerifyRuntime,
): Promise<string[]> {
  let lastDiagnostic = '<not queried>';
  let answered = false;
  for (let attempt = 0; attempt < runtime.delaysMs.length; attempt++) {
    if (runtime.clock() >= runtime.deadline) {
      throw new NpmVerifyTimeoutError(label, 'total verification budget exceeded');
    }
    const delay = runtime.delaysMs[attempt];
    if (delay > 0) await runtime.sleep(delay);
    try {
      const raw = await runtime.query(packageName, 'versions');
      answered = true;
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((v): v is string => typeof v === 'string');
      }
    } catch (error) {
      if (!(error instanceof NpmViewError) || !error.retryable) throw error;
      lastDiagnostic = error.message;
    }
  }
  if (!answered) {
    throw new NpmVerifyTimeoutError(
      label,
      `registry never answered within ${runtime.delaysMs.length} attempts; ` +
        `final diagnostic: ${lastDiagnostic}`,
    );
  }
  return [];
}

export async function verifyNpmRelease(options: VerifyNpmReleaseOptions): Promise<void> {
  const tag = prereleaseTag(options.version);
  const clock = options.clock ?? Date.now;
  const runtime: VerifyRuntime = {
    query: options.query,
    sleep:
      options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    delaysMs: options.delaysMs ?? DEFAULT_FIELD_DELAYS_MS,
    deadline: clock() + (options.totalBudgetMs ?? VERIFY_TOTAL_BUDGET_MS),
    clock,
    log: options.log,
  };
  if (runtime.delaysMs.length === 0 || runtime.delaysMs[0] !== 0) {
    throw new Error('Registry retry schedule must start with an immediate attempt.');
  }

  // #869-2.5: no version skips — the predecessor on the same line must
  // already be published for every package before this release can proceed.
  const predecessor = previousPrerelease(options.version);
  if (predecessor) {
    // Packages check continuity concurrently: the predecessor list is settled
    // registry truth (a previous release), so one budgeted read each — the
    // old code burned a full retry ladder per package here on top of the
    // per-field ladders below.
    await Promise.all(
      options.packages.map(async (name) => {
        const packageName = `@openelement/${name}`;
        const published = await readPublishedVersions(
          `${packageName} continuity`,
          packageName,
          runtime,
        );
        // Line-first exemption: a package with no EARLIER version on this
        // release line is publishing onto the line for the first time, so the
        // same-line predecessor cannot exist by definition. Registry-zero was
        // the wrong predicate twice over: @openelement/protocol carries 0.41-era
        // history under the same name (so its list is never empty), and this
        // verify runs AFTER the publish loop (so a just-published name queries
        // back its own current version except through slow-propagation races).
        // Either way the old check threw after the packages were already on the
        // registry — unrevertable — and the retry loop then skipped the release.
        const linePrefix = `${options.version.split('-')[0]}-`;
        const earlierOnLine = published.filter(
          (v) => v !== options.version && v.startsWith(linePrefix),
        );
        if (earlierOnLine.length === 0) {
          options.log?.(
            `Line-first publish: ${packageName} has no earlier ${linePrefix}* version; continuity skipped.`,
          );
          return;
        }
        if (!published.includes(predecessor)) {
          throw new Error(
            `Continuity check failed for ${options.version}: predecessor ${predecessor} ` +
              `is not among published versions of ${packageName}.`,
          );
        }
      }),
    );
    options.log?.(`Continuity verified: ${predecessor} precedes ${options.version}.`);
  }

  // Field verification runs concurrently across packages: npm queries are
  // I/O-bound, and serial ladders multiplied the worst case by the package
  // count (M-T6). The shared deadline still caps the whole phase.
  await Promise.all(
    options.packages.map(async (name) => {
      const packageName = `@openelement/${name}`;
      await verifyField(
        `${packageName} version`,
        `${packageName}@${options.version}`,
        'version',
        options.version,
        runtime,
      );
      // Owner ruling 2026-10-07: the 1.0 prerelease line publishes onto
      // `latest` (npmPublishTag), so the verified dist-tag is `latest` there;
      // earlier prerelease lines keep the #607 channel-tag contract. The
      // channel alias on the 1.0 line is re-pointed post-publish by the
      // release workflow and is deliberately not part of this proof.
      // npmPublishTag answers prereleases only; a stable verifies latest.
      const expectedTag = tag ? npmPublishTag(options.version) : 'latest';
      if (tag && expectedTag !== 'latest') {
        await verifyField(
          `${packageName} dist-tags.${tag}`,
          packageName,
          `dist-tags.${tag}`,
          options.version,
          runtime,
        );
        options.log?.(
          `${packageName}@${options.version}: ${tag} dist-tag verified (latest left on stable)`,
        );
      } else {
        await verifyField(
          `${packageName} dist-tags.latest`,
          packageName,
          'dist-tags.latest',
          options.version,
          runtime,
        );
        options.log?.(
          `${packageName}@${options.version}: latest dist-tag verified (${expectedTag === 'latest' && tag ? '1.0 prerelease line' : 'stable'})`,
        );
      }
    }),
  );
}
