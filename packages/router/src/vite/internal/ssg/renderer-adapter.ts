import type { ImportDecl } from '@openelement/protocol/ssg';
import { quoteGeneratedJavaScriptValue } from './codegen-literals.ts';

type RendererMode = 'native' | 'lit';

/**
 * The typed page-render runtime seam: which
 * @openelement/router/server-runtime functions the generated entry imports
 * and how its `createGeneratedApp` config binds the page-render runtime to
 * the entry's own Element imports. The emitted call sites (`__ssr`,
 * `__pageProps`, `__renderAppShell`, …) are identical for both renderers —
 * only this seam forks. The runtime binding itself moved into the factory
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
  readonly hydration: 'compiled-claim' | 'lit-adoption';
  readonly supportsCompiledStream: boolean;
  readonly firstServerImport?: string;
  serverImports(hasStreamRoute: boolean): ImportDecl[];
  runtimeSeam(): RuntimeSeam;
}

const RUNTIME_MODULE = '@openelement/router/server-runtime';

const native: RendererAdapter = {
  mode: 'native',
  hydration: 'compiled-claim',
  supportsCompiledStream: true,
  serverImports(hasStreamRoute) {
    return [
      {
        from: '@openelement/element',
        names: [
          'createDeferredDsdExecutor',
          ...(hasStreamRoute ? ['documentStreamParts', 'escapeAttr'] : []),
          'renderDsd',
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
        `renderDsd,`,
        `customElements,`,
        `trustedHtml,`,
        `escapeHtml,`,
      ],
    };
  },
};

const lit: RendererAdapter = {
  mode: 'lit',
  hydration: 'lit-adoption',
  supportsCompiledStream: false,
  firstServerImport: "import '@lit-labs/ssr/lib/install-global-dom-shim.js';",
  serverImports() {
    return [
      {
        from: '@openelement/element/html',
        names: ['trustedHtml', 'escapeHtml', 'wrapInDocument'],
      },
      {
        from: '@openelement/router/lit-ssr',
        names: ['renderLitPageToHtml'],
        alias: '__renderLitPageToHtml',
      },
    ];
  },
  runtimeSeam() {
    return {
      imports: [
        { from: RUNTIME_MODULE, names: ['resolveLitPageTag'], alias: '__resolvePageTag' },
        { from: RUNTIME_MODULE, names: ['pageDefinition'], alias: '__pageDefinition' },
        { from: RUNTIME_MODULE, names: ['routeMeta'], alias: '__routeMeta' },
        { from: RUNTIME_MODULE, names: ['localeFromPath'], alias: '__localeFromPath' },
      ],
      streamGuard: {
        from: RUNTIME_MODULE,
        names: ['assertLitStreamRoute'],
        alias: '__assertStreamRoute',
      },
      pageRuntimeLines: [
        `mode: 'lit',`,
        `renderLitPageToHtml: __renderLitPageToHtml,`,
        `trustedHtml,`,
        `escapeHtml,`,
      ],
    };
  },
};

/** Internal mode selection only; SSR and browser executors stay independent. */
export function selectRendererAdapter(value: unknown): RendererAdapter {
  if (value === undefined || value === 'native') return native;
  if (value === 'lit') return lit;
  throw new Error(
    `[openElement] renderer must be 'native' or 'lit' (got ${quoteGeneratedJavaScriptValue(
      String(value),
    )}). ` +
      'Renderer selection is explicit openElement({ renderer }) config and is never inferred.',
  );
}
