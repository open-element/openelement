/**
 * Dependency-age supply-chain gate (replaces the Deno-era
 * minimumDependencyAge semantics, now enforced over the pnpm lockfile).
 *
 * Every package resolved in `pnpm-lock.yaml` must have been published at
 * least `MIN_AGE_DAYS` days ago: a freshly published dependency or version
 * cannot enter the lockfile on day one. Publish time is the registry
 * packument's `time[version]`, falling back to `time.created`. Registry and
 * network failures fail closed — an unverifiable package is a red, never a
 * silent pass. Successful lookups are cached in `.artifacts/`
 * (publish times are immutable) so repeat runs avoid re-querying.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

const MIN_AGE_DAYS = 3;
const DAY_MS = 86_400_000;
const CACHE_PATH = '.artifacts/dep-age-cache.json';
const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const FETCH_TIMEOUT_MS = 60_000;
const FETCH_ATTEMPTS = 2;
const CONCURRENCY = 12;

/**
 * The only registry hosts this gate may query. The lockfile's per-package
 * `tarball:` lines are repository-controlled but still file data; the fetch
 * below therefore fails closed on any host outside this set. A new registry
 * (a new jsr-style mirror) is a deliberate, reviewed extension of this set.
 */
const REGISTRY_HOSTS = new Set(['registry.npmjs.org', 'npm.jsr.io']);

/**
 * npm's package-name grammar (validate-npm-package-name): lowercase, scoped
 * (`@scope/name`) or bare, no leading dot/underscore. With the name provably
 * in-grammar, encoding exactly the scope separator (`/` → `%2F`) is a
 * complete URL path encoding — the `@` scope marker is legal in a URL path
 * and must stay literal. This replaces an encode-then-unescape
 * (`encodeURIComponent` + `%40` → `@`), whose post-encoding reversal is the
 * incomplete-sanitization shape static analysis flags.
 */
const NPM_NAME_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

/**
 * The packument URL for a validated name: the registry origin joined to the
 * name with every `/` encoded as `%2F` (the `@` scope marker stays literal —
 * it is legal in a URL path). npm scoped names carry exactly one `/`, but the
 * escaping must be complete (`replaceAll`, not first-occurrence `replace`) so
 * no name shape can leave a raw separator in the path — the incomplete
 * string-escaping shape static analysis flags.
 */
export function packumentUrl(registry: string, name: string): string {
  return `${registry}/${name.replaceAll('/', '%2F')}`;
}

export interface LockPackage {
  key: string;
  name: string;
  version: string;
  registry: string;
}

/** Extract the resolved `packages:` section of a pnpm-lock.yaml (v9). */
export function parseLockPackages(lockText: string): LockPackage[] {
  const packages: LockPackage[] = [];
  let inPackages = false;
  let current: LockPackage | undefined;
  for (const line of lockText.split('\n')) {
    if (/^\S/.test(line)) {
      // The lockfile is a multi-document stream (package-manager deps are a
      // separate document); every document may contribute a `packages:` set.
      inPackages = line === 'packages:';
      current = undefined;
      continue;
    }
    if (!inPackages) continue;
    // Exactly-two-space keys only: peer-dependency sub-keys sit deeper and
    // must not leak into the resolution set. Quoted and bare names covered.
    const entry = /^ {2}(?!\s)(?:'([^']*)'|([^':][^:]*)):$/.exec(line);
    const key = entry?.[1] ?? entry?.[2];
    if (key !== undefined) {
      // Peer-suffixed snapshot keys (`foo@1.0.0(peer@2.0.0)`) resolve to the
      // base artifact; the parenthetical is not part of the registry name.
      const paren = key.indexOf('(');
      const base = paren === -1 ? key : key.slice(0, paren);
      const at = base.lastIndexOf('@');
      if (at > 0) {
        current = {
          key,
          name: base.slice(0, at),
          version: base.slice(at + 1),
          registry: DEFAULT_REGISTRY,
        };
        packages.push(current);
      }
      continue;
    }
    const tarball = /tarball: https?:\/\/([^/\s]+)/.exec(line);
    if (tarball?.[1] !== undefined && current !== undefined) {
      current.registry = `https://${tarball[1]}`;
    }
  }
  return packages;
}

