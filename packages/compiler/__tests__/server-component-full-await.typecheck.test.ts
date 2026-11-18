/**
 * TSX-17 `T+` / `T−` — the server async boundary at the TYPE level.
 *
 * The M14 full-await fixtures next door
 * (`server-component-full-await.test.ts`) are a compile/emit suite: they assert
 * emitted text and located `OEC9032` refusals, and they say so themselves — the
 * M14-2 class-parity row comments "this fixture is compiled, never
 * type-checked". So the semantic matrix's two type cells for TSX-17 stayed
 * `not claimed`: "type-checks with the authored types" and "a type error is
 * reported for the stated misuse" had no artifact at any recorded SHA. This
 * file is that artifact.
 *
 * The law pinned here is the one
 * [the M14 definition](../../../docs/architecture/m14-full-await-definition.md)
 * states in §2, not a new one:
 *
 *   - `T+` — an async server function component whose awaits sit in the two
 *     admitted positions type-checks against the workspace's own authored JSX
 *     declarations: D1 (`{await load(props.id)}` and the sanctioned
 *     `{await props.p}` as the whole text child) and D2
 *     (`<Child value={await load(props.id)} />` — one leading await as the
 *     whole prop value, `Child` another server function component composed by
 *     direct call).
 *   - `T−` — an UN-AWAITED `Promise<...>` reaching a nested server-component
 *     sink is a TypeScript error. That is the read-side half of the same law:
 *     `{await props.p}` / `value={await props.p}` are the sanctioned spellings,
 *     so the pending thenable must not arrive at a sink. The compiler refuses
 *     the children-channel read with the M14-2 message ("a Promise is not a
 *     normal child") and — because a component prop is admitted as a literal or
 *     a `props.<field>` read, never type-inspected — admits the prop-channel
 *     read, where the checker is the only guard.
 *
 * SCOPE LIMITS, recorded because they bound what these two cells mean (the
 * matrix annex states the same two limits):
 *
 *   1. The M14-2 shape at an INTRINSIC sink — `{props.p}` / `title={props.p}`
 *      on `<p>` — is NOT a TypeScript error. The authored JSX namespace types
 *      an intrinsic element's attributes as `Record<string, unknown>` and its
 *      children channel as `unknown` (`packages/element/src/jsx-runtime.ts`),
 *      so `Promise<string>` is accepted at both; the refusal there is the
 *      compiler's located `OEC9032` and nothing else. `T−` is therefore claimed
 *      on the NESTED SERVER-COMPONENT sink, where the authored prop types are
 *      declared (`value: string`, `children?: string`) and the checker sees the
 *      pending value. The intrinsic-sink case stays a compile-lane refusal
 *      (`C−`), never a type one — claiming it as `T−` would be a false pass.
 *   2. The R7 composition channel as AUTHORED (`<Child />` where `Child` is
 *      declared `async`) does not type-check either: the checker rejects a
 *      Promise-returning function as a JSX component (`TS2786`), because the
 *      authored JSX element type is nominal and not a thenable. That is the
 *      same rule R3 enforces at compile time for a sync parent — the compiler
 *      admits the shape only when the parent is async and awaits the direct
 *      call. `T+` therefore composes a SYNC child, exactly like the runtime
 *      suite's D2 rows.
 *
 * The check is the package's EXISTING one — `typeCheckEmittedModule`, the #1386
 * emitted-module gate — so the fixture inherits the real `strict` options and a
 * workspace resolution map instead of standing up a second harness (P6). No
 * admission rule, compiler behaviour or public export moves for this file: it
 * asks the checker the question the matrix asks.
 */

