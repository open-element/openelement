/**
 * S-C1.4 / #1609 — resolver-driven static module reachability, proven on its own
 * before any CSS work rides on it.
 *
 * The client build's graph is islands-only, so a Page/Layout the server renders
 * alone never enters it, and neither does the authored `.css` edge it declares.
 * The traversal that fixes that must be SPECIFIER-COMPLETE: an app may reach a
 * component by relative path, by a `package.json` `imports` subpath
 * (`#site-ui/…`), by a configured alias, or through a package export path — and
 * only the bundler's own resolver knows all four.
 *
 * This suite runs a REAL Vite build on a real fixture app and asserts the walk's
 * outcome against the RED baseline it replaces (a dot-relative-only traversal),
 * so the failure it closes is reproduced in the same test rather than recalled.
 *
 * Covered, per the #1609 retry contract: relative imports, `#imports`, Vite
 * aliases, a workspace package export path, a static cycle, a repeated import
 * (one identity), an external module (the resolver's verdict), a virtual module,
 * and a dynamic-only dependency (explicitly outside the static contract).
 */

import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { build, type Plugin } from 'vite';
import { analyzeModuleSemantics } from '@openelement/compiler';
import { walkModuleGraph } from '../src/vite/internal/module-graph-walk.ts';

const FIXTURE = join(import.meta.dirname!, '../__test_fixtures__/module-walk');
const ROOT = FIXTURE;

interface WalkOutcome {
  files: string[];
  relativeOnly: string[];
  skipped: { external: number; virtual: number; nonSource: number; unresolved: number };
  truncated: boolean;
}

let outcome: WalkOutcome;

function write(relative: string, content: string): void {
  const path = join(FIXTURE, relative);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

beforeAll(async () => {
  rmSync(FIXTURE, { recursive: true, force: true });
  mkdirSync(join(FIXTURE, 'app', 'site-ui'), { recursive: true });
  mkdirSync(join(FIXTURE, 'app', 'components'), { recursive: true });
  mkdirSync(join(FIXTURE, 'packages', 'probe-ui', 'dist'), { recursive: true });

  // The app's own `imports` map — the WWW `#site-ui/*` shape that the
  // dot-relative traversal could not follow.
  write(
    'package.json',
    JSON.stringify({
      name: 'module-walk-fixture',
      private: true,
      type: 'module',
      imports: { '#site-ui/*': './app/site-ui/*' },
    }),
  );
  // A workspace package reached through its export path, outside the app root.
  write(
    'packages/probe-ui/package.json',
    JSON.stringify({
      name: '@probe/ui',
      version: '0.0.0',
      type: 'module',
      exports: { './panel': './dist/panel.js' },
    }),
  );
  write('packages/probe-ui/dist/panel.js', "import './panel.css';\nexport const panel = 1;\n");
  write('packages/probe-ui/dist/panel.css', '.panel { color: red; }\n');
  mkdirSync(join(FIXTURE, 'node_modules', '@probe'), { recursive: true });
  symlinkSync(
    join(FIXTURE, 'packages', 'probe-ui'),
    join(FIXTURE, 'node_modules', '@probe', 'ui'),
    'dir',
  );

  // The server-rendered root and its edges.
  write(
    'app/components/page-probe.tsx',
    [
      "import './probe.css';",
      "import '#site-ui/open-artifact-panel.tsx';",
      "import '@probe/ui/panel';",
      "import { aliased } from '@app/aliased.ts';",
      "import { cycleA } from './cycle-a.ts';",
      "import { shared } from './shared.ts';",
      "import { shared as sharedAgain } from '../components/shared.ts';",
      "import 'external-probe';",
      "import 'virtual:probe';",
      'export async function lazy() {',
      "  return import('./dynamic-only.ts');",
      '}',
      'export const page = [aliased, cycleA, shared, sharedAgain];',
      '',
    ].join('\n'),
  );
  write('app/components/probe.css', '.probe { color: blue; }\n');
  write('app/site-ui/open-artifact-panel.tsx', 'export const panel = 1;\n');
  write('app/aliased.ts', 'export const aliased = 1;\n');
  write(
    'app/components/cycle-a.ts',
    "import { cycleB } from './cycle-b.ts';\nexport const cycleA = cycleB;\n",
  );
  write(
    'app/components/cycle-b.ts',
    "import { cycleA } from './cycle-a.ts';\nexport const cycleB = cycleA ?? 1;\n",
  );
  write('app/components/shared.ts', 'export const shared = 1;\n');
  write('app/components/dynamic-only.ts', 'export const dynamicOnly = 1;\n');

  const walkPlugin: Plugin = {
    name: 'probe-module-walk',
    async buildStart() {
      const seeds = [join(FIXTURE, 'app/components/page-probe.tsx')];
      const result = await walkModuleGraph(this, seeds);
      outcome = {
        files: result.files.map((file) => file.replace(`${FIXTURE}/`, '')),
        relativeOnly: await relativeOnlyWalk(this, seeds),
        skipped: result.skipped,
        truncated: result.truncated,
      };
    },
  };

  await build({
    root: ROOT,
    logLevel: 'silent',
    configFile: false,
    resolve: { alias: { '@app/': `${FIXTURE}/app/` } },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        input: { probe: join(FIXTURE, 'app/components/page-probe.tsx') },
        external: ['external-probe'],
      },
    },
    plugins: [
      {
        name: 'probe-virtual',
        resolveId(id) {
          if (id === 'virtual:probe') return '\0virtual:probe';
          return null;
        },
        load(id) {
          if (id === '\0virtual:probe') return 'export const v = 1;\n';
          return null;
        },
      },
      walkPlugin,
    ],
  });
});

