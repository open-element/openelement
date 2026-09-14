/**
 * npm registry verification for a published release.
 *
 * Post-publish truth: exact-version and dist-tag checks with a bounded retry
 * schedule, plus the same-line predecessor continuity invariant (#869-2.5) so
 * a release can never skip a number. Read-only: this module never publishes or
 * moves a dist-tag. `tools/release/publish-npm.ts` owns the publish
 * orchestration and calls `verifyNpmRelease`.
 */

import {
  type PrereleaseChannel,
  prereleaseChannel,
  previousPrereleaseVersion,
  tryParseLineVersion,
} from '../lib/version.ts';

// ---------------------------------------------------------------------------
// npm release verification (formerly tools/lib/npm-release-verifier.ts)
//
// Post-publish registry verification: exact-version and dist-tag checks with
// a retry schedule, plus the same-line predecessor continuity invariant
// (#869-2.5) so a release can never skip a number.
// ---------------------------------------------------------------------------

const DEFAULT_REGISTRY_DELAYS_MS = [
  0,
  1_000,
  2_000,
  4_000,
  8_000,
  15_000,
] as const;

export class NpmViewError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = 'NpmViewError';
  }
}

type NpmReleaseQuery = (specifier: string, field: string) => Promise<string>;

/** Run `npm view <specifier> <field> --json` and parse the JSON string value. */
export async function npmView(
  specifier: string,
  field: string,
): Promise<string> {
  const output = await new Deno.Command('npm', {
    args: ['view', specifier, field, '--json'],
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  const stderr = new TextDecoder().decode(output.stderr);
  if (!output.success) {
    const retryable = !/\b(?:E401|E403)\b/u.test(stderr);
    throw new NpmViewError(
      `npm view ${specifier} ${field} failed: ${stderr.trim()}`,
      retryable,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(output.stdout)) as unknown;
  } catch (error) {
    throw new NpmViewError(
      `Invalid npm JSON for ${specifier} ${field}: ${error}`,
      false,
    );
  }
  if (typeof value !== 'string') {
    // Array-valued fields (e.g. `versions`) keep their JSON encoding so the
    // string contract holds; callers JSON.parse it back (predecessor check).
    if (Array.isArray(value)) return JSON.stringify(value);
    throw new NpmViewError(
      `Unexpected npm value for ${specifier} ${field}`,
      false,
    );
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
}

// Strict x.y.z(-label.n) parsing is the canonical line-version contract in
// ./lib/version.ts (#1231 M16); the v/= prefixes and build metadata that
// @std/semver would tolerate are rejected there.

export function prereleaseTag(version: string): PrereleaseChannel | null {
  const parsed = tryParseLineVersion(version);
  if (parsed && parsed.prerelease === undefined) return null;
  const channel = prereleaseChannel(version);
  if (channel) return channel;
  throw new Error(
    `Expected version x.y.z or x.y.z-alpha|beta|rc.n, got: ${version}`,
  );
}

// #869-2.5: the version immediately before the target on the same line, so a
// release can never skip a number (alpha.8-style hole).
export function previousPrerelease(version: string): string | null {
  return previousPrereleaseVersion(version);
}

async function verifyField(
  label: string,
  specifier: string,
  field: string,
  expected: string,
  options: Required<
    Pick<VerifyNpmReleaseOptions, 'query' | 'sleep' | 'delaysMs'>
  >,
): Promise<void> {
  let lastObserved = '<not queried>';
  let lastDiagnostic = '';

  for (let attempt = 0; attempt < options.delaysMs.length; attempt++) {
    const delay = options.delaysMs[attempt];
    if (delay > 0) await options.sleep(delay);
    try {
      const observed = await options.query(specifier, field);
      lastObserved = observed;
      lastDiagnostic = '';
      if (observed === expected) return;
    } catch (error) {
      if (!(error instanceof NpmViewError) || !error.retryable) throw error;
      lastDiagnostic = error.message;
      lastObserved = '<query failed>';
    }
  }

  const detail = lastDiagnostic ? `; final diagnostic: ${lastDiagnostic}` : '';
  throw new Error(
    `${label} verification failed after ${options.delaysMs.length} attempts: ` +
      `expected=${expected}, observed=${lastObserved}${detail}`,
  );
}

export async function verifyNpmRelease(
  options: VerifyNpmReleaseOptions,
): Promise<void> {
  const tag = prereleaseTag(options.version);
  const runtime = {
    query: options.query,
    sleep: options.sleep ??
      ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    delaysMs: options.delaysMs ?? DEFAULT_REGISTRY_DELAYS_MS,
  };
  if (runtime.delaysMs.length === 0 || runtime.delaysMs[0] !== 0) {
    throw new Error(
      'Registry retry schedule must start with an immediate attempt.',
    );
  }

  // #869-2.5: no version skips — the predecessor on the same line must
  // already be published for every package before this release can proceed.
  const predecessor = previousPrerelease(options.version);
  if (predecessor) {
    for (const name of options.packages) {
      const packageName = `@openelement/${name}`;
      let published: string[] = [];
      for (let attempt = 0; attempt < runtime.delaysMs.length; attempt++) {
        const delay = runtime.delaysMs[attempt];
        if (delay > 0) await runtime.sleep(delay);
        try {
          const raw = await runtime.query(packageName, 'versions');
          const parsed = JSON.parse(raw) as unknown;
          if (Array.isArray(parsed)) {
            published = parsed.filter((v): v is string => typeof v === 'string');
            break;
          }
        } catch (error) {
          if (!(error instanceof NpmViewError) || !error.retryable) throw error;
        }
      }
      if (!published.includes(predecessor)) {
        throw new Error(
          `Continuity check failed for ${options.version}: predecessor ${predecessor} ` +
            `is not among published versions of ${packageName}.`,
        );
      }
    }
    options.log?.(`Continuity verified: ${predecessor} precedes ${options.version}.`);
  }

  for (const name of options.packages) {
    const packageName = `@openelement/${name}`;
    await verifyField(
      `${packageName} version`,
      `${packageName}@${options.version}`,
      'version',
      options.version,
      runtime,
    );
    if (tag) {
      // #607: prerelease only requires its line tag (alpha/beta/rc). Do not
      // require latest === prerelease — latest must remain on stable.
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
        `${packageName}@${options.version}: latest dist-tag verified (stable)`,
      );
    }
  }
}
