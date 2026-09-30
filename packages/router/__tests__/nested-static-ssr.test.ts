import { assertEquals } from '@std/assert';
import { createNativePageRenderer } from '../src/vite/internal/server-runtime/renderer-runtime.ts';
import { localizeShellHref } from '../src/vite/internal/server-runtime/document-runtime.ts';

Deno.test('generated SSR delegates admitted nested composition to Element', () => {
  const admitted = ['open-page-rail', 'open-article-view', 'open-reading-shell'];
  // The typed page renderer is the shipped __ssr binding; a probe renderDsd
  // records the options the compiled serializer receives.
  const calls: Array<{ tag: string; options: Record<string, unknown> }> = [];
  const ssr = createNativePageRenderer({
    renderDsd: (tag, options) => {
      calls.push({ tag, options });
      return { html: '<' + tag + '></' + tag + '>' };
    },
    customElements: { get: (tag) => ({ tag }) },
    ssrRenderableTags: admitted,
  });
  const html = ssr('guide-page', { model: { title: 'Compiled guide' } }, { route: '/guide' });

  assertEquals(html, '<guide-page></guide-page>');
  assertEquals(calls.length, 1);
  assertEquals(calls[0].tag, 'guide-page');
  assertEquals(calls[0].options.ssrRenderableTags, admitted);
  assertEquals(calls[0].options.sourceInfo, { route: '/guide' });
});

Deno.test('shell href localization keeps locale-neutral and external hrefs untouched', () => {
  assertEquals(localizeShellHref('/', 'zh', 'en'), '/zh');
  assertEquals(localizeShellHref('/docs', 'zh', 'en'), '/zh/docs');
  assertEquals(localizeShellHref('/zh/docs', 'zh', 'en'), '/zh/docs');
  assertEquals(localizeShellHref('/docs', 'en', 'en'), '/docs');
  assertEquals(
    localizeShellHref('https://example.com/docs', 'zh', 'en'),
    'https://example.com/docs',
  );
});