afterAll(() => {
  rmSync(FIXTURE, { recursive: true, force: true });
});

/**
 * The traversal this walk replaces: the same seeds, but only `.`-relative
 * specifiers are followed — the RED baseline behind the WWW
 * `open-artifact-panel.css has no emitted asset` failure.
 */
async function relativeOnlyWalk(
  context: { resolve: (specifier: string, importer?: string) => Promise<{ id: string } | null> },
  seeds: string[],
): Promise<string[]> {
  const { readFile } = await import('node:fs/promises');
  const found = new Set<string>();
  const queue = [...seeds];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (found.has(file)) continue;
    found.add(file);
    const source = await readFile(file, 'utf8').catch(() => '');
    for (const specifier of analyzeModuleSemantics(source, file).relativeImports) {
      const resolved = await context.resolve(specifier, file);
      if (resolved !== null) queue.push(resolved.id.split('?', 1)[0]!);
    }
  }
  return [...found].map((file) => file.replace(`${FIXTURE}/`, ''));
}

test('the walk reaches every static edge form, including the #imports subpath', () => {
  const { files } = outcome;
  const reachable = (suffix: string): boolean => files.some((file) => file.endsWith(suffix));

  for (const expected of [
    'app/components/page-probe.tsx',
    'app/site-ui/open-artifact-panel.tsx', // package.json `imports` (#site-ui/*)
    'app/aliased.ts', // Vite resolve.alias
    'app/components/cycle-a.ts', // cycle, entered once
    'app/components/cycle-b.ts',
    'app/components/shared.ts', // one identity for repeated imports
    'packages/probe-ui/dist/panel.js', // workspace package export path
  ]) {
    expect(reachable(expected), `${expected} must be reachable (files: ${files.join(', ')})`).toBe(
      true,
    );
  }
});

test('the RED baseline it replaces misses exactly the non-relative forms', () => {
  const { files, relativeOnly } = outcome;
  // Relative imports were already reachable — the baseline is not wrong, it is
  // incomplete.
  expect(relativeOnly).toContain('app/components/page-probe.tsx');
  expect(relativeOnly).toContain('app/components/shared.ts');
  expect(relativeOnly).toContain('app/components/cycle-a.ts');
  // …and this is the failure the WWW build hit: the `#site-ui` chain, the alias
  // and the package export path are invisible to it.
  expect(relativeOnly.some((file) => file.includes('site-ui'))).toBe(false);
  expect(relativeOnly).not.toContain('app/aliased.ts');
  expect(relativeOnly.some((file) => file.includes('probe-ui'))).toBe(false);
  expect(files.some((file) => file.includes('site-ui'))).toBe(true);
});

test('identity, ordering and boundaries are deliberate', () => {
  const { files, skipped, truncated } = outcome;

  // Deduplicated by resolved identity: the same module imported twice (and a
  // cycle back into it) appears once.
  expect(new Set(files).size).toEqual(files.length);
  expect(files.filter((file) => file.endsWith('app/components/shared.ts')).length).toEqual(1);
  expect(files.filter((file) => file.endsWith('cycle-a.ts')).length).toEqual(1);

  // Deterministic order: seeds first, then breadth-first in specifier order.
  expect(files[0]).toEqual('app/components/page-probe.tsx');

  // Boundaries, counted rather than assumed: an external module and a virtual
  // module were seen and deliberately not followed; `.css` is not this walk's
  // edge (the compiler registers those), and the dynamic-only module is absent.
  expect(skipped.external).toBeGreaterThanOrEqual(1);
  expect(skipped.virtual).toBeGreaterThanOrEqual(1);
  expect(skipped.nonSource).toBeGreaterThanOrEqual(2);
  expect(files.some((file) => file.endsWith('dynamic-only.ts'))).toBe(false);
  expect(files.some((file) => file.endsWith('probe.css'))).toBe(false);
  expect(truncated).toBe(false);
});

test('a bounded walk reports truncation instead of crawling without limit', async () => {
  const context = {
    resolve(specifier: string, importer: string): Promise<{ id: string } | null> {
      if (specifier.startsWith('.')) {
        const base = importer.slice(0, importer.lastIndexOf('/'));
        return Promise.resolve({ id: `${base}/shared.ts` });
      }
      return Promise.resolve(null);
    },
  };
  const result = await walkModuleGraph(context, [`${FIXTURE}/app/components/page-probe.tsx`], {
    maxModules: 2,
  });
  expect(result.truncated).toBe(true);
  expect(result.files.length).toBeLessThanOrEqual(2);
});
