import type { ImportDecl } from '../protocol/ssg.ts';
import { quoteGeneratedJavaScriptValue } from './codegen-literals.ts';

type RendererMode = 'native' | 'lit';

interface RendererAdapter {
  readonly mode: RendererMode;
  readonly hydration: 'compiled-claim' | 'lit-adoption';
  readonly supportsCompiledStream: boolean;
  readonly firstServerImport?: string;
  serverImports(hasStreamRoute: boolean): ImportDecl[];
}

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
