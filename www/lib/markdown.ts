/**
 * site markdown pipeline — marked + build-time syntax highlighting.
 *
 * The ONE renderer for every authored Markdown surface (guide, architecture,
 * guide and architecture collections). Code fences are compiled to
 * token-span HTML by Shiki here, on the build machine: the highlighter, its
 * grammars and its theme are devDependencies that never enter a page bundle
 * or a published package. The emitted token classes resolve through the site
 * palette (www/site-css.css), so the light/dark palettes switch with
 * `data-theme` exactly like every other site color, with no runtime
 * highlighter and no highlight flash.
 *
 * Shiki runs on the JavaScript regex engine in strict mode: if a grammar is
 * not JS-engine-compatible the create call throws and the build fails — no
 * Oniguruma WASM is loaded at all.
 *
 * Language policy (fail closed): a fence whose language is neither in the
 * alias table nor a plain-text alias throws at generation time — an unknown
 * grammar must be added here deliberately, never silently rendered plain.
 *
 * Code authored outside Markdown (page-component code blocks) shares this
 * pipeline through {@linkcode highlightSiteCode} — same highlighter instance,
 * same theme variables, one grammar table.
 */

import { Marked, type Tokens } from 'marked';
import { normalizeSiteHref } from '../app/site-ui/site-url.ts';
import {
  createCssVariablesTheme,
  createHighlighter,
  createJavaScriptRegexEngine,
  type Highlighter,
  type ShikiTransformer,
} from 'shiki';

/**
 * Keep Shiki's semantic color assignments and use the document stylesheet's
 * live palette for the site's light DOM code, including projected samples.
 */
export const siteCodeTheme = createCssVariablesTheme({ variablePrefix: '--shiki-' });

const TOKEN_COLOR_CLASSES = new Set([
  'shiki-foreground',
  'shiki-token-comment',
  'shiki-token-punctuation',
  'shiki-token-constant',
  'shiki-token-string',
  'shiki-token-string-expression',
  'shiki-token-keyword',
  'shiki-token-function',
  'shiki-token-parameter',
  'shiki-token-link',
  'shiki-token-inserted',
  'shiki-token-deleted',
  'shiki-token-changed',
]);
const TOKEN_FONT_CLASSES = new Map([
  ['font-style:italic', 'shiki-italic'],
  ['font-weight:bold', 'shiki-bold'],
  ['text-decoration:underline', 'shiki-underline'],
  ['text-decoration:line-through', 'shiki-strike'],
  ['text-decoration:underline line-through', 'shiki-underline-strike'],
]);

const highlightClasses: ShikiTransformer = {
  pre(node) {
    if (
      node.properties.style !==
      'background-color:var(--shiki-background);color:var(--shiki-foreground)'
    ) {
      throw new Error('[markdown] unexpected Shiki code-block style');
    }
    delete node.properties.style;
  },
  span(node) {
    const style = node.properties.style;
    if (typeof style !== 'string') return;
    for (const declaration of style.split(';')) {
      const color = /^color:var\(--(shiki-[a-z-]+)\)$/.exec(declaration)?.[1];
      const name =
        color && TOKEN_COLOR_CLASSES.has(color) ? color : TOKEN_FONT_CLASSES.get(declaration);
      if (!name) throw new Error(`[markdown] unexpected Shiki token style '${declaration}'`);
      this.addClassToHast(node, name);
    }
    delete node.properties.style;
  },
};

/** Grammars loaded into the highlighter — the full closed set the site needs. */
const SITE_CODE_LANGS = ['typescript', 'tsx', 'javascript', 'json', 'bash', 'css', 'html', 'text'];

/**
 * Fence-info aliases the authored content uses, mapped onto the grammars
 * above. Anything outside this table (or PLAIN_FENCE_LANGS) fails the build.
 */
const FENCE_LANG_ALIASES: Readonly<Record<string, string>> = {
  ts: 'typescript',
  typescript: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  javascript: 'javascript',
  json: 'json',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  bash: 'bash',
  html: 'html',
  css: 'css',
};

