/**
 * Tailwind preset seam tests (alpha9 C2, #1505).
 *
 * Covers the opt-in contract at the unit level: option resolution, the
 * generated entry (declared layer order + layer(components) wrapping), the
 * @scope light-DOM face, the DSD/head link injection, the full-inline
 * prohibition, and the bundle compile's asset delivery (#1535) and
 * empty-layer extraction (#1536). The two-state byte verification itself
 * lives in .artifacts/c2/ (gitignored evidence, C2 task 0/5).
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { OpenElementError } from '@openelement/element/authoring';
import { PresetErrorCode } from '../src/internal/error-codes.ts';
import {
  TAILWIND_BUNDLE_ASSET,
  TAILWIND_LAYER_ORDER,
  TAILWIND_SCOPE_ASSET,
  assertNoGlobalSheetInline,
  buildTailwindPresetBundle,
  extractLayerComponents,
  injectPresetLinks,
  renderTailwindPresetEntry,
  renderTailwindScopeFace,
  resolveTailwindPresetOptions,
  scopePresetComponentCss,
} from '../src/vite/preset-tailwind.ts';

// ─── Option resolution ─────────────────────────────────────────

test('the preset is OFF by default and for every falsy spelling', () => {
  expect(resolveTailwindPresetOptions(undefined)).toEqual(undefined);
  expect(resolveTailwindPresetOptions(false)).toEqual(undefined);
});

test('tailwind: true resolves to empty defaults; an object passes through', () => {
  expect(resolveTailwindPresetOptions(true)).toEqual({});
  const options = { theme: ['@openelement/ui/theme.css'] };
  expect(resolveTailwindPresetOptions(options)).toEqual(options);
});

// ─── Entry generation (seam 1: declared layer order) ───────────

test('the entry declares the layer order and wraps component sources', () => {
  const entry = renderTailwindPresetEntry({
    theme: ['@openelement/ui/theme.css'],
    components: ['@openelement/ui/semantic-tokens.css'],
  });
  expect(entry.includes(TAILWIND_LAYER_ORDER)).toEqual(true);
  expect(entry).toEqual(expect.stringContaining('@layer theme, base, components, utilities;'));
  expect(entry).toEqual(expect.stringContaining("@import 'tailwindcss';"));
  expect(entry).toEqual(expect.stringContaining("@import '@openelement/ui/theme.css';"));
  expect(entry).toEqual(
    expect.stringContaining("@import '@openelement/ui/semantic-tokens.css' layer(components);"),
  );
});

test('an empty preset entry still declares the layer order', () => {
  const entry = renderTailwindPresetEntry({});
  expect(entry.includes(TAILWIND_LAYER_ORDER)).toEqual(true);
  expect(entry.includes("@import 'tailwindcss';")).toEqual(true);
});

// ─── @scope face (seam 1: light-DOM surface) ───────────────────

test('the scope face re-seats shadow selectors per host tag', () => {
  const scoped = scopePresetComponentCss('open-card', ':host { display: block; }');
  expect(scoped).toEqual('@scope (open-card) {\n:scope { display: block; }\n}');
  const variants = scopePresetComponentCss(
    'open-card',
    ':host([data-theme="dark"]) { --x: 1; } ::slotted(a) { color: red; }',
  );
  expect(variants).toEqual(expect.stringContaining(':scope:is([data-theme="dark"])'));
  expect(variants).toEqual(expect.stringContaining('slot > :is(a)'));
});

test('the scope face emits one block per declared tag and skips when unconfigured', () => {
  const css = ':host { display: block; }';
  const face = renderTailwindScopeFace({ scopeTags: ['open-a', 'open-b'] }, css);
  expect(face.includes('@scope (open-a)')).toEqual(true);
  expect(face.includes('@scope (open-b)')).toEqual(true);
  expect(face.match(/@scope \(/g)?.length).toEqual(2);
  expect(renderTailwindScopeFace({}, css)).toEqual('');
  expect(renderTailwindScopeFace({ scopeTags: ['open-a'] }, '  ')).toEqual('');
});

// ─── Layer extraction ──────────────────────────────────────────

test('extractLayerComponents isolates the components block body', () => {
  const css = [
    TAILWIND_LAYER_ORDER,
    '@layer theme { :root { --a: 1; } }',
    '@layer components { :host { --b: 2; } :root, :host { --c: 3; } }',
    '@layer utilities { .x { color: red; } }',
  ].join('\n');
  const body = extractLayerComponents(css);
  expect(body.includes('--b: 2')).toEqual(true);
  expect(body.includes('--c: 3')).toEqual(true);
  expect(body.includes('--a: 1')).toEqual(false);
  expect(body.includes('.x')).toEqual(false);
});

test('a bare empty-layer statement extracts no components body (#1536)', () => {
  const css = [
    TAILWIND_LAYER_ORDER,
    '@layer theme { :root { --a: 1; } }',
    '@layer components;',
    '@layer utilities { .x { color: red; } }',
  ].join('\n');
  expect(extractLayerComponents(css)).toEqual('');
  // The dogfood hit shape: scopeTags configured while the components layer is
  // empty. The utilities body must not be re-seated under the host tag — the
  // scope face stays empty.
  expect(
    renderTailwindScopeFace({ scopeTags: ['open-card'] }, extractLayerComponents(css)),
  ).toEqual('');
});

// ─── Bundle compile (the #1535/#1536 delivery shapes) ──────────

/**
 * Writes the #1535 fixture root: a theme source carrying a url() font and a
 * components source carrying a url() background. Both payloads sit above the
 * default 4KB inline limit — smaller files compile to data URIs and would
 * never exercise the asset copy. Declared source paths resolve relative to
 * the staged entry (`.openElement/tailwind-preset/entry.css`), hence `../..`.
 */
