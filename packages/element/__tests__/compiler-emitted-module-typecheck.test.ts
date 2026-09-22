/**
 * The emitted compiled module type-checks (#1386 item 2).
 *
 * The compiler emits the compiled module as TypeScript text and the bundler
 * lowers it. Before this check existed nothing type-checked that text, so the
 * "strict emission" corpus in `compiled-element-v1.test.ts` had to pin
 * individual `static` annotations by string match — a proxy for the real
 * question, and one that only covers the annotations somebody remembered.
 *
 * These cases ask the real question instead, over the fixtures the compiler
 * gates itself with: does the emitted program compile under `strict` against
 * the package's own declarations? The resolution map comes from the workspace
 * so the check resolves `@openelement/element` exactly as a consumer's
 * `tsconfig` would.
 */
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { fromFileUrl, join, resolve } from '@std/path';
import { compileElementProgram } from '../src/internal/compiler/semantic-core/compile.ts';
import {
  type EmittedModuleDiagnostic,
  typeCheckEmittedModule,
} from '../src/internal/compiler/semantic-core/type-check.ts';
import { typeCheckEmittedModule as typeCheckFromSubpath } from '../src/compiler.ts';
import { readPackage } from '../../../tools/lib/package-graph.ts';

const REPO_ROOT = fromFileUrl(new URL('../../../', import.meta.url));

/**
 * The workspace module resolution map: every package's declared `exports`, in
 * the same form `tools/repo/check-public-interface-snapshot.ts` builds for its
 * type-checking pass. Reading it from the manifests rather than hardcoding one
 * specifier means a new subpath is covered without editing this test.
 *
 * The walk is anchored at `REPO_ROOT` rather than `readPackages()`: that helper
 * reads `packages` relative to the process CWD, because every caller of it is a
 * root task. This suite is a package task, and `gate.ts` runs a package task as
 * `deno task --cwd packages/<name> <task>` — under which a relative walk throws
 * before a single test runs. Resolving each manifest path from this file's own
 * URL keeps the map identical under both invocation forms.
 */
