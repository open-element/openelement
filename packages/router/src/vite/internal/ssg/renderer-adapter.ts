import type { ImportDecl } from '../protocol/ssg.ts';
import { quoteGeneratedJavaScriptValue } from './codegen-literals.ts';

type RendererMode = 'native' | 'lit';

/**
 * The typed page-render runtime seam (ADR-0160 rule a): which
 * @openelement/router/server-runtime functions the generated entry imports
 * and how it binds them to its data (the serialized tag list, dangerous keys,
 * shell plan, nav/locale declarations, and the entry's own Element imports).
 * The emitted call sites (`__ssr`, `__pageProps`, `__renderAppShell`, …) are
 * identical for both renderers — only this seam forks.
 */
interface RuntimeSeam {
  imports: ImportDecl[];
  wiring: string[];
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
    return [{
      from: '@openelement/element',
      names: [
        'createDeferredDsdExecutor',
        ...(hasStreamRoute ? ['documentStreamParts', 'escapeAttr'] : []),
        'renderDsd',
        'trustedHtml',
        'escapeHtml',
        'wrapInDocument',
      ],
    }];
  },
  runtimeSeam() {
    return {
      imports: [
        { from: RUNTIME_MODULE, names: ['resolveCompiledPageTag'], alias: '__resolvePageTag' },
        {
          from: RUNTIME_MODULE,
          names: ['createNativePageRenderer'],
          alias: '__createPageRenderer',
        },
        {
          from: RUNTIME_MODULE,
          names: ['createPagePropsRuntime'],
          alias: '__createPagePropsRuntime',
        },
        { from: RUNTIME_MODULE, names: ['pageDefinition'], alias: '__pageDefinition' },
        { from: RUNTIME_MODULE, names: ['routeMeta'], alias: '__routeMeta' },
        { from: RUNTIME_MODULE, names: ['localeFromPath'], alias: '__localeFromPath' },
        { from: RUNTIME_MODULE, names: ['createStatusHtml'], alias: '__createStatusHtml' },
        {
          from: RUNTIME_MODULE,
          names: ['createAppShellRuntime'],
          alias: '__createAppShellRuntime',
        },
      ],
      wiring: [
        'const __ssr = __createPageRenderer({ renderDsd, customElements, ssrRenderableTags: __ssrRenderableTags });',
        'const { pageProps: __pageProps, pageErrorProps: __pageErrorProps } = __createPagePropsRuntime({ dangerousKeys: __DANGEROUS_KEYS });',
        'const __statusHtml = __createStatusHtml(escapeHtml);',
        'const { resolveAppShell: __resolveAppShell, renderAppShell: __renderAppShell } = __createAppShellRuntime({ ssr: __ssr, trustedHtml, appShellPlan: __appShellPlan, locales: __locales, navSections: __navSections, headerNav: __headerNav, defaultLocale: __getDefaultLocale() });',
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
        {
          from: RUNTIME_MODULE,
          names: ['createLitPageRenderer'],
          alias: '__createLitPageRenderer',
        },
        {
          from: RUNTIME_MODULE,
          names: ['createPagePropsRuntime'],
          alias: '__createPagePropsRuntime',
        },
        { from: RUNTIME_MODULE, names: ['pageDefinition'], alias: '__pageDefinition' },
        { from: RUNTIME_MODULE, names: ['routeMeta'], alias: '__routeMeta' },
        { from: RUNTIME_MODULE, names: ['localeFromPath'], alias: '__localeFromPath' },
        { from: RUNTIME_MODULE, names: ['createStatusHtml'], alias: '__createStatusHtml' },
        {
          from: RUNTIME_MODULE,
          names: ['createAppShellRuntime'],
          alias: '__createAppShellRuntime',
        },
      ],
      wiring: [
        'const __ssr = __createLitPageRenderer({ renderLitPageToHtml: __renderLitPageToHtml });',
        'const { pageProps: __pageProps, pageErrorProps: __pageErrorProps } = __createPagePropsRuntime({ dangerousKeys: __DANGEROUS_KEYS });',
        'const __statusHtml = __createStatusHtml(escapeHtml);',
        'const { resolveAppShell: __resolveAppShell, renderAppShell: __renderAppShell } = __createAppShellRuntime({ ssr: __ssr, trustedHtml, appShellPlan: __appShellPlan, locales: __locales, navSections: __navSections, headerNav: __headerNav, defaultLocale: __getDefaultLocale() });',
      ],
    };
  },
};

/** Internal mode selection only; SSR and browser executors stay independent. */
export function selectRendererAdapter(value: unknown): RendererAdapter {
  if (value === undefined || value === 'native') return native;
  if (value === 'lit') return lit;
  throw new Error(
    `[openElement] renderer must be 'native' or 'lit' (got ${
      quoteGeneratedJavaScriptValue(String(value))
    }). ` +
      'Renderer selection is explicit openElement({ renderer }) config and is never inferred.',
  );
}
