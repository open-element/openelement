/**
 * Fixture lockfile registry and consistency check (section 18).
 *
 * There are six fixture lock universes. Five are independent because each
 * fixture resolves a different dependency universe; router-native-framework
 * and router-request-time share the exact same universe (identical import
 * declarations), so their lockfiles are byte-identical generated artifacts —
 * a hand-edit to one without the other is a drift bug, not a feature.
 *
 * The lockfiles are generated, never hand-written. Regenerate all of them
 * with `deno task --cwd tools/repo fixtures:locks:update`; each entry below
 * carries the entrypoint that resolves its universe. A lockfile that is not
 * registered here fails the check until it is reviewed and added.
 */

export interface FixtureLockEntry {
  /** Fixture directory under tests/fixtures. */
  fixture: string;
  /** Why this fixture needs its own lock universe. */
  purpose: string;
  /** Entrypoint whose dependency resolution regenerates the lock. */
  entrypoint: string;
  /** Fixture whose universe must match byte for byte, when shared. */
  sharedUniverseWith?: string;
}

export const FIXTURE_LOCKS: readonly FixtureLockEntry[] = [
  {
    fixture: 'router-native-framework',
    purpose: 'app-flow source fixture: SSR, dynamic routes, islands',
    entrypoint: 'app/routes/index.tsx',
  },
  {
    fixture: 'router-request-time',
    purpose: 'request-time rendering source fixture',
    entrypoint: 'app/routes/index.tsx',
    sharedUniverseWith: 'router-native-framework',
  },
  {
    fixture: 'router-lit-framework',
    purpose: 'Lit SSR integration fixture (adds lit/@lit-labs)',
    entrypoint: 'app/routes/index.ts',
  },
  {
    fixture: 'router-ui-dogfood',
    purpose: 'UI dogfood fixture (adds @openelement/ui subpaths)',
    entrypoint: 'app/routes/index.tsx',
  },
  {
    fixture: 'router-nitro',
    purpose: 'real Nitro node-server + cloudflare_module proof (adds Nitro)',
    entrypoint: 'proof.ts',
  },
  {
    fixture: 'web-component-interop',
    purpose: 'third-party custom-element interop corpus (adds manifest tooling)',
    entrypoint: 'interop-qualification.test.ts',
  },
];

export interface FixtureLockFiles {
  lock: string;
  config: string;
}

/** The single documented regeneration command for a fixture lock. */
export function regenerateCommand(entry: FixtureLockEntry): string {
  // Nitro's universe is resolved by the real build, not a source entrypoint.
  return entry.fixture === 'router-nitro'
    ? 'deno task proof:node'
    : `deno cache ${entry.entrypoint}`;
}

export function registryFailures(
  discovered: readonly string[],
  entries: readonly FixtureLockEntry[] = FIXTURE_LOCKS,
): string[] {
  const registered = new Set(entries.map((entry) => entry.fixture));
  const found = new Set(discovered);
  return [
    ...discovered.filter((fixture) => !registered.has(fixture)).map((fixture) =>
      `unregistered fixture lockfile: tests/fixtures/${fixture}/deno.lock ` +
      '(review the universe and add it to FIXTURE_LOCKS)'
    ),
    ...entries.filter((entry) => !found.has(entry.fixture)).map((entry) =>
      `registered fixture lockfile is missing: tests/fixtures/${entry.fixture}/deno.lock`
    ),
  ];
}

/** Locks must not smuggle host-specific absolute paths into resolution. */
export function absolutePathFailures(fixture: string, lock: string): string[] {
  return /(?:file:\/\/\/|\/Users\/|\/home\/|[A-Za-z]:\\\\)/.test(lock)
    ? [`tests/fixtures/${fixture}/deno.lock contains a host-absolute path`]
    : [];
}

/**
 * Shared universes must resolve identically: same dependency declaration
 * (deno.json imports) and byte-identical lockfiles. Regenerating one fixture
 * alone is the failure mode this catches.
 */
