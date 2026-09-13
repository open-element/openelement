import { assertEquals } from '@std/assert';
import { renderRuntimeHelpers } from '../src/vite/internal/ssg/entry-render-runtime.ts';

Deno.test('generated SSR delegates admitted nested composition to Element', async () => {
  const admitted = ['open-page-rail', 'open-article-view', 'open-reading-shell'];
  const helpers = renderRuntimeHelpers({ default: false, layouts: {} }, admitted);
  assertEquals(helpers.includes('__nestedShellPattern'), false);
  assertEquals(helpers.includes('__propsFromAttrs'), false);
  assertEquals(helpers.includes('__projectLightChildren'), false);

  const harness = `
const calls = [];
const customElements = { get(tag) { return { tag }; } };
const escapeHtml = (value) => String(value);
const __locales = ["en"];
const __getDefaultLocale = () => "en";
const __navSections = [];
const __headerNav = [];
function renderDsd(tag, options) {
  calls.push({ tag, options });
  return { html: "<" + tag + "></" + tag + ">" };
}
${helpers}
export function run() {
  return {
    html: __ssr("guide-page", { model: { title: "Compiled guide" } }, { route: "/guide" }),
    calls,
  };
}
export function localize(href, locale, defaultLocale) {
  return __localizeShellHref(href, locale, defaultLocale);
}
`;
  const mod = await import(
    'data:text/javascript;charset=utf-8,' + encodeURIComponent(harness)
  );
  const result = mod.run() as {
    html: string;
    calls: Array<{ tag: string; options: Record<string, unknown> }>;
  };

  assertEquals(result.html, '<guide-page></guide-page>');
  assertEquals(result.calls.length, 1);
  assertEquals(result.calls[0].tag, 'guide-page');
  assertEquals(result.calls[0].options.ssrRenderableTags, admitted);
  assertEquals(result.calls[0].options.sourceInfo, { route: '/guide' });
  assertEquals(mod.localize('/', 'zh', 'en'), '/zh');
  assertEquals(mod.localize('/docs', 'zh', 'en'), '/zh/docs');
  assertEquals(mod.localize('/zh/docs', 'zh', 'en'), '/zh/docs');
  assertEquals(mod.localize('/docs', 'en', 'en'), '/docs');
  assertEquals(mod.localize('https://example.com/docs', 'zh', 'en'), 'https://example.com/docs');
});
