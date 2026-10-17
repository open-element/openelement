/**
 * @openelement/router — the generated-sheet emitter, driven directly
 * (alpha15 stage 2B).
 *
 * The emitter runs inside a real build (the probe fixture's gate covers that
 * end to end). This suite drives the SAME plugin instance through its hooks
 * with a stub plugin context, so the emission contract is pinned without
 * paying for a build: the sheet is emitted under its own content address, the
 * adapter module behind the provider's specifier carries the sheet protocol
 * and never a DOM write, a candidate-less build emits NOTHING and still hands
 * the graph a resolvable module, and `url()` targets a sheet references are
 * emitted beside it and resolved to their own emitted URLs.
 *
 * The stub is not a stand-in for Vite's behaviour — it records exactly what
 * the emitter asks of the bundler (`emitFile`, `getFileName`, the resolved
 * `base`) and answers with the bundler's own contract.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import type { Plugin } from 'vite';
import { expect, test } from 'vitest';
import { createStyleBuildIntegration } from '../src/vite/internal/style-provider.ts';
import { resolveStylePlan } from '../src/vite/internal/style-plan.ts';

const FIXTURE_ROOT = join(import.meta.dirname!, '../../../tests/fixtures/router-unocss-probe');

/** One emitted asset, as the stub bundler recorded it. */
interface EmittedAsset {
  readonly referenceId: string;
  readonly fileName: string;
  readonly source: string | Uint8Array;
  /** Set for a `name`-addressed emission (a referenced file beside the sheet). */
  readonly named: boolean;
}

/** The stub plugin context: the bundler surface the emitter consumes. */
function stubContext(assets: EmittedAsset[]) {
  let counter = 0;
  return {
    environment: { config: { base: '/' } },
    emitFile(file: {
      type: 'asset';
      fileName?: string;
      name?: string;
      source: string | Uint8Array;
    }): string {
      counter += 1;
      const referenceId = `ref-${counter}`;
      assets.push({
        referenceId,
        fileName: file.fileName ?? `assets/${file.name ?? 'unnamed'}`,
        source: file.source,
        named: file.fileName === undefined,
      });
      return referenceId;
    },
    getFileName(): string {
      return 'assets/referenced-hash.png';
    },
  };
}

/** One integration over the fixture, with the candidate set the caller names. */
async function integrationWith(candidates: readonly string[]) {
  return await integrationWithTheme(['app/styles/tokens.css'], candidates);
}

/** The same, over a caller-chosen theme list (a scratch source, usually). */
async function integrationWithTheme(theme: readonly string[], candidates: readonly string[] = []) {
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
    componentSheetCandidates: () => candidates,
    documentCandidates: () => candidates,
    sources: () => new Map(),
  });
  return integration;
}

test('the emitter emits each sheet under its own content address and hands back an adapter', async () => {
  const integration = await integrationWith(['gap-2', 'text-foreground']);
  const assets: EmittedAsset[] = [];
  const plugin = integration.sheetPlugins[0] as Plugin;
  const context = stubContext(assets);
  await (plugin.buildStart as () => Promise<void>).call(context);

  // Both sheets exist as content-addressed `.css` assets, and each record
  // names one of them — the record, not the list position, is the build's
  // handle on the emission (the emitter may order them as it likes).
  const sheets = assets.filter((asset) => !asset.named);
  expect(sheets.length, 'both sheets were emitted').toBe(2);
  for (const sheet of sheets) {
    expect(sheet.fileName, 'a content address, not a name').toMatch(/^assets\/[0-9a-f]{12}\.css$/);
    expect(String(sheet.source).length, 'the emitted bytes are the compile').toBeGreaterThan(0);
  }
  const emittedNames = sheets.map((sheet) => sheet.fileName);
  expect(emittedNames, 'the component sheet is one of the emitted assets').toContain(
    integration.componentRecord.fileName,
  );
  expect(emittedNames, 'the document sheet is the other').toContain(
    integration.documentRecord?.fileName,
  );
  expect(
    integration.componentRecord.fileName,
    'the two records name two different resources',
  ).not.toBe(integration.documentRecord?.fileName);
  const componentAsset = sheets.find(
    (sheet) => sheet.fileName === integration.componentRecord.fileName,
  )!;

  // The adapter module the generated entry imports: the protocol's keys, a
  // fetch + replace fill, and no DOM node anywhere.
  const loaded = await (plugin.load as (id: string) => Promise<string | undefined>).call(
    context,
    (plugin.resolveId as (id: string) => string | null).call(
      context,
      integration.provider.componentSheetSpecifier,
    )!,
  );
  expect(loaded, 'the specifier answers a module').toContain('__openElementStyleReady');
  expect(loaded, 'the sheet is created synchronously').toContain('new CSSStyleSheet()');
  expect(loaded, 'filled by replace()').toContain('sheet.replace(');
  expect(loaded, 'never a DOM node').not.toContain('createElement');
  expect(loaded, 'the adapter points at this build’s emitted file').toContain(
    `import.meta.ROLLUP_FILE_URL_${componentAsset.referenceId}`,
  );
});

