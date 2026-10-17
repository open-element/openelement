/**
 * @openelement/router — the UnoCSS adapter's RESOLUTION edges (alpha15 stage 2B).
 *
 * The main provider suite pins the behaviour a consumer depends on. This one
 * pins the resolution rules that only show up at the edges of a real project:
 * a theme source that composes other sources, an `@import` the sheet must NOT
 * touch, a cycle, a configuration the engine rejects, and the dev watcher's
 * two decisions (a change that moves nothing, a deletion that must).
 *
 * Every case writes its own temporary fixture inside the probe fixture's tree
 * (the `unocss` install the adapter resolves from) and removes it afterwards.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import type { Plugin } from 'vite';
import { expect, test } from 'vitest';
import { PresetErrorCode } from '../src/internal/error-codes.ts';
import {
  createStyleBuildIntegration,
  declaredUnocssConfig,
} from '../src/vite/internal/style-provider.ts';
import { resolveStylePlan, type ResolvedStyleSelection } from '../src/vite/internal/style-plan.ts';

const FIXTURE_ROOT = join(import.meta.dirname!, '../../../tests/fixtures/router-unocss-probe');

/** A scratch directory inside the fixture, unique per test process. */
const SCRATCH = join(FIXTURE_ROOT, `.probe-${process.pid}`);

async function errorCodeOf(run: () => unknown): Promise<string | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

/** One integration over the fixture's own declaration, with a theme override. */
async function withTheme(
  theme: readonly string[],
  sources: Array<[string, string]> = [],
): Promise<{
  plan: ResolvedStyleSelection;
  integration: Awaited<ReturnType<typeof createStyleBuildIntegration>>;
  document: () => Promise<string>;
}> {
  const declaration = { theme: [...theme] };
  const plan = resolveStylePlan({
    root: FIXTURE_ROOT,
    tailwind: undefined,
    unocss: declaration,
    declarations: [],
  });
  const integration = await createStyleBuildIntegration({
    root: FIXTURE_ROOT,
    plan: plan!,
    unocss: declaration,
    componentSheetCandidates: () => [],
    documentCandidates: () => [],
    sources: () => new Map(),
  });
  return {
    plan: plan!,
    integration,
    document: async () =>
      await integration.provider.compileDocument!({
        candidates: [],
        sources: sources,
      }),
  };
}

test.afterAll(async () => {
  await rm(SCRATCH, { recursive: true, force: true });
});

/** One integration over the fixture's engine, with no theme override. */
async function integrationForFixture(): Promise<
  Awaited<ReturnType<typeof createStyleBuildIntegration>>
> {
  const declaration = {};
  const plan = resolveStylePlan({
    root: FIXTURE_ROOT,
    tailwind: undefined,
    unocss: declaration,
    declarations: [],
  });
  return await createStyleBuildIntegration({
    root: FIXTURE_ROOT,
    plan: plan!,
    unocss: declaration,
    componentSheetCandidates: () => [],
    documentCandidates: () => [],
    sources: () => new Map(),
  });
}

test('an imported theme source is resolved and inlined depth-first', async () => {
  await mkdir(SCRATCH, { recursive: true });
  await writeFile(join(SCRATCH, 'palette.css'), ':root { --probe-palette: 1; }\n', 'utf8');
  await writeFile(
    join(SCRATCH, 'roles.css'),
    "@import './palette.css';\n:root { --color-primary: var(--probe-palette); }\n",
    'utf8',
  );
  const { document } = await withTheme([`.probe-${process.pid}/roles.css`]);
  const css = await document();
  expect(css, 'the imported file was inlined').toContain('--probe-palette: 1');
  expect(css, 'the importer’s own rule survived').toContain(
    '--color-primary: var(--probe-palette)',
  );
  expect(css, 'the resolution is recorded in the sheet, not silent').toContain(
    "/* @import './palette.css' */",
  );
});

