/**
 * @openelement/ui — the role table's DELIVERY guard (alpha15 S lane follow-up).
 *
 * CUSTOMIZATION.md promises the role table's SHAPE: "the role names declared in
 * the `@theme` block of src/theme.css (the full inventory below), each role's
 * [data-theme='dark'] dark pair, the forced-colors tier". That promise is a
 * delivery claim, and it is not free: the official compiler emits a `@theme`
 * variable only for the ones some generated UTILITY RULE references, and the
 * rules that consume most of these roles are the components' own authored
 * sheets — `.control`'s `color-mix(in srgb, var(--color-popover) …)`,
 * `:host(:state(disabled)) .control`'s `var(--color-muted)` — which are adopted
 * into shadow roots through the style-asset channel and are therefore invisible
 * to the compile. Under a plain `@theme` the pruned roles made those
 * declarations compute to nothing: the control lost its resting surface, its
 * hover border and its disabled wash while every existing guard stayed green
 * (they check that the SOURCE names roles, not that the COMPILE emits them).
 *
 * The guard drives the official engine (`tailwindcss`, the declared devDep) and
 * asserts the emitted theme block carries the whole inventory for BOTH entry
 * shapes the router renders. It never re-implements utility or theme syntax:
 * the entry text is the router's own form, and every CSS decision is the
 * compiler's.
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { compile } from 'tailwindcss';

const require = createRequire(import.meta.url);
const themeSourcePath = fileURLToPath(new URL('../src/theme.css', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const themeSource = await readFile(themeSourcePath, 'utf8');

/** Every role name the @theme block declares. */
function declaredRoles(css: string): string[] {
  const block = /@theme[^{]*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
  return [...block.matchAll(/(--color-[a-z0-9-]+)\s*:/g)].map((match) => match[1]!).sort();
}

/** The roles the @theme block actually emits into the theme layer. */
function emittedRoles(css: string): Set<string> {
  const at = css.indexOf(':root, :host');
  if (at === -1) return new Set();
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  return new Set(
    [...css.slice(open + 1, close).matchAll(/(--color-[a-z0-9-]+)\s*:/g)].map((m) => m[1]!),
  );
}

/**
 * The official engine's stylesheet loader: resolve a specifier to the CSS file
 * it names and read it. The literal id first (a subpath like
 * `tailwindcss/theme.css` is already a stylesheet), then the package's own
 * `index.css` — the file its `style` export condition points at, which is what
 * a bare `@import 'tailwindcss'` means. A resolution that is not CSS (the
 * package's JS entry) is never accepted.
 */
async function loadStylesheet(id: string) {
  const candidates = [id, `${id}/index.css`];
  for (const candidate of candidates) {
    try {
      const path = require.resolve(candidate);
      if (path.endsWith('.css')) {
        return { path, base: dirname(path), content: await readFile(path, 'utf8') };
      }
    } catch {
      // Not resolvable this way; try the next spelling.
    }
  }
  throw new Error(`the role-delivery guard cannot resolve the stylesheet "${id}"`);
}

/** Compile one entry through the official engine, with the router's option set. */
async function compileEntry(entry: string, candidates: string[]): Promise<string> {
  const compiler = await compile(entry, {
    base: repoRoot,
    from: `${repoRoot}.openElement/theme-delivery-guard.css`,
    loadStylesheet,
  });
  return compiler.build(candidates);
}

// Deliberately role-free: no candidate here references a single ui role, which
// is exactly the fixture shape whose pruning went unnoticed.
const ROLE_FREE_CANDIDATES = ['p-4', 'flex', 'items-center', 'text-sm'];
const withCandidates = (entry: string): string =>
  `${entry}${ROLE_FREE_CANDIDATES.map((c) => `@source inline("${c}");`).join('\n')}\n`;

test('the @theme block is declared static — the roles are not usage-pruned', () => {
  expect(
    /@theme\s+static\s*\{/.test(themeSource),
    'src/theme.css must declare `@theme static`: the authored sheets consume these roles and ' +
      'are invisible to the compile, so a plain `@theme` block loses them',
  ).toEqual(true);
});

test('the component entry shape delivers every declared role', async () => {
  const entry = withCandidates(
    `@import 'tailwindcss/theme.css';\n@import '${themeSourcePath}';\n` +
      "@import 'tailwindcss/utilities.css';\n",
  );
  const emitted = emittedRoles(await compileEntry(entry, ROLE_FREE_CANDIDATES));
  const missing = declaredRoles(themeSource).filter((role) => !emitted.has(role));
  expect(missing, 'the shadow entry must not drop a declared role').toEqual([]);
});

test('the document entry shape delivers every declared role', async () => {
  const entry = withCandidates(`@import 'tailwindcss';\n@import '${themeSourcePath}';\n`);
  const emitted = emittedRoles(await compileEntry(entry, ROLE_FREE_CANDIDATES));
  const missing = declaredRoles(themeSource).filter((role) => !emitted.has(role));
  expect(missing, 'the document entry must not drop a declared role').toEqual([]);
});
