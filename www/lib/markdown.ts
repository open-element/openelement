/**
 * site markdown pipeline — marked + build-time syntax highlighting.
 *
 * The ONE renderer for every authored Markdown surface (guide, architecture,
 * blog collections and the changelog archive). Code fences are compiled to
 * token-span HTML by Shiki here, on the build machine: the highlighter, its
 * grammars and its theme are devDependencies that never enter a page bundle
 * or a published package. The emitted markup is plain platform HTML — token
 * colors ride on `var(--shiki-token-*)` references resolved by the site
 * palette table (www/site-css.ts), so the light/dark palettes switch with
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
import {
  createCssVariablesTheme,
  createHighlighter,
  createJavaScriptRegexEngine,
  type Highlighter,
} from 'shiki';

/**
 * The highlight theme: Shiki's CSS-variables theme. Every token color is
 * emitted as a `var(--shiki-token-*)` reference, so the span markup is pure
 * platform HTML and the palette lives in ONE place — the site's document
 * stylesheet (www/site-css.ts), which defines the `--shiki-*` values per
 * theme. Values inherit into every shadow tree (the article prose renders
 * inside page-component shadow roots, where `[data-theme]` selectors cannot
 * reach), so highlighted code paints correctly in both themes with no
 * runtime highlighter and no highlight flash.
 */
export const siteCodeTheme = createCssVariablesTheme({ variablePrefix: '--shiki-' });

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
  // Token colors are var() references resolved by the site palette table
  // (www/site-css.ts) — see the siteCodeTheme note above.
  return highlighter.codeToHtml(source, { lang: grammar, theme: siteCodeTheme });
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
