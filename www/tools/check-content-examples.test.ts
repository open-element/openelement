/**
 * check-content-examples.test.ts — negative proof for the content gate's
 * docs-bug invariant (documented code must compile).
 *
 * The gate now runs every maintained-surface fence that authors a compiled
 * unit through the real compiler. This file pins the failure direction with
 * the exact shape the user-path audit reported as D4 (`recipe-form-actions`
 * branch text interpolation, `www/content/docs/guide/recipe-form-actions.md`
 * at the base SHA): that page is being rewritten in parallel, so the snippet
 * lives here as a stable local fixture rather than reaching into the doc:
 *
 *   - the D4 branch-text shape is RED (OEC9012), carrying the compiler's own
 *     boundary+fix message;
 *   - the working shape the fixtures use (static branch text plus an
 *     attribute-bound value) is GREEN;
 *   - a fragment fence (no compiled unit) is not compile-run, by the
 *     compiler's own admission boundary;
 *   - the only excluded pages are the documented-rejection grammar reference
 *     (en + zh) and the exclusion is explicit, never a silent skip.
 *
 * The coverage classes are pinned too (DOC-02 audit): which fences are
 * discovered (ts/tsx/typescript/js/javascript, trailing spacing tolerated),
 * which stay out of the compiler (shell/JSON/text, fragments), the import
 * invariant's negative direction, the authoring-pattern tripwires, the elision
 * suppression boundary, and the second admission bridge — a server function
 * page (ADR-0169) is admitted by `compileServerComponentIfAdmitted`, so its
 * own OEC sink denial proves that bridge is live.
 */
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import {
  compileExample,
  compileExamples,
  extractExamples,
  isCompileExcluded,
  suppressElidedDiagnostic,
  validateAuthoringPatterns,
  validateFrameworkImports,
  type ContentExample,
} from './check-content-examples.ts';

let serial = 0;

function example(code: string, file = 'www/content/docs/guide/fixture.md'): ContentExample {
  serial++;
  return { file, index: serial, lang: 'tsx', code };
}

/** The D4 shape (branch text interpolation): the generated lane refuses it. */
const D4_BRANCH_TEXT = `import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ tag: 'contact-page', root: 'shadow' });

export default function ContactPage(props: { error: string }) {
  return (
    <main>
      <h1>contact</h1>
      {props.error ? 'has errors' : 'no errors'}
    </main>
  );
}
`;

/** The compiled working shape the router fixtures use: static branch text. */
const STATIC_BRANCH_TEXT = `import { defineIslandConfig } from '@openelement/router';
import { signal } from '@openelement/element';

export const openElement = defineIslandConfig({ tag: 'contact-page', root: 'shadow' });

export default function ContactPage() {
  const error = signal('');

  return (
    <main>
      <h1>contact</h1>
      {error.value ? <p role='alert'>Please fix the errors above.</p> : <span></span>}
    </main>
  );
}
`;

test('the D4 branch-text recipe is caught red with the compiler diagnostic', () => {
  const failures = compileExample(example(D4_BRANCH_TEXT));
  expect(failures.length).toBeGreaterThan(0);
  expect(failures[0]!.message).toContain('OEC9042');
  expect(failures[0]!.message).toContain('a conditional branch must be JSX or null');
  expect(failures[0]!.file).toContain('fixture.md');
});

test('the working static-branch-text shape compiles clean', () => {
  expect(compileExample(example(STATIC_BRANCH_TEXT))).toEqual([]);
});

test('an island config sidecar is admitted exactly like the real build', () => {
  const island = `import { defineIslandConfig } from '@openelement/router';
import { signal } from '@openelement/element';

export const openElement = defineIslandConfig({
  tag: 'hello-counter',
  hydrate: 'idle',
  ssr: true,
  dsd: true,
});

export default function HelloCounter() {
  const count = signal(0);

  return <button type='button'>{count.value}</button>;
}
`;
  expect(compileExample(example(island))).toEqual([]);
});

test('a fragment fence is not compile-run (the compiler boundary rejects it as a unit)', () => {
  const fragment = `const view = <div>{this.flag ? <b>a</b> : <i>b</i>}</div>;`;
  expect(compileExample(example(fragment))).toEqual([]);
});