test('a candidate-less build emits nothing and still answers a resolvable module', async () => {
  const integration = await integrationWith([]);
  const assets: EmittedAsset[] = [];
  const plugin = integration.sheetPlugins[0] as Plugin;
  const context = stubContext(assets);
  await (plugin.buildStart as () => Promise<void>).call(context);

  // The document sheet still has its token source and theme layer, so exactly
  // one sheet is emitted — and the component sheet, which has no candidates,
  // contributes none. A build with no candidates must not invent CSS.
  expect(
    assets.filter((asset) => !asset.named).length,
    'no component sheet without candidates',
  ).toBe(1);
  expect(integration.componentRecord.fileName, 'the component record stays empty').toBeUndefined();

  const graphId = (plugin.resolveId as (id: string) => string | null).call(
    context,
    integration.provider.componentSheetSpecifier,
  )!;
  expect(graphId, 'the specifier still resolves').not.toBeNull();
  const loaded = await (plugin.load as (id: string) => Promise<string | undefined>).call(
    context,
    graphId,
  );
  expect(loaded, 'an empty module keeps the import resolvable').toBe('export default undefined;\n');
});

test('the provider’s graph half is empty: a generated engine contributes no entry module', async () => {
  const integration = await integrationWith(['gap-2']);
  expect(
    integration.graphPlugins,
    'nothing mounts before the discovery pass for a generated-document provider',
  ).toEqual([]);
  expect(
    integration.documentRecord,
    'a generated provider records its own document asset',
  ).toBeDefined();
  expect(integration.provider.documentDelivery).toBe('generated');
});

test('foreign ids are not this emitter’s, in either direction', async () => {
  const integration = await integrationWith(['gap-2']);
  const plugin = integration.sheetPlugins[0] as Plugin;
  const context = stubContext([]);
  expect(
    (plugin.resolveId as (id: string) => string | null).call(context, 'some-other-module.ts'),
    'an id the emitter does not own stays the bundler’s',
  ).toBeNull();
  expect(
    await (plugin.load as (id: string) => Promise<string | null>).call(
      context,
      'some-other-module.ts',
    ),
    'and it answers nothing for it',
  ).toBeNull();
});