test('a cycle is broken, not followed forever', async () => {
  await mkdir(SCRATCH, { recursive: true });
  await writeFile(join(SCRATCH, 'a.css'), "@import './b.css';\n:root { --probe-a: 1; }\n", 'utf8');
  await writeFile(join(SCRATCH, 'b.css'), "@import './a.css';\n:root { --probe-b: 1; }\n", 'utf8');
  const { document } = await withTheme([`.probe-${process.pid}/a.css`]);
  const css = await document();
  expect(css, 'both files contributed').toContain('--probe-a: 1');
  expect(css, 'both files contributed').toContain('--probe-b: 1');
  expect(css, 'the cycle is reported as a skipped import').toContain(
    '/* circular @import skipped:',
  );
});

test('an @import the browser owns is left exactly as written', async () => {
  await mkdir(SCRATCH, { recursive: true });
  await writeFile(
    join(SCRATCH, 'remote.css'),
    "@import url('https://example.invalid/fonts.css');\n@import '/local-public.css';\n:root { --probe-remote: 1; }\n",
    'utf8',
  );
  const { document } = await withTheme([`.probe-${process.pid}/remote.css`]);
  const css = await document();
  expect(css, 'a scheme URL is not this device’s to resolve').toContain(
    'https://example.invalid/fonts.css',
  );
  expect(css, 'a root-absolute URL is the browser’s').toContain("'/local-public.css'");
});

