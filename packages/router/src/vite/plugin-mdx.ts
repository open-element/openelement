/**
 * @openelement/router — open:mdx plugin (v0.44).
 *
 * MDX/static content is lowered to a compiled page program at build time —
 * there is no runtime VNode path (ADR-0143): a `.mdx` module resolves to a
 * virtual `.tsx` module carrying an `@element(...)` class whose render() holds
 * the page markup as a fully static compiled template, then runs through the
 * standard open:core compiled-element transform.
 *
 * The 0.44 MDX contract is the STATIC MARKDOWN subset (headings, paragraphs,
 * emphasis/strong/delete, links, images, lists, code, blockquotes, hr):
 * raw HTML blocks, JSX expressions, ESM import/export and component usage
 * inside .mdx fail closed with a source-located build error. Interactive
 * content moves into compiled elements composed by the page.
 *
 * `marked` is an OPTIONAL peer of @openelement/router: only consumers with
 * `.mdx` routes need it. The lowering module (plugin-mdx-lower.ts) imports
 * `marked` at top level, so it is loaded lazily on the first `.mdx` transform
 * — consumers without MDX pages never resolve the package, and an MDX page
 * without `marked` installed fails closed with install guidance.
 */

import type { Plugin } from 'vite';
import { readFile } from 'node:fs/promises';

/** Options for the `.mdx` route plugin ({@linkcode mdxPlugin}). */
export interface OpenMdxPluginOptions {
  /**
   * Routes directory (as configured in openElement()). The compiled page tag
   * derives from the route-file-relative path so the generated entry's
   * path-derived registration tag matches the program tag.
   */
  routesDir?: string;
}

const VIRTUAL_PREFIX = '\0open-mdx:';
const VIRTUAL_SUFFIX = '.tsx';

type LowerModule = typeof import('./plugin-mdx-lower.ts');

let lowerPromise: Promise<LowerModule> | undefined;

function loadLower(): Promise<LowerModule> {
  lowerPromise ??= import('./plugin-mdx-lower.ts').catch((cause: unknown) => {
    if (cause instanceof Error && /marked/.test(cause.message)) {
      throw new Error(
        '[openElement] MDX routes require the optional peer dependency "marked" ' +
          '(declared by @openelement/router). Install it into your app: add ' +
          '"marked": "npm:marked@^15.0.0" to the deno.json imports ' +
          '(npm consumers: `npm install --save-dev marked`).',
        { cause },
      );
    }
    throw cause;
  });
  return lowerPromise;
}

/** Vite plugin compiling `.mdx` route files into compiled page modules. */
export function mdxPlugin(options: OpenMdxPluginOptions = {}): Plugin {
  return {
    name: 'open:mdx',
    enforce: 'pre',

    async resolveId(id, importer) {
      if (!id.endsWith('.mdx')) return null;
      // Resolve to the real file first, then remap to a virtual .tsx module so
      // the compiled-element transform (and esbuild's TS stripping) apply.
      const resolved = await this.resolve(id, importer, { skipSelf: true });
      if (!resolved) return null;
      return `${VIRTUAL_PREFIX}${resolved.id}${VIRTUAL_SUFFIX}`;
    },

    async load(id) {
      if (!id.startsWith(VIRTUAL_PREFIX) || !id.endsWith(VIRTUAL_SUFFIX)) return null;
      const filePath = id.slice(VIRTUAL_PREFIX.length, -VIRTUAL_SUFFIX.length);
      try {
        return await readFile(filePath, 'utf8');
      } catch {
        throw new Error(`[openElement] Unable to read MDX page: ${filePath}`);
      }
    },

    async transform(code, id) {
      if (!id.startsWith(VIRTUAL_PREFIX) || !id.endsWith(VIRTUAL_SUFFIX)) return null;
      const filePath = id.slice(VIRTUAL_PREFIX.length, -VIRTUAL_SUFFIX.length);
      const { mdxToCompiledPageSource } = await loadLower();
      const tsx = mdxToCompiledPageSource(code, filePath, options.routesDir);
      // Hand the compiled page module source to the standard pipeline: the
      // open:core transform hook compiles it (id ends in .tsx and carries a
      // real @element decorator application).
      return { code: tsx };
    },
  };
}