test('url() targets the sheet references are emitted beside it and resolved to their own URL', async () => {
  // A theme source that references a FILE. The engine writes the target the way
  // a file on disk would read it (relative to the entry's directory), which no
  // browser can resolve from the emitted sheet's own location — so the emitter
  // rebases it onto an asset it emits, and resolves that to the asset's URL.
  const entryBase = join(FIXTURE_ROOT, '.openElement');
  const referenced = join(entryBase, 'probe-texture.png');
  const scratchCss = join(FIXTURE_ROOT, `.probe-${process.pid}-urls.css`);
  await mkdir(entryBase, { recursive: true });
  await writeFile(referenced, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await writeFile(
    scratchCss,
    [
      ".probe-texture { background: url('./probe-texture.png'); }",
      ".probe-inline { background: url('data:image/gif;base64,R0lGOD'); }",
      '.probe-frag { background: url(#probe-paint); }',
      ".probe-absolute { background: url('/probe-public.png'); }",
      ".probe-remote { background: url('https://example.invalid/a.png'); }",
      '',
    ].join('\n'),
    'utf8',
  );
  try {
    const urlIntegration = await integrationWithTheme([`.probe-${process.pid}-urls.css`]);
    const urlPlugin = urlIntegration.sheetPlugins[0] as Plugin;
    const urlAssets: EmittedAsset[] = [];
    const urlContext = stubContext(urlAssets);
    await (urlPlugin.buildStart as () => Promise<void>).call(urlContext);

    const sheet = urlAssets.find(
      (asset) => asset.fileName === urlIntegration.documentRecord?.fileName,
    )!;
    const beforeResolve = String(sheet.source);
    expect(
      urlAssets.some((asset) => asset.named && asset.fileName.endsWith('probe-texture.png')),
      'the referenced file is emitted beside the sheet',
    ).toBe(true);
    expect(beforeResolve, 'the sheet carries a placeholder, not a project path').toContain(
      '__OE_COMPONENT_URL__',
    );
    expect(beforeResolve, 'a data URL is left alone').toContain('data:image/gif;base64');
    expect(beforeResolve, 'a fragment is left alone').toContain('url(#probe-paint)');
    expect(beforeResolve, 'a root-absolute URL is left alone').toContain('/probe-public.png');
    expect(beforeResolve, 'a scheme URL is left alone').toContain('https://example.invalid/a.png');

    // The generateBundle half resolves every placeholder through the bundler's
    // own file-name mapping.
    const bundle: Record<string, { type: 'asset'; source: string | Uint8Array }> = {
      [sheet.fileName]: { type: 'asset', source: sheet.source },
    };
    const generateContext = {
      environment: { config: { base: '/' } },
      getFileName: () => 'assets/probe-texture-ABC123.png',
    };
    const runGenerate = (target: unknown): void => {
      (urlPlugin.generateBundle as unknown as (options: unknown, bundle: unknown) => void).call(
        generateContext,
        {},
        target,
      );
    };
    runGenerate(bundle);

    const resolved = bundle[sheet.fileName]!.source;
    const afterResolve =
      typeof resolved === 'string' ? resolved : Buffer.from(resolved).toString('utf8');
    expect(afterResolve, 'no placeholder survives generation').not.toContain(
      '__OE_COMPONENT_URL__',
    );
    // The quote the source wrote is preserved, and an absolute base makes the
    // URL base-absolute — Vite's own rule for a CSS asset, shared with the
    // style-edge emitter (`cssAssetUrl`).
    expect(afterResolve, 'the target is the emitted asset’s own URL').toContain(
      "url('/assets/probe-texture-ABC123.png')",
    );
    expect(afterResolve, 'the other targets are untouched').toContain('url(#probe-paint)');

    // A bundle that does not carry the sheet is not this pass's business.
    runGenerate({});
  } finally {
    await rm(referenced, { force: true });
    await rm(scratchCss, { force: true });
  }
});

test('a build with no emission yet, and a bundle holding bytes, are both handled', async () => {
  const integration = await integrationWith(['gap-2']);
  const plugin = integration.sheetPlugins[0] as Plugin;
  const assets: EmittedAsset[] = [];
  const context = stubContext(assets);
  const runGenerate = (target: unknown, self: unknown): void => {
    (plugin.generateBundle as unknown as (options: unknown, bundle: unknown) => void).call(
      self,
      {},
      target,
    );
  };
  const self = {
    environment: { config: { base: '' } },
    getFileName: () => 'assets/bytes-target.png',
  };

  // Before any sheet was emitted there is nothing to resolve — the pass is a
  // no-op rather than a crash on a missing record.
  runGenerate({}, self);

  await (plugin.buildStart as () => Promise<void>).call(context);
  const sheet = assets.find((asset) => asset.fileName === integration.componentRecord.fileName)!;
  // A bundler may hand the asset back as bytes; the pass reads either form.
  const bundle: Record<string, { type: 'asset'; source: string | Uint8Array }> = {
    [sheet.fileName]: { type: 'asset', source: Buffer.from('body{color:red}') },
  };
  runGenerate(bundle, self);
  const resolved = bundle[sheet.fileName]!.source;
  const text = typeof resolved === 'string' ? resolved : Buffer.from(resolved).toString('utf8');
  expect(text, 'a byte-backed asset is read, not skipped').toBe('body{color:red}');
});