/** Red when the publish time is unparsable or inside the quarantine window. */
export function ageFailure(publishIso: string, now: Date, key: string): string | undefined {
  const published = Date.parse(publishIso);
  if (!Number.isFinite(published))
    return `${key}: unparsable publish time ${JSON.stringify(publishIso)}`;
  const ageDays = (now.getTime() - published) / DAY_MS;
  if (ageDays < MIN_AGE_DAYS) {
    return `${key}: published ${publishIso} (${ageDays.toFixed(1)}d ago) is inside the ${MIN_AGE_DAYS}-day quarantine window`;
  }
  return undefined;
}

/** Resolve the publish time, or a `${pkg.key}: …` failure message (fail-closed). */
export async function fetchPublishTime(pkg: LockPackage): Promise<string> {
  let reason = 'no attempt';
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    try {
      // Fail closed before any network touch: the registry origin is lockfile
      // data, so both its parsability and its host are re-validated here
      // rather than trusted from the parser.
      const registry = new URL(pkg.registry);
      if (!REGISTRY_HOSTS.has(registry.host)) {
        return (
          `${pkg.key}: registry host ${JSON.stringify(registry.host)} is not allowlisted ` +
          `(expected one of ${[...REGISTRY_HOSTS].sort().join(', ')}) — failing closed; ` +
          'extend REGISTRY_HOSTS deliberately if this registry is intended'
        );
      }
      if (!NPM_NAME_RE.test(pkg.name)) {
        return `${pkg.key}: package name ${JSON.stringify(pkg.name)} is not a legal npm name — failing closed`;
      }
      // Full (non-abbreviated) packuments: only they carry the `time` map,
      // and for meta-packages like playwright they reach ~20MB.
      const response = await fetch(packumentUrl(pkg.registry, pkg.name), {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok)
        return `${pkg.key}: registry ${pkg.registry} returned HTTP ${response.status} — failing closed`;
      const packument = await response.json();
      const time = (packument as { time?: Record<string, string> }).time;
      const publish = time?.[pkg.version] ?? time?.created;
      if (typeof publish !== 'string') {
        return `${pkg.key}: registry metadata has no publish time — failing closed`;
      }
      return publish;
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
    }
  }
  return `${pkg.key}: registry unreachable (${reason}) — network failure fails closed`;
}

if (import.meta.main) {
  const now = new Date();
  const packages = parseLockPackages(await readFile('pnpm-lock.yaml', 'utf8'));
  const cache: Record<string, string> = JSON.parse(
    await readFile(CACHE_PATH, 'utf8').catch(() => '{}'),
  );
  const pending = packages.filter((pkg) => cache[pkg.key] === undefined);
  const failures: string[] = [];
  const queue = [...pending];
  let fetched = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let pkg = queue.shift(); pkg !== undefined; pkg = queue.shift()) {
        const result = await fetchPublishTime(pkg);
        if (result.startsWith(`${pkg.key}:`)) failures.push(result);
        else {
          cache[pkg.key] = result;
          fetched++;
        }
      }
    }),
  );
  for (const pkg of packages) {
    const publish = cache[pkg.key];
    if (publish !== undefined) {
      const failure = ageFailure(publish, now, pkg.key);
      if (failure !== undefined) failures.push(failure);
    }
  }
  const sorted = Object.fromEntries(Object.entries(cache).sort(([a], [b]) => (a < b ? -1 : 1)));
  await mkdir('.artifacts', { recursive: true });
  await writeFile(CACHE_PATH, `${JSON.stringify(sorted, null, '\t')}\n`);
  if (failures.length > 0) {
    console.error(`Dependency age check failed (${failures.length}/${packages.length}):`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(
    `Dependency age check passed: ${packages.length} resolved packages, ${fetched} fetched, ${packages.length - fetched} cached, min age ${MIN_AGE_DAYS}d.`,
  );
}
