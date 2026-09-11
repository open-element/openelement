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
 */

import type { Plugin } from 'vite';
import { marked } from 'marked';
import { normalizeSeparators, pathToTagName } from '@openelement/element/build-utils';
import { relative, resolve, sep } from 'node:path';
import { readFile } from 'node:fs/promises';
import process from 'node:process';

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

/** Quote one text run as a JSX expression container (`{"..."}`). */
function jsxText(value: string): string {
  return `{${JSON.stringify(value)}}`;
}

function failMdx(filePath: string, reason: string): never {
  throw new Error(
    `[openElement] MDX page ${filePath}: ${reason}. ` +
      'The 0.44 MDX contract is the static Markdown subset — raw HTML, JSX ' +
      'expressions and ESM statements are outside it (ADR-0143); move ' +
      'interactive content into a compiled element.',
  );
}

type MarkedToken = {
  type: string;
  text?: string;
  href?: string;
  title?: string | null;
  depth?: number;
  ordered?: boolean;
  lang?: string;
  tokens?: MarkedToken[];
  items?: MarkedToken[];
};

/** Inline token list -> JSX children source (static text/elements only). */
function inlineToJsx(tokens: MarkedToken[] | undefined, filePath: string): string {
  if (!tokens) return '';
  let out = '';
  for (const token of tokens) {
    switch (token.type) {
      case 'text':
      case 'escape':
        out += jsxText(token.text ?? '');
        break;
      case 'strong':
        out += `<strong>${inlineToJsx(token.tokens, filePath)}</strong>`;
        break;
      case 'em':
        out += `<em>${inlineToJsx(token.tokens, filePath)}</em>`;
        break;
      case 'del':
        out += `<del>${inlineToJsx(token.tokens, filePath)}</del>`;
        break;
      case 'codespan':
        out += `<code>${jsxText(token.text ?? '')}</code>`;
        break;
      case 'link': {
        const href = token.href ?? '';
        if (/^javascript:/i.test(href.trim())) {
          failMdx(filePath, 'javascript: links are not allowed');
        }
        const title = token.title ? ` title=${JSON.stringify(token.title)}` : '';
        out += `<a href=${JSON.stringify(href)}${title}>${inlineToJsx(token.tokens, filePath)}</a>`;
        break;
      }
      case 'image':
        out += `<img src=${JSON.stringify(token.href ?? '')} alt=${
          JSON.stringify(token.text ?? '')
        } />`;
        break;
      case 'br':
        out += '<br />';
        break;
      case 'html':
        failMdx(filePath, 'raw HTML blocks/inline HTML are outside the static subset');
        break;
      default:
        failMdx(filePath, `unsupported inline token "${token.type}"`);
    }
  }
  return out;
}

/** Block token list -> JSX children source. */
function blockToJsx(tokens: MarkedToken[], filePath: string): string {
  let out = '';
  for (const token of tokens) {
    switch (token.type) {
      case 'space':
        break;
      case 'heading': {
        const depth = Math.min(Math.max(token.depth ?? 1, 1), 6);
        out += `<h${depth}>${inlineToJsx(token.tokens, filePath)}</h${depth}>`;
        break;
      }
      case 'paragraph':
        out += `<p>${inlineToJsx(token.tokens, filePath)}</p>`;
        break;
      case 'text':
        out += jsxText(token.text ?? '');
        break;
      case 'blockquote':
        out += `<blockquote>${blockToJsx(token.tokens ?? [], filePath)}</blockquote>`;
        break;
      case 'list': {
        const tag = token.ordered ? 'ol' : 'ul';
        const items = (token.items ?? []).map((item) => {
          if (item.type !== 'list_item') failMdx(filePath, 'unsupported list item');
          // List items mix inline text and nested blocks; marked nests the
          // inline content in item.tokens (text tokens carry inline tokens).
          let body = '';
          for (const child of item.tokens ?? []) {
            if (child.type === 'text' && child.tokens) body += inlineToJsx(child.tokens, filePath);
            else body += blockToJsx([child], filePath);
          }
          return `<li>${body}</li>`;
        });
        out += `<${tag}>${items.join('')}</${tag}>`;
        break;
      }
      case 'code': {
        const lang = token.lang ? ` class=${JSON.stringify(`language-${token.lang}`)}` : '';
        out += `<pre><code${lang}>${jsxText(token.text ?? '')}</code></pre>`;
        break;
      }
      case 'hr':
        out += '<hr />';
        break;
      case 'html':
        failMdx(filePath, 'raw HTML blocks are outside the static subset');
        break;
      default:
        failMdx(filePath, `unsupported block token "${token.type}"`);
    }
  }
  return out;
}

function pascalCase(stem: string): string {
  const parts = stem.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const name = parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  return name.length > 0 && /^[A-Za-z]/.test(name) ? name : 'MdxPage';
}

/**
 * Lower one .mdx source to the canonical compiled page module source (TSX).
 * The result is compiled by the standard open:core transform — this function
 * never evaluates page code and never emits a runtime JSX path.
 */
export function mdxToCompiledPageSource(
  source: string,
  filePath: string,
  routesDir?: string,
): string {
  // ESM statements are outside the static subset — a Markdown page never
  // starts a line with import/export; MDX component files do.
  if (/^\s*(import|export)\s/m.test(source)) {
    failMdx(filePath, 'import/export statements are outside the static subset');
  }
  const tokens = marked.lexer(source) as MarkedToken[];
  const body = blockToJsx(tokens, filePath);

  // The compiled tag must equal the entry's path-derived registration tag:
  // derive it from the route-file-relative path exactly like the scanner.
  let tag: string;
  if (routesDir) {
    const absoluteRoutes = resolve(process.cwd(), routesDir);
    const relativePath = relative(absoluteRoutes, filePath);
    tag = relativePath.startsWith('..')
      ? pathToTagName(filePath.split(sep).pop() ?? filePath)
      : pathToTagName(normalizeSeparators(relativePath));
  } else {
    tag = pathToTagName(filePath.split(sep).pop() ?? filePath);
  }
  if (!tag) failMdx(filePath, 'could not derive a custom-element tag from the file path');

  const className = pascalCase(tag);
  return [
    "import { element, OpenElement } from '@openelement/element';",
    '',
    `// Static MDX pages render with the same page contract as compiled pages:`,
    `// page content lives in the host's DSD shadow root.`,
    `@element('${tag}', { root: 'shadow-open' })`,
    `export default class ${className} extends OpenElement {`,
    '  render() {',
    '    return (',
    '      <main>',
    `        ${body}`,
    '      </main>',
    '    );',
    '  }',
    '}',
    '',
  ].join('\n');
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

    transform(code, id) {
      if (!id.startsWith(VIRTUAL_PREFIX) || !id.endsWith(VIRTUAL_SUFFIX)) return null;
      const filePath = id.slice(VIRTUAL_PREFIX.length, -VIRTUAL_SUFFIX.length);
      const tsx = mdxToCompiledPageSource(code, filePath, options.routesDir);
      // Hand the compiled page module source to the standard pipeline: the
      // open:core transform hook compiles it (id ends in .tsx and carries a
      // real @element decorator application).
      return { code: tsx };
    },
  };
}
