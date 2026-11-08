import type { ImportDecl } from '@openelement/protocol/ssg';
import { quoteGeneratedJavaScriptValue } from './codegen-literals.ts';

type RendererMode = 'native';

/**
 * The typed page-render runtime seam: which
 * @openelement/router/server-runtime functions the generated entry imports
 * and how its `createGeneratedApp` config binds the page-render runtime to
 * the entry's own Element imports. The emitted call sites (`__ssr`,
 * `__pageProps`, `__renderLayout`, …) are generated for the compiled native
 * renderer only. The runtime binding itself moved into the factory
 * (server-runtime/app.ts, #1470 block e); the entry keeps only the
 * adapter-selected imports and the `pageRuntime` config lines.
 */
interface RuntimeSeam {
  /** Pure helper functions the emitted call sites reference by name. */
  imports: ImportDecl[];
  /** The adapter's startup stream guard, imported as `__assertStreamRoute`. */
  streamGuard: ImportDecl;
  /**
   * The renderer-specific lines of the entry's `pageRuntime` factory config:
   * mode plus the Element functions this renderer's entry imports. The
   * orchestrator appends the `ssrRenderableTags` build data.
   */
  pageRuntimeLines: string[];
}

interface RendererAdapter {
  readonly mode: RendererMode;
  readonly hydration: 'compiled-hydration';
  readonly supportsCompiledStream: boolean;
  serverImports(hasStreamRoute: boolean): ImportDecl[];
  runtimeSeam(): RuntimeSeam;
}

const RUNTIME_MODULE = '@openelement/router/server-runtime';

const native: RendererAdapter = {
  mode: 'native',
  hydration: 'compiled-hydration',
  supportsCompiledStream: true,
  serverImports(hasStreamRoute) {
    return [
      {
        from: '@openelement/element',
        names: [
          'createDocumentStyleResources',
          'createStreamShellExecutor',
          ...(hasStreamRoute ? ['documentStreamParts', 'escapeAttr'] : []),
          'renderToString',
          'trustedHtml',
          'escapeHtml',
          'wrapInDocument',
        ],
      },
    ];
  },
  runtimeSeam() {
    return {
      imports: [
        { from: RUNTIME_MODULE, names: ['resolveCompiledPageTag'], alias: '__resolvePageTag' },
        { from: RUNTIME_MODULE, names: ['pageDefinition'], alias: '__pageDefinition' },
        { from: RUNTIME_MODULE, names: ['routeMeta'], alias: '__routeMeta' },
        { from: RUNTIME_MODULE, names: ['localeFromPath'], alias: '__localeFromPath' },
      ],
      streamGuard: {
        from: RUNTIME_MODULE,
        names: ['assertCompiledStreamRoute'],
        alias: '__assertStreamRoute',
      },
      pageRuntimeLines: [
        `mode: 'native',`,
        `renderToString,`,
        `customElements,`,
        `trustedHtml,`,
        `escapeHtml,`,
      ],
    };
  },
};

/** Internal mode selection only; SSR and browser executors stay independent. */
export function selectRendererAdapter(value: unknown): RendererAdapter {
  if (value === undefined || value === 'native') return native;
  if (value === 'lit') {
    throw new Error(
      "[openElement] renderer 'lit' is retired (ADR-0152, 2026-11-08 owner ruling): " +
        'the first-party Lit renderer was removed because a Web Component host ' +
        'cannot carry the full-stack rendering scope. Use the compiled native ' +
        'renderer; no compatibility adapter is provided.',
    );
  }
  throw new Error(
    `[openElement] renderer must be 'native' (got ${quoteGeneratedJavaScriptValue(
      String(value),
    )}). ` +
      'Renderer selection is explicit openElement({ renderer }) config and is never inferred.',
  );
}