import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';
import ts from 'typescript';
import { readPackage } from '../../../tools/lib/package-graph.ts';
import {
  CompiledElementError,
  type ElementCompilerDiagnostic,
} from '../src/internal/compiler/semantic-core/compiler-diagnostics.ts';
import { compileServerComponentModule } from '../src/internal/compiler/semantic-core/server-component.ts';
import {
  type EmittedModuleDiagnostic,
  typeCheckEmittedModule,
} from '../src/internal/compiler/semantic-core/type-check.ts';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * The workspace module map, built from each package's own declared `exports` —
 * the same map the #1386 gate (`packages/element/__tests__/compiler-emitted-
 * module-typecheck.test.ts`) and the M03 matrix build. Reading it from the
 * manifests rather than hardcoding `@openelement/element` means the fixture
 * resolves `@openelement/element/jsx-runtime` (the automatic JSX transform's
 * entrypoint, and therefore the JSX namespace) the way a consumer's tsconfig
 * would. Anchored at this file's URL, never at `process.cwd()`: the suite runs
 * as a package task whose CWD is the package directory.
 */
async function workspacePaths(): Promise<Record<string, string[]>> {
  const packagesDir = resolve(REPO_ROOT, 'packages');
  const paths: Record<string, string[]> = {};
  for (const entry of readdirSync(packagesDir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (!entry.isDirectory()) continue;
    const pkg = await readPackage(resolve(packagesDir, entry.name));
    if (!pkg) continue;
    const exports = typeof pkg.exports === 'string' ? { '.': pkg.exports } : (pkg.exports ?? {});
    for (const [subpath, source] of Object.entries(exports)) {
      const specifier = subpath === '.' ? pkg.name : `${pkg.name}/${subpath.replace(/^\.\//, '')}`;
      paths[specifier] = [resolve(pkg.dir, String(source).replace(/^\.\//, ''))];
    }
  }
  return paths;
}

/**
 * The compiler options the AUTHORED fixture is checked under. Deliberately
 * narrow: the automatic JSX transform entrypoint (`jsxImportSource`) is what
 * supplies the JSX namespace, and `types: []` keeps ambient Node globals out of
 * the program so a diagnostic can only originate in the fixture. Everything
 * else — `strict`, `target`, module resolution, `allowImportingTsExtensions` —
 * comes from `typeCheckEmittedModule`'s own defaults, so the fixture inherits
 * the repository's real strictness instead of restating it.
 */
const AUTHORED_OPTIONS: ts.CompilerOptions = {
  jsx: ts.JsxEmit.ReactJSX,
  jsxImportSource: '@openelement/element',
  types: [],
};

const PAGE_ID = '/proj/app/server/page.tsx';

/**
 * The child module both halves compose: a real SYNC server function component
 * with the settled prop types a consumer authors. `value` is the D2 prop the
 * parent awaits into; `children` is the final-HTML string the compiler's own
 * `props.children is not declared` refusal tells authors to declare.
 */
const CHILD_SOURCE = [
  'export function Child(props: { value: string; children?: string }) {',
  '  return <span>{props.value}{props.children}</span>;',
  '}',
  '',
].join('\n');

/**
 * `T+` — the admitted shapes in one module: D1 with a call operand, D1 with the
 * sanctioned Promise field, and D2 with an awaited call as the whole prop value.
 * `load` is DECLARED rather than imported so the fixture states the awaited
 * operand grammar (R4: `await <identifier>(<literal or props.field>)`) without a
 * third module.
 */
const T_PLUS_PAGE = [
  "import { Child } from './child.tsx';",
  '',
  'export async function Page(props: { id: string; p: Promise<string> }) {',
  '  return (',
  '    <article>',
  '      <p>{await load(props.id)}</p>',
  '      <p>{await props.p}</p>',
  '      <Child value={await load(props.id)} />',
  '    </article>',
  '  );',
  '}',
  '',
  'declare function load(id: string): Promise<string>;',
  '',
].join('\n');

/**
 * `T−`, prop channel — the pending Promise reaches the child's declared
 * `value: string`. The compiler ADMITS this shape (see the test body), so the
 * checker is the only boundary: exactly the case a `T−` cell exists to certify.
 */
const T_MINUS_PROP_PAGE = [
  "import { Child } from './child.tsx';",
  '',
  'export async function Page(props: { p: Promise<string> }) {',
  '  return <article><Child value={props.p} /></article>;',
  '}',
  '',
].join('\n');

/**
 * `T−`, children channel — the same read at the nested component's text
 * channel. Both lanes refuse it, at the same authored character, so this row
 * pins the law at its strongest: the type cell and the compile cell locate one
 * position.
 */
const T_MINUS_CHILDREN_PAGE = [
  "import { Child } from './child.tsx';",
  '',
  'export async function Page(props: { p: Promise<string> }) {',
  '  return <article><Child value="x">{props.p}</Child></article>;',
  '}',
  '',
].join('\n');

let scratch: string | undefined;

afterEach(() => {
  if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
});

/**
 * Type-check one authored pair. The child rides an OS tmpdir (never inside the
 * repo) so the parent's idiomatic `'./child.tsx'` specifier resolves through a
 * real directory — the authored spelling every existing D2 fixture uses and
 * the one the compiler's host resolver is handed below.
 */
async function typeCheckPair(pageSource: string): Promise<EmittedModuleDiagnostic[]> {
  scratch = mkdtempSync(join(tmpdir(), 'oe-tsx17-'));
  writeFileSync(join(scratch, 'child.tsx'), CHILD_SOURCE);
  return typeCheckEmittedModule(pageSource, join(scratch, 'page.tsx'), {
    paths: await workspacePaths(),
    compilerOptions: AUTHORED_OPTIONS,
  });
}

/** The authored position of `fragment`, 1-based — the runtime suite's helper. */
function locationOf(source: string, fragment: string): { line: number; character: number } {
  const offset = source.indexOf(fragment);
  if (offset < 0) throw new Error(`fragment not found in source: ${fragment}`);
  const before = source.slice(0, offset);
  return { line: before.split('\n').length, character: offset - before.lastIndexOf('\n') };
}

/** Every diagnostic rendered, so a failing expectation prints what it saw. */
function report(diagnostics: readonly EmittedModuleDiagnostic[]): string {
  return diagnostics
    .map((item) => `TS${item.code} ${item.line}:${item.character} ${item.message}`)
    .join('\n');
}

/**
 * Compile the same authored page through the production server-component entry,
 * with the child supplied through the host resolver — the lane the runtime
 * suite drives. A `T+` fixture that type-checked but was NOT admitted would not
 * state the definition's law, so the test asserts both.
 */
function compilePage(pageSource: string): string {
  const result = compileServerComponentModule(pageSource, PAGE_ID, {
    resolveModule: (specifier) => (specifier === './child.tsx' ? CHILD_SOURCE : undefined),
  });
  expect(result).not.toBeNull();
  return result!.code;
}

/** The located refusals a page raises, or `[]` when it is admitted. */
function refusalDiagnostics(pageSource: string): ElementCompilerDiagnostic[] {
  try {
    compileServerComponentModule(pageSource, PAGE_ID, {
      resolveModule: (specifier) => (specifier === './child.tsx' ? CHILD_SOURCE : undefined),
    });
  } catch (error) {
    expect(error).toBeInstanceOf(CompiledElementError);
    return (error as CompiledElementError).diagnostics;
  }
  return [];
}

describe('TSX-17 T+ / T− — the server async boundary against the authored types', () => {
  test('TSX-17 T+: an admitted async server-component shape type-checks', async () => {
    // The compile half first: this exact module must be ADMITTED, so the type
    // result below is a statement about the definition's shape and not about an
    // arbitrary type-clean program.
    const emitted = compilePage(T_PLUS_PAGE);
    expect(emitted).toContain('__t(await load(props.id))');
    expect(emitted).toContain('__t(await props.p)');
    // D2 as authored: the awaited value IS the child's prop value.
    expect(emitted).toContain('Child({ "value": await load(props.id) })');

    const diagnostics = await typeCheckPair(T_PLUS_PAGE);
    expect(diagnostics, `the admitted shape must type-check; got:\n${report(diagnostics)}`).toEqual(
      [],
    );
  }, 60_000);

  test('TSX-17 T−: an un-awaited Promise crossing a nested server-component sink is a type error', async () => {
    // ── prop channel: the checker is the only guard ────────────────────────
    // A component prop is admitted as a literal or a `props.<field>` read; the
    // compiler never inspects its type. So this shape compiles and the pending
    // Promise is caught by TypeScript alone — the cell's whole point.
    expect(
      refusalDiagnostics(T_MINUS_PROP_PAGE),
      'a component prop is a literal or a props.<field> read: the compiler does not type it',
    ).toEqual([]);
    const propDiagnostics = await typeCheckPair(T_MINUS_PROP_PAGE);
    expect(
      propDiagnostics.length,
      `exactly one assignability error is expected; got:\n${report(propDiagnostics)}`,
    ).toBe(1);
    const [propError] = propDiagnostics;
    // The CODE and the authored position, never "there were errors": an
    // unrelated diagnostic must not be able to make this cell pass. TypeScript
    // reports an attribute assignability failure on the attribute NAME, which
    // is what `value={` below locates.
    expect(propError!.code).toBe(2322);
    expect(propError!.message).toBe("Type 'Promise<string>' is not assignable to type 'string'.");
    expect({ line: propError!.line, character: propError!.character }).toEqual(
      locationOf(T_MINUS_PROP_PAGE, 'value={props.p}'),
    );

    // ── children channel: both lanes refuse the same read at one position ──
    const childrenDiagnostics = await typeCheckPair(T_MINUS_CHILDREN_PAGE);
    expect(
      childrenDiagnostics.length,
      `exactly one assignability error is expected; got:\n${report(childrenDiagnostics)}`,
    ).toBe(1);
    const [childrenError] = childrenDiagnostics;
    expect(childrenError!.code).toBe(2322);
    expect(childrenError!.message).toBe(
      "Type 'Promise<string>' is not assignable to type 'string'.",
    );
    expect({ line: childrenError!.line, character: childrenError!.character }).toEqual(
      locationOf(T_MINUS_CHILDREN_PAGE, '{props.p}'),
    );

    const refusals = refusalDiagnostics(T_MINUS_CHILDREN_PAGE);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]!.code).toBe('OEC9032');
    // The M14-2 sentence, so the type cell and the compile cell name one law.
    expect(refusals[0]!.message).toContain('a Promise is not a normal child');
    expect(refusals[0]!.message).toContain('props.p is annotated Promise<...>');
    expect({ line: refusals[0]!.line, character: refusals[0]!.character }).toEqual({
      line: childrenError!.line,
      character: childrenError!.character,
    });
  }, 60_000);
});