test('the documented-rejection grammar reference is the explicit exclusion; nothing else is', () => {
  expect(isCompileExcluded('www/content/docs/guide/compiled-grammar.md')).toBe(true);
  expect(isCompileExcluded('www/content/docs/guide/compiled-grammar.zh.md')).toBe(true);
  for (const page of [
    'www/content/docs/guide/routing-and-data.md',
    'www/content/docs/guide/error-handling.md',
    'www/content/docs/guide/configuration.md',
    'www/content/docs/guide/i18n.md',
  ]) {
    expect(isCompileExcluded(page), `${page} must not be excluded`).toBe(false);
  }
});

test('the documented-rejection exclusion matches the absolute paths the content walk produces', () => {
  // checkContent() readdir()s an absolute root, so example.file is absolute;
  // the allowlist is keyed repo-relative. Both spellings must agree, or the
  // documented exclusion is dead code that only the relative test fixtures see.
  const grammar = fileURLToPath(
    new URL('../../www/content/docs/guide/compiled-grammar.md', import.meta.url),
  );
  expect(isCompileExcluded(grammar)).toBe(true);
  expect(compileExample({ ...example(D4_BRANCH_TEXT), file: grammar })).toEqual([]);
});

test('compileExamples runs every fence it is given and aggregates the failures', () => {
  const failures = compileExamples([example(D4_BRANCH_TEXT), example(STATIC_BRANCH_TEXT)]);
  expect(failures.length).toBeGreaterThan(0);
  expect(failures.every((failure) => failure.message.includes('OEC9042'))).toBe(true);
});

// ─────────────────────────────────────────────────────────────────────────────
// Coverage classes and the second admission bridge (DOC-02 audit)
// ─────────────────────────────────────────────────────────────────────────────

/** Wrap a body in one fenced block, without a template literal. */
function fenced(lang: string, body: string): string {
  return '```' + lang + '\n' + body + '\n```';
}

/** A server function page (ADR-0169): owned by the second admission bridge. */
const SERVER_FUNCTION_PAGE = [
  'export function Notice(props: { heading: string }) {',
  '  return (',
  '    <main>',
  '      <h1>{props.heading}</h1>',
  '    </main>',
  '  );',
  '}',
  '',
].join('\n');

/** The same lane's sink denial: innerHTML without a TrustedHtml property. */
const SERVER_FUNCTION_UNSAFE_SINK =
  'export function Notice(props: { html: string }) {\n' +
  '  return <main innerHTML={props.html}></main>;\n' +
  '}\n';

test('a server function page fence is compile-run by the second admission bridge (OEC9026 proof)', () => {
  // A fragment answers null from BOTH bridges; only the server-function bridge
  // admits this shape, so the negative case proves that bridge is exercised.
  expect(compileExample(example(SERVER_FUNCTION_PAGE))).toEqual([]);
  const failures = compileExample(example(SERVER_FUNCTION_UNSAFE_SINK));
  expect(failures.length).toBeGreaterThan(0);
  expect(failures[0]!.message).toContain('OEC9026');
  expect(failures[0]!.file).toContain('fixture.md');
});

test('only ts-family fences are discovered; shell, JSON and text fences never reach the compiler', () => {
  const framework = "import { definePage } from '@openelement/router';";
  expect(extractExamples('f.md', fenced('bash', 'npm create @openelement my-app'))).toEqual([]);
  expect(extractExamples('f.md', fenced('json', '{ "openElement": true }'))).toEqual([]);
  expect(extractExamples('f.md', fenced('text', '@openelement/router'))).toEqual([]);
  const tsx = extractExamples('f.md', fenced('tsx', framework));
  expect(tsx).toHaveLength(1);
  expect(tsx[0]!.lang).toBe('tsx');
  // ```js/```javascript fences are checked as TypeScript (module header).
  const js = extractExamples('f.md', fenced('js', framework));
  expect(js).toHaveLength(1);
  expect(js[0]!.lang).toBe('ts');
  // No framework import: a fragment, and fragments are not compile-run.
  expect(extractExamples('f.md', fenced('tsx', 'const view = <p>hi</p>;'))).toEqual([]);
});

test('a fence opener with trailing whitespace or CRLF is still discovered (no silent skip)', () => {
  const framework = "import { definePage } from '@openelement/router';\n";
  expect(extractExamples('f.md', '```' + 'tsx \n' + framework + '```')).toHaveLength(1);
  expect(extractExamples('f.md', '```' + 'tsx\r\n' + framework + '```')).toHaveLength(1);
});

