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
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { build, type Plugin } from 'vite';
import { analyzeModuleSemantics } from '@openelement/compiler';
import {
  ModuleWalkDiagnosticCode,
  walkModuleGraph,
} from '../src/vite/internal/module-graph-walk.ts';

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
      "import type { Input } from './type-import.ts';",
      "export type { Model } from './type-export.ts';",
      "import 'external-probe';",
      "import 'virtual:probe';",
      'export async function lazy() {',
      "  return import('./dynamic-only.ts');",
      '}',
      'export const page: Input = [aliased, cycleA, shared, sharedAgain];',
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
  write('app/components/type-import.ts', 'export type Input = unknown[];\n');
  write('app/components/type-export.ts', 'export type Model = string;\n');

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
  expect(files).not.toContain('app/components/type-import.ts');
  expect(files).not.toContain('app/components/type-export.ts');
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

test('an analysis failure is reported with its code, never swallowed as "no edges"', async () => {
  // The negative proof for the fail-open this walk used to have: a source the
  // module analysis cannot survive (deeply nested parens overflow its stack)
  // returned an empty specifier list, indistinguishable from "imports
  // nothing". The walk must now report file + code on the result AND on the
  // build log, and keep the module in its file set.
  const pathological = join(FIXTURE, 'app/components/pathological.ts');
  writeFileSync(pathological, `const value = ${'('.repeat(60_000)}1${')'.repeat(60_000)};\n`);
  const warnings: string[] = [];
  const warn = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args.map((arg) => String(arg)).join(' '));
  });
  try {
    const result = await walkModuleGraph({ resolve: () => Promise.resolve(null) }, [pathological]);

    expect(result.skipped.analysisFailed).toEqual(1);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.code).toEqual(ModuleWalkDiagnosticCode.ANALYSIS_FAILED);
    expect(result.diagnostics[0]!.file).toEqual(pathological);
    expect(result.diagnostics[0]!.message).toMatch(/call stack/i);
    // The build log carries the code too: a result object nobody reads is not
    // a report.
    expect(warnings.some((line) => line.includes(ModuleWalkDiagnosticCode.ANALYSIS_FAILED))).toBe(
      true,
    );
    // The walk neither died nor dropped the module from its file set.
    expect(result.files).toContain(pathological);

    // Positive control: a clean walk reports nothing.
    const clean = join(FIXTURE, 'app/components/clean-probe.ts');
    writeFileSync(clean, 'export const clean = 1;\n');
    const cleanResult = await walkModuleGraph({ resolve: () => Promise.resolve(null) }, [clean]);
    expect(cleanResult.diagnostics).toEqual([]);
    expect(cleanResult.skipped.analysisFailed).toEqual(0);
  } finally {
    warn.mockRestore();
  }
});