export function sharedUniverseFailures(
  entries: readonly FixtureLockEntry[],
  files: ReadonlyMap<string, FixtureLockFiles>,
): string[] {
  const failures: string[] = [];
  for (const entry of entries) {
    const peerName = entry.sharedUniverseWith;
    if (peerName === undefined) continue;
    const peer = entries.find((candidate) => candidate.fixture === peerName);
    if (peer === undefined) {
      failures.push(`${entry.fixture}: shared universe peer ${peerName} is not registered`);
      continue;
    }
    const a = files.get(entry.fixture);
    const b = files.get(peer.fixture);
    if (a === undefined || b === undefined) continue;
    if (a.lock !== b.lock) {
      failures.push(
        `${entry.fixture} and ${peer.fixture} share one dependency universe but their ` +
          `lockfiles differ; run deno task --cwd tools/repo fixtures:locks:update`,
      );
    }
    const imports = (raw: string): unknown => {
      try {
        return (JSON.parse(raw) as { imports?: unknown }).imports;
      } catch {
        return null;
      }
    };
    if (JSON.stringify(imports(a.config)) !== JSON.stringify(imports(b.config))) {
      failures.push(
        `${entry.fixture} and ${peer.fixture} share one dependency universe but their ` +
          'deno.json imports differ; align the declaration, then regenerate both locks',
      );
    }
  }
  return failures;
}

export function lockVersionFailures(fixture: string, lock: string): string[] {
  let version: unknown;
  try {
    version = (JSON.parse(lock) as { version?: unknown }).version;
  } catch {
    return [`tests/fixtures/${fixture}/deno.lock is not valid JSON`];
  }
  return typeof version === 'string' && Number(version) >= 5
    ? []
    : [`tests/fixtures/${fixture}/deno.lock version ${String(version)} is unsupported`];
}

/**
 * Regenerate every registered lock from its dependency declaration. The
 * shared-universe pair is regenerated from the same declarations, so the
 * consistency check can only pass if the universes really are identical.
 */
export async function updateLocks(
  entries: readonly FixtureLockEntry[] = FIXTURE_LOCKS,
): Promise<number> {
  for (const entry of entries) {
    const cwd = `tests/fixtures/${entry.fixture}`;
    const args = entry.fixture === 'router-nitro'
      ? ['task', 'proof:node']
      : ['cache', entry.entrypoint];
    console.log(`[fixtures:locks] ${cwd}: ${regenerateCommand(entry)}`);
    const status = await new Deno.Command(Deno.execPath(), {
      args,
      cwd,
      stdin: 'null',
      stdout: 'inherit',
      stderr: 'inherit',
    }).spawn().status;
    if (status.code !== 0) return status.code;
  }
  return 0;
}

async function main(): Promise<void> {
  if (Deno.args.includes('--update')) {
    Deno.exit(await updateLocks());
  }
  const root = 'tests/fixtures';
  const discovered: string[] = [];
  for await (const entry of Deno.readDir(root)) {
    if (!entry.isDirectory) continue;
    try {
      await Deno.stat(`${root}/${entry.name}/deno.lock`);
      discovered.push(entry.name);
    } catch {
      // no lockfile for this fixture
    }
  }
  discovered.sort();

  const files = new Map<string, FixtureLockFiles>();
  const failures: string[] = [];
  for (const fixture of discovered) {
    const lock = await Deno.readTextFile(`${root}/${fixture}/deno.lock`);
    const config = await Deno.readTextFile(`${root}/${fixture}/deno.json`);
    files.set(fixture, { lock, config });
    failures.push(...lockVersionFailures(fixture, lock));
    failures.push(...absolutePathFailures(fixture, lock));
  }
  failures.push(...registryFailures(discovered));
  failures.push(...sharedUniverseFailures(FIXTURE_LOCKS, files));

  console.log(`Fixture lock universes (${FIXTURE_LOCKS.length} registered):`);
  for (const entry of FIXTURE_LOCKS) {
    const shared = entry.sharedUniverseWith === undefined
      ? ''
      : ` [shared with ${entry.sharedUniverseWith}]`;
    console.log(`  ${entry.fixture}${shared} — ${entry.purpose}`);
    console.log(
      `    regenerate: ${regenerateCommand(entry)} (cwd tests/fixtures/${entry.fixture})`,
    );
  }

  if (failures.length > 0) {
    console.error('Fixture lockfile check failed:');
    for (const failure of failures) console.error(`  ${failure}`);
    Deno.exit(1);
  }
  console.log(`Fixture lockfile check passed (${discovered.length} lockfiles).`);
}

if (import.meta.main) await main();
