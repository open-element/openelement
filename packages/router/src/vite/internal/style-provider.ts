/**
 * The style provider port and its selection point (alpha15 stage 2B).
 *
 * TWO HALVES, ONE MODULE, because they are one decision seen twice. The PORT
 * is the boundary: what the framework needs from ANY utility engine, and
 * nothing more. The SELECTION POINT is the one place that boundary is
 * crossed — `createStyleBuildIntegration` assembles the adapter the plan
 * selected, the Vite plugins that compile its sheets, and the records the build
 * reads the emitted file names back from. It is a plain switch on a closed
 * two-value union: no registry, no plugin lookup, no capability negotiation,
 * and no engine the plan did not select is ever imported.
 *
 * The framework owns exactly four facts about styles: the DECLARED demand, the
 * opaque class candidates its compiler collected, the root scope those
 * candidates belong to, and the DELIVERY of the emitted CSS (content-addressed
 * emission, the fetch adapter, the DSD marked link, the head link, dev serving
 * and HMR). Everything else — utility syntax, source interpretation,
 * configuration, compilation and output shape — belongs to the engine the
 * application selected.
 *
 * The shape was extracted from two real engines, not designed in advance:
 *
 * | | Tailwind | UnoCSS |
 * |---|---|---|
 * | document sheet | a CSS entry module in the Vite graph, compiled by the official plugin | text generated from the resolved Uno config |
 * | component sheet | the official compiler's `build(candidates)` | `generate(candidates)` |
 * | declaration | `@theme` blocks in imported CSS sources | `uno.config.ts` (theme, presets, shortcuts) |
 *
 * That asymmetry is a fact of the two engines, so the port STATES it instead of
 * hiding it behind a fake uniform shape: `StyleProvider.documentDelivery` says
 * whether the document sheet is a graph entry or generated text. Both halves
 * end in the same place — one hashed `.css` asset, one `<link>` in every
 * document head, one marked link in every DSD template — because that half IS
 * framework-owned. Only the road between differs, and that difference is the
 * port.
 */

/**
 * What every provider needs to compile ONE sheet, given the (root, plan) it was
 * constructed for. The provider is built per build or dev server for exactly
 * one plan — engine, sources, reset decision and root are construction facts,
 * not per-call arguments — so this input carries only what varies per sheet.
 */
export interface StyleSheetCompileInput {
  /**
   * The admitted class candidates for THIS sheet, in first-seen order, as the
   * owning registry recorded them. Opaque: the provider decides which of them
   * it can compile, and an uncompilable one is the provider's own diagnostic.
   */
  readonly candidates: readonly string[];
  /**
   * Module id → source text, for the modules the framework walked. Providers
   * that extract candidates from source consume them through their OWN
   * extractors (UnoCSS's `applyExtractors`); providers whose integration
   * already owns source detection ignore the iterable.
   */
  readonly sources: Iterable<readonly [string, string]>;
}

/**
 * How a provider's DOCUMENT sheet reaches the build.
 *
 * - `graph-entry`: the provider contributes a CSS entry module plus the
 *   plugins that compile it, and Vite's own CSS pipeline emits the asset
 *   (Tailwind: `@import` entry text + `@tailwindcss/vite`).
 * - `generated`: the provider returns the sheet text from
 *   {@linkcode StyleProvider.compileDocument} and the framework's existing
 *   content-addressed style-asset protocol emits it (UnoCSS).
 */
export type StyleDocumentDelivery = 'graph-entry' | 'generated';

/** One engine's compile contract. */
export interface StyleProvider {
  /** The engine this adapter implements. */
  readonly id: StyleProviderId;
  /**
   * The class dialects this adapter can compile. A declared requirement whose
   * dialect is absent fails the plan before any compile; see
   * {@linkcode STYLE_PROVIDER_SUPPORT} for the shipped table the plan reads.
   */
  readonly dialects: readonly string[];
  /** How the document sheet reaches the build (see the type's note). */
  readonly documentDelivery: StyleDocumentDelivery;
  /**
   * The module specifier of the COMPONENT sheet's adapter — the module the
   * generated client entry imports so every shadow root adopts one shared
   * `CSSStyleSheet`. Module identity belongs to the provider's integration, so
   * each engine names its own.
   */
  readonly componentSheetSpecifier: string;
  /**
   * The identity of the DOCUMENT sheet. For a `generated` delivery this is the
   * adapter specifier (the framework emits the sheet whether or not anything
   * imports it); for a `graph-entry` delivery it is the CSS entry module path
   * the generated client entry imports so Vite's pipeline compiles it.
   */
  readonly documentSheetModule: string;
  /**
   * Compile the COMPONENT sheet — the utilities a shadow root needs. Always
   * present: every provider delivers this sheet as generated text through the
   * framework's asset protocol.
   */
  compileComponents(input: StyleSheetCompileInput): Promise<string>;
  /**
   * Compile the DOCUMENT sheet. Present exactly when
   * {@linkcode documentDelivery} is `generated`; a `graph-entry` provider's
   * document half is its plugin contribution instead.
   */
  compileDocument?(input: StyleSheetCompileInput): Promise<string>;
  /**
   * The absolute files whose change must invalidate a cached dev compile —
   * the provider's own configuration and produced sources. The framework
   * watches them; it never parses them.
   */
  readonly watchFiles: readonly string[];
}