test('import validation fails unknown subpaths/exports and resolves inline type/alias modifiers', () => {
  const inventory = new Map([['@openelement/router', new Set(['definePage'])]]);
  const router = fenced('ts', "import { definePage } from '@openelement/router';");
  expect(validateFrameworkImports('f.md', router, inventory)).toEqual([]);
  const modifiers = fenced(
    'ts',
    "import { type definePage, definePage as page } from '@openelement/router';",
  );
  expect(validateFrameworkImports('f.md', modifiers, inventory)).toEqual([]);
  const badSubpath = validateFrameworkImports(
    'f.md',
    fenced('ts', "import { definePage } from '@openelement/router/server-runtime';"),
    inventory,
  );
  expect(badSubpath[0]!.message).toContain(
    "unknown @openelement subpath '@openelement/router/server-runtime'",
  );
  const badExport = validateFrameworkImports(
    'f.md',
    fenced('ts', "import { notARealExport } from '@openelement/router';"),
    inventory,
  );
  expect(badExport[0]!.message).toContain(
    "'notARealExport' is not exported from '@openelement/router'",
  );
  // A shell fence is not an import site: the invariant never reads shell lines.
  expect(
    validateFrameworkImports(
      'f.md',
      fenced('bash', "import { x } from '@openelement/nope';"),
      inventory,
    ),
  ).toEqual([]);
});

test('authoring-pattern tripwires reject a render() local and a hand-rolled message replace', () => {
  const local = validateAuthoringPatterns(
    'f.md',
    fenced('tsx', 'render() {\n  const total = 1;\n  return <p>{total}</p>;\n}'),
  );
  expect(local).toHaveLength(1);
  expect(local[0]!.message).toContain('render() declares a local');
  const manual = validateAuthoringPatterns(
    'f.md',
    fenced('ts', "const text = pattern.replace('{count}', String(n));"),
  );
  expect(manual).toHaveLength(1);
  expect(manual[0]!.message).toContain('real formatter');
  expect(
    validateAuthoringPatterns(
      'f.md',
      fenced('tsx', 'render() {\n  return <p>{this.total}</p>;\n}'),
    ),
  ).toEqual([]);
});

test('elision suppression hides only elided context, never a framework-surface error', () => {
  const diagnostic = (code: number, messageText: string) =>
    ({ code, messageText }) as unknown as Parameters<typeof suppressElidedDiagnostic>[0];
  const vite = "Cannot find module 'vite' or its corresponding type declarations.";
  const generated =
    "Cannot find module '@openelement/generated/routes' or its corresponding type declarations.";
  const unknownPkg =
    "Cannot find module '@openelement/nope' or its corresponding type declarations.";
  expect(suppressElidedDiagnostic(diagnostic(2307, vite))).toBe(true);
  expect(suppressElidedDiagnostic(diagnostic(2307, generated))).toBe(true);
  expect(suppressElidedDiagnostic(diagnostic(2307, unknownPkg))).toBe(false);
  expect(suppressElidedDiagnostic(diagnostic(2304, "Cannot find name 'maybeUndefined'."))).toBe(
    true,
  );
  expect(suppressElidedDiagnostic(diagnostic(2304, "Cannot find name 'definePage'."))).toBe(false);
  expect(
    suppressElidedDiagnostic(diagnostic(7006, "Parameter 'x' implicitly has an 'any' type.")),
  ).toBe(true);
  expect(
    suppressElidedDiagnostic(diagnostic(2339, "Property 'title' does not exist on type '{}'.")),
  ).toBe(true);
  expect(
    suppressElidedDiagnostic(
      diagnostic(2339, "Property 'title' does not exist on type 'Article'."),
    ),
  ).toBe(false);
  expect(suppressElidedDiagnostic(diagnostic(1005, "';' expected."))).toBe(false);
});

test('compileExamples respects the documented-rejection exclusion and nothing else', () => {
  const excluded = example(D4_BRANCH_TEXT, 'www/content/docs/guide/compiled-grammar.md');
  expect(compileExample(excluded)).toEqual([]);
  const live = { ...excluded, file: 'www/content/docs/guide/recipe-form-actions.md' };
  expect(compileExample(live).length).toBeGreaterThan(0);
});