function writeUrlAssetFixture(name: string): string {
  const root = join(import.meta.dirname!, `../__test_fixtures__/${name}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, 'theme.css'),
    '@font-face { font-family: "Preset Fixture"; src: url("./fixture-font.woff2") format("woff2"); }',
    'utf8',
  );
  writeFileSync(
    join(root, 'components.css'),
    '.fixture-bg { background-image: url("./fixture-bg.svg"); }',
    'utf8',
  );
  writeFileSync(join(root, 'fixture-font.woff2'), Buffer.alloc(8192, 7));
  writeFileSync(
    join(root, 'fixture-bg.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><!--${'x'.repeat(8192)}--></svg>`,
    'utf8',
  );
  return root;
}

test('url() assets referenced by the declared sources ship next to the bundle (#1535)', async () => {
  const root = writeUrlAssetFixture('tailwind-preset-assets');
  const outDir = join(root, 'dist');
  const result = await buildTailwindPresetBundle({
    root,
    outDir,
    options: {
      theme: ['../../theme.css'],
      components: ['../../components.css'],
      scopeTags: ['open-card'],
    },
    base: '/',
  });

  // The bundle is the compiled stylesheet, not a url() payload renamed onto
  // the bundle's fixed name (the pre-fix name collision shipped the SVG as
  // the bundle).
  expect(result.bundleCss).toContain('@layer');
  expect(result.bundleCss).toContain('Preset Fixture');

  // Every file url the shipped CSS references exists in the shipped assets
  // directory, under its deterministic hashed name.
  const shipped = new Set(readdirSync(join(outDir, 'assets')));
  const referenced = [...result.bundleCss.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)]
    .map((match) => match[1])
    .filter((target) => !/^(?:data:|#|https?:\/\/|\/\/)/.test(target));
  expect(referenced.length).toBeGreaterThanOrEqual(2);
  for (const target of referenced) {
    expect(shipped.has(target.replace(/^\/+/, '')), `shipped ${target}`).toEqual(true);
    expect(target).not.toContain(TAILWIND_BUNDLE_ASSET);
  }

  // The @scope face, carved from the same rewritten components layer,
  // references shipped names only. (The font lives in the theme layer, so the
  // face carries the components layer's background reference, not the font.)
  expect(result.scopePath).toBeDefined();
  const scope = readFileSync(result.scopePath!, 'utf8');
  expect(scope).toContain('@scope (open-card)');
  const scopeRefs = [...scope.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map(
    (match) => match[1],
  );
  expect(scopeRefs.length).toBeGreaterThanOrEqual(1);
  for (const target of scopeRefs) {
    expect(shipped.has(target), `shipped ${target}`).toEqual(true);
  }
});

test('no components source with scopeTags emits no scope face and leaves the bundle unscoped (#1536)', async () => {
  const root = join(import.meta.dirname!, '../__test_fixtures__/tailwind-preset-no-components');
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const result = await buildTailwindPresetBundle({
    root,
    outDir: join(root, 'dist'),
    options: { scopeTags: ['open-card'] },
    base: '/',
  });
  // The dogfood hit shape end to end: an empty components layer (the compile
  // emits it as a bare layer statement — grouped, `@layer components,
  // utilities;`, in the 4.3.x line — never as a block) must not let the brace
  // scan fall into the next layer and wrap the whole bundle into the host-tag
  // scope face.
  expect(result.bundleCss).toMatch(/@layer[^{};]*\bcomponents\b[^{};]*;/);
  expect(extractLayerComponents(result.bundleCss)).toEqual('');
  expect(result.scopePath).toBeUndefined();
  expect(result.scopeHref).toBeUndefined();
  expect(result.bundleCss).not.toContain('@scope');
});

// ─── Link injection (seam 2: DSD link-not-inline) ──────────────

const DSD_PAGE = [
  '<!DOCTYPE html><html><head><title>t</title></head><body>',
  '<open-page><template shadowrootmode="open"><main></main></template></open-page>',
  '<open-closed><template shadowrootmode="closed"><p>x</p></template></open-closed>',
  '</body></html>',
].join('');

test('the default keeps DSD templates untouched: head link only', () => {
  // The compiled-claim walk (element claim.ts) requires the shadow root's
  // children to equal the Part Program's own nodes, so the default must not
  // inject anything into a shadow template.
  for (const out of [
    injectPresetLinks(DSD_PAGE, '/assets/open-tailwind.css'),
    injectPresetLinks(DSD_PAGE, '/assets/open-tailwind.css', undefined, false),
  ]) {
    expect(
      out.match(/<link rel="stylesheet" href="\/assets\/open-tailwind.css" \/>/g)?.length,
    ).toEqual(1);
    expect(out).toEqual(
      expect.stringContaining('<template shadowrootmode="open"><main></main></template>'),
    );
    expect(out).toEqual(
      expect.stringContaining('<template shadowrootmode="closed"><p>x</p></template>'),
    );
  }
  // The head link lands directly after the <head> open tag.
  const out = injectPresetLinks(DSD_PAGE, '/assets/open-tailwind.css');
  expect(out.startsWith('<!DOCTYPE html><html><head>\n  <link rel="stylesheet"')).toEqual(true);
});

test('links land in head and as the last child of every DSD template when opted in', () => {
  const out = injectPresetLinks(DSD_PAGE, '/assets/open-tailwind.css', undefined, true);
  // head: exactly one bundle link; DSD: one per template (open and closed).
  expect(
    out.match(/<link rel="stylesheet" href="\/assets\/open-tailwind.css" \/>/g)?.length,
  ).toEqual(3);
  // Trailing position: the compiled-claim walk (element claim.ts) visits the
  // shadow template's children exactly as the Part Program lists them, so a
  // leading link is structural drift — the link rides at each template's end.
  expect(out).toEqual(
    expect.stringContaining(
      '<main></main><link rel="stylesheet" href="/assets/open-tailwind.css" /></template>',
    ),
  );
  expect(out).toEqual(
    expect.stringContaining(
      '<p>x</p><link rel="stylesheet" href="/assets/open-tailwind.css" /></template>',
    ),
  );
});

test('a link inside a nested DSD template joins every shadow root when opted in', () => {
  const html =
    '<open-outer><template shadowrootmode="open"><open-inner><template shadowrootmode="open"><b>deep</b></template></open-inner></template></open-outer>';
  const out = injectPresetLinks(html, '/assets/open-tailwind.css', undefined, true);
  // No <head> in this fragment: exactly the two shadow links, one per root.
  expect(
    out.match(/<link rel="stylesheet" href="\/assets\/open-tailwind.css" \/>/g)?.length,
  ).toEqual(2);
  expect(out).toEqual(
    expect.stringContaining(
      '<b>deep</b><link rel="stylesheet" href="/assets/open-tailwind.css" /></template>',
    ),
  );
  expect(
    out.endsWith(
      '</open-inner><link rel="stylesheet" href="/assets/open-tailwind.css" /></template></open-outer>',
    ),
  ).toEqual(true);
});

test('the scope-face link rides along only when emitted', () => {
  const html = '<html><head></head><body></body></html>';
  const withScope = injectPresetLinks(
    html,
    '/assets/open-tailwind.css',
    `/${TAILWIND_SCOPE_ASSET}`,
  );
  expect(withScope.includes(`href="/${TAILWIND_SCOPE_ASSET}"`)).toEqual(true);
  const without = injectPresetLinks(html, '/assets/open-tailwind.css');
  expect(without.includes(TAILWIND_SCOPE_ASSET)).toEqual(false);
});

// ─── Full-inline prohibition (seam 2: styleText path forbidden) ──

const BUNDLE = [
  TAILWIND_LAYER_ORDER,
  '@layer theme { :root, :host { --color-background: white; --color-foreground: black; --color-card: white; --color-muted: gray; --color-border: gray; } }',
].join('\n');

test('a page fully inlining the global sheet fails with the coded error', () => {
  const inline = `<style>:root,:host{--color-background: white;--color-foreground: black;--color-card: white;--color-muted: gray;--color-border: gray;}</style>`;
  let thrown: unknown;
  try {
    assertNoGlobalSheetInline(`<html><head>${inline}</head></html>`, BUNDLE, 'index.html');
  } catch (error) {
    thrown = error;
  }
  // The prohibition classifies like every build-surface failure: one code,
  // the build phase, error severity.
  expect(thrown instanceof OpenElementError, 'expected the inline to classify').toBeTruthy();
  expect((thrown as OpenElementError).code).toEqual(PresetErrorCode.GLOBAL_SHEET_INLINE_FORBIDDEN);
  expect((thrown as OpenElementError).phase).toEqual('build');
  expect((thrown as OpenElementError).severity).toEqual('error');
});

test('per-component inline styles stay legal; a preset-free page passes', () => {
  // Per-component static styles declare none of the bundle's own tokens.
  const perComponent = '<style data-oe-static-styles">:host { padding: 4px; }</style>';
  expect(() =>
    assertNoGlobalSheetInline(`<html><head>${perComponent}</head></html>`, BUNDLE, 'index.html'),
  ).not.toThrow();
  expect(() =>
    assertNoGlobalSheetInline('<html><head></head></html>', BUNDLE, 'x.html'),
  ).not.toThrow();
});

test('the bundle asset name is the fixed seam contract', () => {
  expect(TAILWIND_BUNDLE_ASSET).toEqual('open-tailwind.css');
  expect(TAILWIND_SCOPE_ASSET).toEqual('open-tailwind.scope.css');
});
