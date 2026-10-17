/**
 * @openelement/router — the document reset is the APPLICATION's, not a
 * package's (ADR-0167 §5).
 *
 * An admitted package declaration is a fact about the PACKAGE's components. It
 * says nothing about the host document's `h1` margins, its list markers or its
 * native form controls, so enabling the compile on that fact alone must not
 * hand the application Tailwind's preflight. The application's own
 * `tailwind: true | { theme }` is the declaration that resets its document.
 *
 * The proof is COMPILED, never textual: both entry shapes go through the same
 * official compiler the pipeline mounts (`@tailwindcss/node`, resolved through
 * the `@tailwindcss/vite` peer exactly as `tailwind.ts` resolves it), with the
 * same deliberately role-free candidate set. A test that only grepped the
 * generated `@import` list would pass while the compiler still emitted a reset.
 */
import { createRequire } from 'node:module';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, expect, test } from 'vitest';
import { renderTailwindEntry } from '../src/vite/tailwind.ts';

const root = join(import.meta.dirname!, '../__test_fixtures__/tailwind-document-reset');

mkdirSync(root, { recursive: true });
writeFileSync(
  join(root, 'package.json'),
  JSON.stringify({ name: 'tailwind-document-reset-fixture', private: true, type: 'module' }),
  'utf8',
);
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** The official compiler, resolved through the peer the pipeline itself uses. */
async function officialCompiler() {
  const peerEntry = await import.meta.resolve('@tailwindcss/vite');
  const require = createRequire(peerEntry);
  const compilerEntry = require.resolve('@tailwindcss/node');
  const { compile } = (await import(pathToFileURL(compilerEntry).href)) as {
    compile: (
      css: string,
      options: Record<string, unknown>,
    ) => Promise<{ build: (candidates: string[]) => string }>;
  };
  return compile;
}

const CANDIDATES = ['p-4', 'flex', 'items-center'];

/** The entry as the client build admits it: one `@source inline()` per candidate. */
const withAdmissions = (entry: string): string =>
  `${entry}${CANDIDATES.map((candidate) => `@source inline("${candidate}");`).join('\n')}\n`;

/** Compile one rendered entry with the same options `compileComponentStyleSheet` passes. */
async function compileEntry(documentReset: boolean): Promise<string> {
  const compile = await officialCompiler();
  const entry = withAdmissions(renderTailwindEntry(root, { theme: [], documentReset }));
  const compiler = await compile(entry, {
    base: root,
    from: join(root, '.openElement/tailwind.css'),
    onDependency: () => {},
    shouldRewriteUrls: true,
  });
  return compiler.build([...CANDIDATES]);
}

/** Both compiles, once, memoized: three tests share them without ordering coupling. */
const compiled = {
  automatic: undefined as Promise<string> | undefined,
  declared: undefined as Promise<string> | undefined,
};
const automaticCss = (): Promise<string> => (compiled.automatic ??= compileEntry(false));
const declaredCss = (): Promise<string> => (compiled.declared ??= compileEntry(true));

/** The rule selectors of a compiled sheet (minifier-output agnostic). */
function selectors(css: string): string[] {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('{')
    .slice(0, -1)
    .map((part) => (part.split('}').pop() ?? '').replace(/\s+/g, ' ').trim())
    .filter((selector) => selector !== '' && !selector.startsWith('@'));
}

test('the automatic entry carries the theme and the utilities, and NO document reset', async () => {
  const css = await automaticCss();
  // The reduction is not "less CSS": the layers a light-root component's
  // delivery needs are present — the theme layer (its `:root, :host` seat and
  // the scale variable the admitted utility reads) and the utility rules.
  expect(css, 'the theme layer must be compiled').toContain(':root, :host');
  expect(css, 'the theme scale the admitted utility reads must survive').toContain(
    '--spacing: 0.25rem',
  );
  expect(css, 'the admitted utilities must be compiled').toContain('.p-4');
  // …and the document reset is the thing that is absent.
  expect(css, 'preflight must not zero the document box').not.toContain('box-sizing: border-box');
  expect(css, 'preflight must not unstyle lists').not.toContain('list-style: none');
  expect(css, 'preflight must not restyle native controls').not.toContain('::backdrop');
});

test('the application-declared entry still carries the document reset', async () => {
  const css = await declaredCss();
  expect(css, 'preflight is the declared application document reset').toContain(
    'box-sizing: border-box',
  );
  expect(css, 'the preflight list reset stays for the application').toContain('list-style: none');
  expect(css, 'the application entry is a full compile, utilities included').toContain('.p-4');
});

test('the delta between the two entries is the reset layer, nothing else', async () => {
  const automatic = new Set(selectors(await automaticCss()));
  const declared = new Set(selectors(await declaredCss()));
  expect(automatic.size, 'the automatic compile must produce rules').toBeGreaterThan(0);
  expect(
    declared.size,
    'the declared entry must be a strict superset — preflight is the delta',
  ).toBeGreaterThan(automatic.size);
  const automaticOnly = [...automatic].filter((selector) => !declared.has(selector));
  expect(automaticOnly, 'the reduced entry must never carry a rule the full one lacks').toEqual([]);
});