import type { Plugin } from 'vite';
import type { UnocssOptions } from '../../config.ts';
import {
  generatedSheetBase,
  generatedSheetGraphId,
  generatedSheetsPlugin,
  type SheetFileNameRecord,
} from './generated-sheets.ts';
import { createTailwindProvider } from './providers/tailwind.ts';
import { createUnocssProvider } from './providers/unocss.ts';
import type { ResolvedStyleSelection, StyleProviderId } from './style-plan.ts';

/** The `unocss` declaration's config path, whenever the app declared one. */
export function declaredUnocssConfig(
  unocss: boolean | UnocssOptions | undefined,
): string | undefined {
  return typeof unocss === 'object' && unocss !== null ? unocss.config : undefined;
}

/** What one build or dev server mounts for the engine its plan selected. */
export interface StyleBuildIntegration {
  readonly provider: StyleProvider;
  /** The plan this integration was built for (the dev channels read it back). */
  readonly plan: ResolvedStyleSelection;
  /**
   * The plugins that make the ENGINE's inputs exist, mounted BEFORE the
   * server-rendered discovery pass. A `graph-entry` provider contributes its
   * CSS entry module plus the official peer here, because Vite's own CSS
   * pipeline compiles that entry as the graph reaches it; a `generated`
   * provider contributes nothing, because its sheets are produced from the
   * build's facts rather than from the graph.
   */
  readonly graphPlugins: Plugin[];
  /**
   * The plugins that COMPILE the sheets, mounted AFTER the discovery pass: the
   * component sheet (every provider) and a generated document sheet. Their
   * `buildStart` reads the candidates the pass registered, so mounting them
   * first would compile from an empty registry — the ordering defect B exists
   * for.
   */
  readonly sheetPlugins: Plugin[];
  /** The component sheet's emission record. */
  readonly componentRecord: SheetFileNameRecord;
  /**
   * The document sheet's emission record — present exactly for a `generated`
   * delivery, where the framework emits the asset itself. A `graph-entry`
   * provider's document asset comes from Vite's CSS pipeline instead
   * (`findClientEntryStyles`), so there is nothing to record here.
   */
  readonly documentRecord: SheetFileNameRecord | undefined;
}

/** The inputs both adapters' compile calls share. */
export interface StyleIntegrationInput {
  readonly root: string;
  readonly plan: ResolvedStyleSelection;
  /** The application's own `unocss` declaration (its config path). */
  readonly unocss: boolean | UnocssOptions | undefined;
  /**
   * The candidates the COMPONENT sheet must carry: every admitted one, light
   * roots included. A light-root component's DOM is not always the document's
   * DOM — the layout convention renders every page inside the layout's shadow
   * template, and a shadow component can render a light-root child — so a
   * document-level class can end up in a tree only the component sheet reaches.
   */
  componentSheetCandidates(): readonly string[];
  /** The admitted LIGHT-root candidates (the document sheet's input). */
  documentCandidates(): readonly string[];
  /** The module texts this build walked (id → source), for token extraction. */
  sources(): Iterable<readonly [string, string]>;
}

/**
 * Assemble the selected engine's integration. Async only because a generated
 * provider loads its peer and project configuration here; the Tailwind adapter
 * loads nothing until its first compile.
 */
export async function createStyleBuildIntegration(
  input: StyleIntegrationInput,
): Promise<StyleBuildIntegration> {
  const { root, plan } = input;
  if (plan.provider === 'unocss') {
    const provider = await createUnocssProvider(root, plan, declaredUnocssConfig(input.unocss));
    const componentRecord: SheetFileNameRecord = { fileName: undefined };
    const documentRecord: SheetFileNameRecord = { fileName: undefined };
    const compileInput = () => ({ sources: input.sources() });
    return {
      provider,
      plan,
      componentRecord,
      documentRecord,
      graphPlugins: [],
      sheetPlugins: [
        generatedSheetsPlugin([
          {
            specifier: provider.documentSheetModule,
            graphId: generatedSheetGraphId(`${provider.id}-document`),
            urlBase: generatedSheetBase(root),
            record: documentRecord,
            adapterComments: [
              '// The document stylesheet: delivered to the head as its own',
              '// content-addressed asset, so nothing imports this adapter in a',
              '// generated entry — it exists for an explicit importer only.',
            ],
            compile: async () => {
              const compile = provider.compileDocument;
              if (compile === undefined) return '';
              return await compile({ ...compileInput(), candidates: input.documentCandidates() });
            },
          },
          {
            specifier: provider.componentSheetSpecifier,
            graphId: generatedSheetGraphId(`${provider.id}-components`),
            urlBase: generatedSheetBase(root),
            record: componentRecord,
            adapterComments: [
              '// The shared component stylesheet: the utilities the admitted',
              '// shadow-root class candidates compile to, adopted as one',
              '// CSSStyleSheet object by every shadow root.',
            ],
            compile: () =>
              provider.compileComponents({
                ...compileInput(),
                candidates: input.componentSheetCandidates(),
              }),
          },
        ]),
      ],
    };
  }

  const { componentStyleSheetPlugin, tailwindEntryPlugin, tailwindPlugins } =
    await import('../tailwind.ts');
  const provider = createTailwindProvider(root, plan);
  const componentRecord: SheetFileNameRecord = { fileName: undefined };
  return {
    provider,
    plan,
    componentRecord,
    documentRecord: undefined,
    graphPlugins: [tailwindEntryPlugin(root, plan), ...(await tailwindPlugins())],
    sheetPlugins: [
      componentStyleSheetPlugin(root, plan, input.componentSheetCandidates, componentRecord),
    ],
  };
}
