/**
 * The generated leaf module against the workspace declarations.
 *
 * Every other emitted-module surface is type-checked against the real
 * declarations ("the emitted module type-checks against the workspace
 * declarations"); the generated leaf module was only ever bundled and run. It
 * is the module that imports the runtime's contract surface, so that gap is
 * exactly where a contract could be restated in a shape the type system would
 * have caught.
 *
 * Two checks, both compile-time:
 *
 *   1. a generated leaf module type-checks against the real runtime module it
 *      imports (the internal specifier mapped to this checkout's source);
 *   2. the marker vocabulary is closed: a module that tries to build a marker
 *      comment from a raw string does not type-check. That is the enforcement
 *      for `emitComment(marker: Marker)` — no registry, no scanner, no runtime
 *      assertion, just the checker the build already runs.
 */

import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { readPackage } from '../../../../tools/lib/package-graph.ts';
import { compileFunctionModule } from '../../src/internal/compiler/semantic-core/function-frontend.ts';
import { typeCheckEmittedModule } from '../../src/internal/compiler/semantic-core/type-check.ts';
import {
  GENERATED_LEAF_RUNTIME_SPECIFIER,
  generateLeafModule,
} from '../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const FILE = '/proj/src/leaf.tsx';

const CLASSIFIER = {
  classifySymbol: (specifier: string, importedName: string | null) => {
    if (specifier !== '@openelement/element') return undefined;
    if (importedName === 'signal' || importedName === 'computed') return 'factory' as const;
    return 'value' as const;
  },
  classifyValue: () => undefined,
  classifyCall: (specifier: string, importedName: string | null) => {
    if (specifier !== '@openelement/element') return undefined;
    if (importedName === 'signal') return { call: 'signal' as const };
    if (importedName === 'computed') return { call: 'computed' as const };
    return undefined;
  },
};

const SOURCE = `import { signal } from '@openelement/element';
function Leaf(props) {
  const count = signal(1);
  return <p id="t" data-n={count.value}>{count.value}</p>;
}
function Pair(props) {
  return <div><p>same</p><p>same</p></div>;
}
`;

/** The same workspace map the emitted-module typecheck gate builds, plus the
 * internal runtime specifier the generated module imports. */
async function resolutionPaths(): Promise<Record<string, string[]>> {
  const packagesDir = resolve(REPO_ROOT, 'packages');
  const paths: Record<string, string[]> = {};
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkg = await readPackage(resolve(packagesDir, entry.name));
    if (!pkg) continue;
    const exports = typeof pkg.exports === 'string' ? { '.': pkg.exports } : (pkg.exports ?? {});
    for (const [subpath, source] of Object.entries(exports)) {
      const specifier = subpath === '.' ? pkg.name : `${pkg.name}/${subpath.replace(/^\.\//, '')}`;
      paths[specifier] = [resolve(pkg.dir, String(source).replace(/^\.\//, ''))];
    }
  }
  // The generated module's runtime import is an internal (non-exported) path:
  // map it to this checkout's module so the emitted text is checked against
  // the real contract surface rather than a declaration stub.
  paths[GENERATED_LEAF_RUNTIME_SPECIFIER] = [
    resolve(REPO_ROOT, 'packages/element/src/internal/compiled/runtime.ts'),
  ];
  return paths;
}

function generatedModule(): string {
  const front = compileFunctionModule(SOURCE, FILE, { importClassifier: CLASSIFIER });
  expect(front.diagnostics).toEqual([]);
  const generated = generateLeafModule(front.module!);
  expect(generated.diagnostics.map((item) => item.message)).toEqual([]);
  return generated.module!;
}

describe('generated leaf module against the workspace declarations', () => {
  test('a generated leaf module type-checks against the runtime it imports', async () => {
    const code = generatedModule();
    // The module must exercise the contract surface this test exists for.
    expect(code).toContain('emitComment(');
    expect(code).toContain('rangeMarker(');
    expect(code).toContain('leafClaimMismatch(');

    // The generated artifact is plain JavaScript: its scaffolding (`const
    // __oe_nodes = []`, unannotated parameters) only type-checks under a
    // non-strict setting, and reporting that scaffolding would drown the signal
    // this check exists for — every import resolving and every runtime call
    // matching its signature. Argument assignability is not a strictness flag,
    // and the negative check below proves it still bites.
    const diagnostics = await typeCheckEmittedModule(code, FILE, {
      paths: await resolutionPaths(),
      compilerOptions: { strict: false },
    });
    expect(
      diagnostics,
      diagnostics
        .map(
          (item) =>
            `${item.line}:${item.character} TS${item.code} ${item.message}\n    > ${(code.split('\n')[item.line - 1] ?? '').trim()}`,
        )
        .join('\n'),
    ).toEqual([]);
  }, 60_000);

  test('a marker comment cannot be built from a raw string', async () => {
    // Same import the generated module uses, then the shape the vocabulary
    // forbids: a comment whose text is a hand-written string. If `emitComment`
    // ever widened to `string`, this module would start type-checking and the
    // expectation below would fail.
    const code = [
      `import { emitComment, MARKERS, rangeMarker } from ${JSON.stringify(GENERATED_LEAF_RUNTIME_SPECIFIER)};`,
      '',
      'export function markers() {',
      '  return [emitComment(MARKERS.when), emitComment(rangeMarker(0))];',
      '}',
      '',
      'export function forbidden() {',
      '  return emitComment("oe:made-up");',
      '}',
      '',
    ].join('\n');

    const diagnostics = await typeCheckEmittedModule(code, FILE, {
      paths: await resolutionPaths(),
    });
    const errors = diagnostics.filter((item) => item.code === 2345);
    expect(
      diagnostics.length,
      `expected exactly the string-argument rejection; got:\n${diagnostics
        .map((item) => `${item.line}:${item.character} TS${item.code} ${item.message}`)
        .join('\n')}`,
    ).toBeGreaterThan(0);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.message).toContain('Marker');
  }, 60_000);
});