test('an @import with a layer() condition is inlined INTO that layer', async () => {
  // `@import './child.css' layer(tokens)` is an at-rule with a prelude, not a
  // bare import: dropping the condition would put the child's rules in the
  // wrong cascade layer, and failing to match the statement at all leaves the
  // child out of the sheet entirely — the roles it declares simply vanish.
  await mkdir(SCRATCH, { recursive: true });
  await writeFile(join(SCRATCH, 'layer-child.css'), ':root { --probe-layered: 1; }\n', 'utf8');
  await writeFile(
    join(SCRATCH, 'layer-entry.css'),
    "@import './layer-child.css' layer(tokens);\n:root { --probe-layer-entry: 1; }\n",
    'utf8',
  );
  const { document } = await withTheme([`.probe-${process.pid}/layer-entry.css`]);
  const css = await document();
  expect(css, 'the child was inlined').toContain('--probe-layered: 1');
  expect(css, 'the condition survived as the at-rule it means').toMatch(
    /@layer\s+tokens\s*\{[\s\S]*--probe-layered/,
  );
  // The provenance comment records what was resolved; a live statement would
  // end in a semicolon and would be the browser's to fetch.
  expect(css, 'no live @import statement survives').not.toMatch(
    /@import\s+'\.\/layer-child\.css'\s*;/,
  );
  expect(css, 'the resolution is recorded').toContain("/* @import './layer-child.css' */");
});

test('an @import with supports() and media conditions keeps both', async () => {
  await mkdir(SCRATCH, { recursive: true });
  await writeFile(join(SCRATCH, 'cond-child.css'), ':root { --probe-cond: 1; }\n', 'utf8');
  await writeFile(
    join(SCRATCH, 'cond-entry.css'),
    "@import './cond-child.css' supports(display: grid) screen and (min-width: 40em);\n",
    'utf8',
  );
  const { document } = await withTheme([`.probe-${process.pid}/cond-entry.css`]);
  const css = await document();
  expect(css, 'the child was inlined').toContain('--probe-cond: 1');
  expect(css, 'the media condition survived').toMatch(
    /@media\s+screen and \(min-width: 40em\)\s*\{[\s\S]*--probe-cond/,
  );
  expect(css, 'the supports condition survived').toMatch(
    /@supports\s+\(display: grid\)\s*\{[\s\S]*--probe-cond/,
  );
});

test('an anonymous layer condition is transcribed too', async () => {
  await mkdir(SCRATCH, { recursive: true });
  await writeFile(join(SCRATCH, 'anon-child.css'), ':root { --probe-anon: 1; }\n', 'utf8');
  await writeFile(join(SCRATCH, 'anon-entry.css'), "@import './anon-child.css' layer;\n", 'utf8');
  const { document } = await withTheme([`.probe-${process.pid}/anon-entry.css`]);
  const css = await document();
  expect(css, 'the child was inlined').toContain('--probe-anon: 1');
  expect(css, 'the anonymous layer survived').toMatch(/@layer\s*\{[\s\S]*--probe-anon/);
});

test("a theme source's relative url() target resolves from the sheet's compile base and is emitted as a real asset", async () => {
  // A token file that paints with a file NEXT TO ITSELF. The generated sheet
  // does not live in that directory — it is delivered from the framework's
  // compile base (`<root>/.openElement` in build, the `/.openElement/` URL
  // namespace in dev) — so a target left relative to the source would be a
  // request nothing answers. The provider therefore rebases every relative
  // `url()` target of a theme source onto the compile base, and this build's
  // emitter (the shared generated-sheet protocol) then emits the referenced
  // bytes as a real asset and resolves the reference to that asset's URL.
  // Everything else — data URLs, fragments, root-absolute and scheme targets —
  // stays exactly as the source wrote it.
  await mkdir(SCRATCH, { recursive: true });
  const pictureBytes = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>\n',
    'utf8',
  );
  await writeFile(join(SCRATCH, 'picture.svg'), pictureBytes);
  await writeFile(
    join(SCRATCH, 'painted.css'),
    [
      ".probe-paint { background-image: url('./picture.svg'); }",
      ".probe-data { background-image: url('data:image/gif;base64,R0lGOD'); }",
      ".probe-public { background-image: url('/probe-public.svg'); }",
      '',
    ].join('\n'),
    'utf8',
  );
  const { integration, document } = await withTheme([`.probe-${process.pid}/painted.css`]);
  const css = await document();
  const rebased = `url('../.probe-${process.pid}/picture.svg')`;
  expect(css, 'the target is rebased onto the compile base, still relative').toContain(rebased);
  expect(css, 'the original source-relative spelling is gone').not.toContain(
    "url('./picture.svg')",
  );
  expect(css, 'a data URL is not this provider’s to move').toContain(
    'data:image/gif;base64,R0lGOD',
  );
  expect(css, 'a root-absolute URL is the deployment’s').toContain('/probe-public.svg');

  // The emitter half, driven the way the build drives it: the rebased target
  // resolves, the referenced bytes are EMITTED as their own asset, and the
  // sheet's placeholder resolves to that asset's URL.
  const assets: Array<{
    referenceId: string;
    fileName: string;
    source: string | Uint8Array;
    named: boolean;
  }> = [];
  let counter = 0;
  const context = {
    environment: { config: { base: '/' } },
    emitFile(file: {
      type: 'asset';
      fileName?: string;
      name?: string;
      source: string | Uint8Array;
    }): string {
      counter += 1;
      assets.push({
        referenceId: `ref-${counter}`,
        fileName: file.fileName ?? `assets/${file.name ?? 'unnamed'}`,
        source: file.source,
        named: file.fileName === undefined,
      });
      return `ref-${counter}`;
    },
    getFileName(): string {
      return 'assets/probe-picture-EMITTED.svg';
    },
  };
  const plugin = integration.sheetPlugins[0] as Plugin;
  await (plugin.buildStart as (this: unknown) => Promise<void>).call(context);
  const emittedPicture = assets.find(
    (asset) => asset.named && asset.fileName.endsWith('picture.svg'),
  );
  expect(emittedPicture, 'the referenced file was emitted beside the sheet').toBeDefined();
  expect(
    Buffer.from(emittedPicture!.source as Uint8Array).equals(pictureBytes),
    'the emitted asset carries the referenced bytes',
  ).toBe(true);
  const sheet = assets.find((asset) => asset.fileName === integration.documentRecord?.fileName);
  expect(sheet, 'the document sheet was emitted').toBeDefined();

  const bundle: Record<string, { type: 'asset'; source: string | Uint8Array }> = {
    [sheet!.fileName]: { type: 'asset', source: sheet!.source },
  };
  (plugin.generateBundle as unknown as (options: unknown, bundle: unknown) => void).call(
    { environment: { config: { base: '/' } }, getFileName: context.getFileName },
    {},
    bundle,
  );
  const resolved = bundle[sheet!.fileName]!.source;
  const finalCss = typeof resolved === 'string' ? resolved : Buffer.from(resolved).toString('utf8');
  expect(finalCss, 'no placeholder survives generation').not.toContain('__OE_COMPONENT_URL__');
  expect(finalCss, 'the sheet addresses the emitted asset').toContain(
    "url('/assets/probe-picture-EMITTED.svg')",
  );
  expect(finalCss, 'the unownable targets are untouched').toContain('data:image/gif;base64,R0lGOD');
});

test('a string is data, not syntax: at-rule spelling inside one is inert', async () => {
  // Both reproduction shapes: a `content:` string that SPELLS `@theme` is a
  // value of a declaration — not an at-rule, so the Tailwind refusal must not
  // fire — and a `content:` string that SPELLS an @import names a file that
  // does not exist, so a scan that read it as syntax would try to resolve
  // `./never-on-disk.css` and fail the compile. The strings are data; the file
  // is never touched and both reach the sheet byte for byte.
  await mkdir(SCRATCH, { recursive: true });
  await writeFile(
    join(SCRATCH, 'strings.css'),
    [
      '.probe-theme::before { content: "@theme"; }',
      '.probe-import::before { content: "@import \'./never-on-disk.css\';"; }',
      ':root { --probe-string-safe: 1; }',
      '',
    ].join('\n'),
    'utf8',
  );
  const { document } = await withTheme([`.probe-${process.pid}/strings.css`]);
  const css = await document();
  expect(css, 'a string that spells @theme is a string').toContain('"@theme"');
  expect(css, 'a string that spells an @import is a string').toContain(
    "@import './never-on-disk.css';",
  );
  expect(css, 'the source compiled').toContain('--probe-string-safe: 1');
});

test('a comment is not syntax: @theme and @import inside one are inert', async () => {
  await mkdir(SCRATCH, { recursive: true });
  await writeFile(
    join(SCRATCH, 'commented.css'),
    [
      '/* Tailwind users write @theme { --color-primary: red; } here.',
      "   A commented-out import follows: @import './nowhere.css'; */",
      ':root { --probe-commented: 1; }',
      '/* a trailing comment mentioning @theme again */',
      '',
    ].join('\n'),
    'utf8',
  );
  const { document } = await withTheme([`.probe-${process.pid}/commented.css`]);
  const css = await document();
  expect(css, 'the real declaration reached the sheet').toContain('--probe-commented: 1');
  expect(css, 'the comment is still a comment').toContain('@theme { --color-primary: red; }');
  expect(css, 'a commented-out import is not resolved').toContain("@import './nowhere.css';");
});

test('a diamond inlines every occurrence — a repeat is not a cycle', async () => {
  // A diamond, not a cycle: both branches import the same sheet. CSS Cascade 5
  // processes every @import OCCURRENCE (each construction contributes the
  // imported sheet's rules at its own position — the same file imported into
  // two layers must land in both), so a repeat is inlined again: only reading
  // work may be shared, never the semantics. The previous assertion here
  // ("inlined exactly once") was the adapter's old dedup rule leaking into the
  // test, not a property of CSS; see the two-layers case below for the shape
  // the dedup broke.
  await mkdir(SCRATCH, { recursive: true });
  await writeFile(join(SCRATCH, 'shared.css'), ':root { --probe-shared: 1; }\n', 'utf8');
  await writeFile(join(SCRATCH, 'left.css'), "@import './shared.css';\n", 'utf8');
  await writeFile(join(SCRATCH, 'right.css'), "@import './shared.css';\n", 'utf8');
  await writeFile(
    join(SCRATCH, 'diamond.css'),
    "@import './left.css';\n@import './right.css';\n",
    'utf8',
  );
  const { document } = await withTheme([`.probe-${process.pid}/diamond.css`]);
  const css = await document();
  expect(
    css.split('--probe-shared: 1').length - 1,
    'every import occurrence contributes its sheet',
  ).toBe(2);
  expect(
    css.split("/* @import './shared.css' */").length - 1,
    'each resolution is recorded at its own position',
  ).toBe(2);
});

test('the same file imported into two layers lands in both (CSS Cascade 5)', async () => {
  // The reproduction that forced the repeat/cycle split: one file, imported
  // twice, into DIFFERENT layers. Deduplicating the second occurrence left
  // layer(b) empty — the file's rules exist in layer(a) only, which is not
  // what the source says. Per CSS Cascade 5's import processing each import
  // occurrence participates independently; the bytes may be read once.
  await mkdir(SCRATCH, { recursive: true });
  await writeFile(join(SCRATCH, 'twice.css'), ':root { --probe-twice: 1; }\n', 'utf8');
  await writeFile(
    join(SCRATCH, 'two-layers.css'),
    "@import './twice.css' layer(a);\n@import './twice.css' layer(b);\n",
    'utf8',
  );
  const { document } = await withTheme([`.probe-${process.pid}/two-layers.css`]);
  const css = await document();
  const layerA = css.indexOf('@layer a');
  const layerB = css.indexOf('@layer b');
  const first = css.indexOf('--probe-twice: 1');
  const second = css.indexOf('--probe-twice: 1', first + 1);
  expect(layerA, 'layer(a) is in the sheet').toBeGreaterThan(-1);
  expect(first, 'the first occurrence is inside layer(a)').toBeGreaterThan(layerA);
  expect(layerB, 'layer(b) is in the sheet').toBeGreaterThan(layerA);
  expect(
    second,
    'the second occurrence is inside layer(b) — not deduplicated away',
  ).toBeGreaterThan(layerB);
});

test('a local @import that cannot be resolved fails closed', async () => {
  await mkdir(SCRATCH, { recursive: true });
  await writeFile(
    join(SCRATCH, 'broken.css'),
    "@import './nowhere.css';\n:root { --probe-broken: 1; }\n",
    'utf8',
  );
  const { document } = await withTheme([`.probe-${process.pid}/broken.css`]);
  expect(await errorCodeOf(document)).toBe(PresetErrorCode.TAILWIND_SOURCE_UNRESOLVED);
});

test('an imported file carrying @theme is refused too, not only the entry', async () => {
  await mkdir(SCRATCH, { recursive: true });
  await writeFile(join(SCRATCH, 'tailwind-format.css'), '@theme { --color-x: red; }\n', 'utf8');
  await writeFile(
    join(SCRATCH, 'entry.css'),
    "@import './tailwind-format.css';\n:root { --probe-entry: 1; }\n",
    'utf8',
  );
  const { document } = await withTheme([`.probe-${process.pid}/entry.css`]);
  expect(await errorCodeOf(document)).toBe(PresetErrorCode.UNOCSS_THEME_SOURCE_INCOMPATIBLE);
});

test('the first-party package is refused under UnoCSS by code, never half-styled', async () => {
  // The shipped facts, not a synthetic stand-in: @openelement/ui declares its
  // role table as a `tailwind` theme source (generated-manifest.json →
  // ./src/theme.css), and that file is a Tailwind `@theme` source. An
  // application that selects `unocss` and admits the package therefore reaches
  // this refusal — the supported answer while no shipped mechanism substitutes
  // a plain-CSS role table for the package's. The class tokens are portable;
  // the declared theme source is not, and the two facts must not be conflated
  // into a claim of cross-engine parity.
  const uiRoot = join(import.meta.dirname!, '../../../packages/ui');
  expect(readFileSync(join(uiRoot, 'src/generated-manifest.json'), 'utf8')).toContain(
    '"./src/theme.css"',
  );
  expect(readFileSync(join(uiRoot, 'src/theme.css'), 'utf8')).toContain('@theme');
  const { document } = await withTheme([join(uiRoot, 'src/theme.css')]);
  expect(await errorCodeOf(document)).toBe(PresetErrorCode.UNOCSS_THEME_SOURCE_INCOMPATIBLE);
});

test('a configuration the engine rejects is a coded failure, not a crash', async () => {
  await mkdir(SCRATCH, { recursive: true });
  const config = join(SCRATCH, 'rejecting.config.mjs');
  // A preset that is not a preset: the official loader returns it happily and
  // the generator refuses it, which is exactly the boundary under test.
  await writeFile(config, 'export default { presets: [42] };\n', 'utf8');
  const declaration = { config };
  const plan = resolveStylePlan({
    root: FIXTURE_ROOT,
    tailwind: undefined,
    unocss: declaration,
    declarations: [],
  });
  const code = await errorCodeOf(() =>
    createStyleBuildIntegration({
      root: FIXTURE_ROOT,
      plan: plan!,
      unocss: declaration,
      componentSheetCandidates: () => [],
      documentCandidates: () => [],
      sources: () => new Map(),
    }),
  );
  expect(code).toBe(PresetErrorCode.UNOCSS_CONFIG_UNLOADABLE);
});

test('an absolute theme-source path resolves without the app root', async () => {
  await mkdir(SCRATCH, { recursive: true });
  const absolute = join(SCRATCH, 'absolute.css');
  await writeFile(absolute, ':root { --probe-absolute: 1; }\n', 'utf8');
  const { document } = await withTheme([absolute]);
  const css = await document();
  expect(css, 'an absolute path is read as one').toContain('--probe-absolute: 1');
});

test('an opaque candidate with no utility behind it compiles to an empty sheet', async () => {
  // A class name the engine has no rule for is not a failure. The compiler
  // reports "compiled, matched nothing" — which is what an application's own
  // native-CSS hook (`my-semantic-hook`, styled by its own stylesheet) is — and
  // the adapter must deliver the empty sheet that answer describes rather than
  // diagnosing it as a broken pipeline. A candidate count is not evidence that
  // a rule must exist.
  const integration = await integrationForFixture();
  const css = await integration.provider.compileComponents({
    candidates: ['my-semantic-hook'],
    sources: new Map(),
  });
  expect(css.trim(), 'a zero-match compile is an empty sheet, not an error').toBe('');
});

test('a candidate the engine CAN compile still produces its sheet', async () => {
  const integration = await integrationForFixture();
  const css = await integration.provider.compileComponents({
    candidates: ['my-semantic-hook', 'gap-2'],
    sources: new Map(),
  });
  expect(css, 'the one real utility still compiles').toMatch(/\.gap-2\s*\{/);
  expect(css, 'the opaque hook contributed nothing, as it should').not.toContain(
    'my-semantic-hook',
  );
});

test('a document sheet that compiles to nothing at all is a coded failure', async () => {
  // An application configuration that provides nothing: no preset of its own,
  // so the framework installs its own default — and a preset set the caller
  // supplies that emits neither theme nor properties. The document sheet then
  // has nothing to carry, which is the adapter's defect, never silence.
  await mkdir(SCRATCH, { recursive: true });
  const config = join(SCRATCH, 'empty.config.mjs');
  await writeFile(
    config,
    "export default { presets: [{ name: 'probe-empty' }], theme: {} };\n",
    'utf8',
  );
  const declaration = { config };
  const plan = resolveStylePlan({
    root: FIXTURE_ROOT,
    tailwind: undefined,
    unocss: declaration,
    declarations: [],
  });
  const integration = await createStyleBuildIntegration({
    root: FIXTURE_ROOT,
    plan: plan!,
    unocss: declaration,
    componentSheetCandidates: () => [],
    documentCandidates: () => [],
    sources: () => new Map(),
  });
  const code = await errorCodeOf(() =>
    integration.provider.compileDocument!({ candidates: [], sources: new Map() }),
  );
  expect(code).toBe(PresetErrorCode.UNOCSS_EMPTY_COMPILE);
});

test('a false declaration selects nothing and carries no config path', () => {
  const plan = resolveStylePlan({
    root: FIXTURE_ROOT,
    tailwind: undefined,
    unocss: false,
    declarations: [],
  });
  expect(plan, 'false is the off switch, not a selection').toBeUndefined();
  // The declaration's config path is read through one helper: a boolean (or an
  // absent) declaration carries none, and only the object form names a file.
  expect(declaredUnocssConfig(true), 'a boolean names no configuration').toBeUndefined();
  expect(declaredUnocssConfig(undefined), 'an absent declaration names none').toBeUndefined();
  expect(declaredUnocssConfig(false), 'the off switch names none').toBeUndefined();
  expect(declaredUnocssConfig({ config: 'uno.config.ts' }), 'the object form does').toBe(
    'uno.config.ts',
  );
});