async function workspacePaths(): Promise<Record<string, string[]>> {
  const packagesDir = join(REPO_ROOT, 'packages');
  const paths: Record<string, string[]> = {};
  const entries = [];
  for await (const entry of Deno.readDir(packagesDir)) {
    if (entry.isDirectory) entries.push(entry.name);
  }
  for (const name of entries.sort()) {
    const pkg = await readPackage(join(packagesDir, name));
    if (!pkg) continue;
    const exports = typeof pkg.exports === 'string' ? { '.': pkg.exports } : pkg.exports ?? {};
    for (const [subpath, source] of Object.entries(exports)) {
      const specifier = subpath === '.' ? pkg.name : `${pkg.name}/${subpath.replace(/^\.\//, '')}`;
      paths[specifier] = [resolve(pkg.dir, String(source).replace(/^\.\//, ''))];
    }
  }
  return paths;
}

const PATHS = await workspacePaths();

/** Compile one authored module and require that its emitted text type-checks. */
function emittedDiagnostics(source: string, id: string): EmittedModuleDiagnostic[] {
  const { code } = compileElementProgram(source, id);
  return typeCheckEmittedModule(code, id, { paths: PATHS });
}

Deno.test('#1386: the compiled module for the canonical counter fixture type-checks', async () => {
  const source = await Deno.readTextFile(
    join(REPO_ROOT, 'packages/element/__fixtures__/compiled-element-v1/counter.tsx'),
  );
  const diagnostics = emittedDiagnostics(source, '/project/app/islands/counter.tsx');
  assertEquals(
    diagnostics,
    [],
    `the emitted module must type-check; got:\n${
      diagnostics.map((d) => `${d.line}:${d.character} TS${d.code} ${d.message}`).join('\n')
    }`,
  );
});

Deno.test('#1386: the emitted module type-checks across the authoring grammar', () => {
  // One case per construct the emitter synthesizes around: a property with a
  // converter, a computed field, an event handler reference, a keyed list, a
  // conditional Region, and a styles annotation. These are exactly the sites
  // where the emitter writes `static`/`const` declarations of its own.
  const sources: Array<[string, string]> = [
    [
      'properties + handlers + regions',
      [
        "import { element, OpenElement, property } from '@openelement/element';",
        "@element('oe-check-regions')",
        'export class CheckRegions extends OpenElement {',
        '  @property({ reflect: true }) count = 0;',
        '  @property({ reflect: false }) items: Array<{ id: string; text: string }> = [];',
        '  increment(): void { this.count++; }',
        '  render() {',
        '    return (',
        '      <div>',
        '        <button type="button" onClick={this.increment}>+</button>',
        '        {this.count > 0 ? <p>positive</p> : <p>zero</p>}',
        '        <ul>{this.items.map((item) => <li key={item.id}>{item.text}</li>)}</ul>',
        '      </div>',
        '    );',
        '  }',
        '}',
      ].join('\n'),
    ],
    [
      'computed field + styles',
      [
        'import {',
        '  computed,',
        '  type ReadonlySignal,',
        '  element,',
        '  OpenElement,',
        '  property,',
        "} from '@openelement/element';",
        "@element('oe-check-computed', { root: 'shadow-open' })",
        'export class CheckComputed extends OpenElement {',
        "  @property({ reflect: false }) label = '';",
        '  @property({ reflect: false, attribute: false }) observed: ReadonlySignal<boolean> =',
        "    computed(() => this.label === '');",
        '  render() { return <p>{this.label}</p>; }',
        '}',
      ].join('\n'),
    ],
  ];
  for (const [name, source] of sources) {
    const diagnostics = emittedDiagnostics(source, `/project/app/islands/${name}.tsx`);
    assertEquals(
      diagnostics,
      [],
      `${name} must emit a type-checking module; got:\n${
        diagnostics.map((d) => `${d.line}:${d.character} TS${d.code} ${d.message}`).join('\n')
      }`,
    );
  }
});

Deno.test('#1386: the check reports a real diagnostic instead of passing vacuously', () => {
  // The negative control: an emitted module whose program is fine but whose
  // surrounding text is not. This proves the checker runs a real program
  // rather than returning an empty array for whatever text it is handed.
  const broken = [
    "import { OpenElement } from '@openelement/element';",
    'export class Broken extends OpenElement {',
    '  static nope: number = "not a number";',
    '  render(): never { throw new Error("x"); }',
    '}',
  ].join('\n');
  const diagnostics = typeCheckEmittedModule(broken, '/project/app/islands/broken.tsx', {
    paths: PATHS,
  });
  assert(diagnostics.length > 0, 'a type error must be reported');
  assertStringIncludes(
    diagnostics.map((d) => `${d.code} ${d.message}`).join('\n'),
    'is not assignable',
  );
});

Deno.test('#1386: the check is a pure function of its inputs (ADR-0148)', () => {
  const source = [
    "import { element, OpenElement, property } from '@openelement/element';",
    "@element('oe-check-pure')",
    'export class CheckPure extends OpenElement {',
    "  @property({ reflect: false }) label = '';",
    '  render() { return <span>{this.label}</span>; }',
    '}',
  ].join('\n');
  const { code } = compileElementProgram(source, '/project/app/islands/check-pure.tsx');
  const first = typeCheckEmittedModule(code, '/project/app/islands/check-pure.tsx', {
    paths: PATHS,
  });
  const second = typeCheckEmittedModule(code, '/project/app/islands/check-pure.tsx', {
    paths: PATHS,
  });
  // Two runs over identical inputs agree: no clock, no ambient state, no cache.
  assertEquals(first, second);
  assertEquals(first, []);
});

Deno.test('#1386: the check is reachable from the /compiler subpath a consumer imports', () => {
  // The public entry and the semantic core must be the same implementation:
  // a consumer verifies its own components through the subpath, and the gate
  // above must not be checking a different function.
  assertEquals(typeCheckFromSubpath, typeCheckEmittedModule);
});

Deno.test('#1386: the Vite plugin gates a build on the emitted module when asked', async () => {
  const { compiledElementPlugin } = await import('../src/internal/compiler/plugin.ts');
  const source = [
    "import { element, OpenElement, property } from '@openelement/element';",
    "@element('oe-check-plugin-gate')",
    'export class CheckPluginGate extends OpenElement {',
    "  @property({ reflect: false }) label = '';",
    '  render() { return <div>{this.label}</div>; }',
    '}',
  ].join('\n');
  const id = '/project/app/islands/check-plugin-gate.tsx';

  const runTransform = (
    plugin: { transform?: unknown },
    onError: (error: unknown) => never,
  ): string | null => {
    const transform = plugin.transform as unknown as (
      this: { error: (error: unknown) => never },
      code: string,
      id: string,
    ) => string | null;
    return transform.call({ error: onError }, source, id);
  };

  // Default (dev-server) behaviour: emit without running a type checker.
  const plain = runTransform(compiledElementPlugin(), (error) => {
    throw error;
  });
  assert(typeof plain === 'string', 'the default hook emits the compiled module');

  // Opt-in build behaviour on a module that DOES type-check: the gate runs and
  // the emitted bytes are unchanged. (That the gate fires on a module which
  // does not type-check is the checker's own negative control above — the
  // compiler cannot be made to emit invalid TypeScript from valid authoring,
  // which is exactly the property this check exists to keep true.)
  const errors: unknown[] = [];
  const gated = runTransform(
    compiledElementPlugin({ typeCheckEmitted: true, resolutionPaths: PATHS }),
    (error) => {
      errors.push(error);
      throw error;
    },
  );
  assertEquals(errors, [], 'a type-checking emitted module must not fail the gate');
  assertEquals(gated, plain, 'the check must not change emitted bytes');
});