/** Fence languages that are deliberately unhighlighted (marked's plain path). */
const PLAIN_FENCE_LANGS = new Set(['', 'text', 'txt', 'plain', 'plaintext', 'none']);

let highlighterPromise: Promise<Highlighter> | undefined;

function loadSiteHighlighter(): Promise<Highlighter> {
  return (highlighterPromise ??= createHighlighter({
    themes: [siteCodeTheme],
    langs: SITE_CODE_LANGS,
    engine: createJavaScriptRegexEngine(),
  }));
}

function normalizeFenceLang(lang: string | undefined): string {
  return (lang ?? '').trim().toLowerCase().split(/\s+/)[0] ?? '';
}

let markedPromise: Promise<Marked> | undefined;

/**
 * The site's marked instance, ready once the highlighter has loaded. marked's
 * block renderers are strictly synchronous (Parser.parse concatenates
 * strings), so the async engine load happens HERE, before any parse — after
 * which codeToHtml is synchronous and every fence renders in one pass.
 */
function loadSiteMarkdown(): Promise<Marked> {
  return (markedPromise ??= loadSiteHighlighter().then(
    (highlighter) =>
      new Marked({
        renderer: {
          code: (token: Tokens.Code): string | false => renderFence(token, highlighter),
          // Site-internal links in authored Markdown reach the document in the
          // outward canonical form (D-02). Returning false keeps marked's own
          // link serializer (escaping, title, autolinks); mutating the token
          // first makes that fallback render the normalized target.
          link: (token: Tokens.Link): string | false => {
            const normalized = normalizeSiteHref(token.href);
            if (normalized !== token.href) token.href = normalized;
            return false;
          },
        },
      }),
  ));
}

function renderFence(token: Tokens.Code, highlighter: Highlighter): string | false {
  const fence = normalizeFenceLang(token.lang);
  if (PLAIN_FENCE_LANGS.has(fence)) {
    // Let marked's origin renderer emit its own plain <pre><code> (correct
    // escaping, no token spans to maintain).
    return false;
  }
  return highlightFenceSource(token.text, fence, highlighter);
}

function highlightFenceSource(source: string, fence: string, highlighter: Highlighter): string {
  const grammar = FENCE_LANG_ALIASES[fence];
  if (!grammar) {
    throw new Error(
      `[markdown] unsupported fenced language '${fence}'. Add it to ` +
        `www/lib/markdown.ts (FENCE_LANG_ALIASES / SITE_CODE_LANGS) or use one of: ` +
        `${[...PLAIN_FENCE_LANGS].filter((lang) => lang !== '').join(', ')}.`,
    );
  }
  return highlighter.codeToHtml(source, {
    lang: grammar,
    theme: siteCodeTheme,
    transformers: [highlightClasses],
  });
}

/**
 * The build-time highlighter, exported for code that lives outside the
 * markdown pipeline (the home/contributing page code blocks): same Shiki
 * instance, same `--shiki-*` theme variables, same fail-closed language
 * policy as the fences — never a second highlighter (P6). Pass a language
 * from FENCE_LANG_ALIASES or a plain-text alias to get marked's unhighlighted
 * shape; anything else throws, exactly like an unknown fence.
 */
export async function highlightSiteCode(source: string, lang: string): Promise<string> {
  const fence = normalizeFenceLang(lang);
  if (PLAIN_FENCE_LANGS.has(fence)) {
    throw new Error(
      `[markdown] highlightSiteCode() has no plain path — pass a language from ` +
        `www/lib/markdown.ts FENCE_LANG_ALIASES (${Object.keys(FENCE_LANG_ALIASES).join(', ')}).`,
    );
  }
  const highlighter = await loadSiteHighlighter();
  return highlightFenceSource(source, fence, highlighter);
}

/** Render authored Markdown to the site's static article HTML. */
export async function renderSiteMarkdown(source: string): Promise<string> {
  const siteMarkdown = await loadSiteMarkdown();
  return siteMarkdown.parse(source) as string;
}
