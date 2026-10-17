import { expect, test } from 'vitest';
import { createNativePageRenderer } from '../src/vite/internal/server-runtime/renderer-runtime.ts';
import { localizeLayoutHref } from '../src/vite/internal/server-runtime/document-runtime.ts';

test('generated SSR delegates admitted nested composition to Element', () => {
  const admitted = ['open-page-rail', 'open-article-view', 'open-reading-shell'];
  // The typed page renderer is the shipped __ssr binding; a probe renderToString
  // records the options the compiled serializer receives.
  const calls: Array<{ tag: string; options: Record<string, unknown> }> = [];
  const ssr = createNativePageRenderer({
    renderToString: (tag, options) => {
      calls.push({ tag, options });
      return '<' + tag + '></' + tag + '>';
    },
    customElements: { get: (tag) => ({ tag }) },
    ssrRenderableTags: admitted,
  });
  const html = ssr('guide-page', { model: { title: 'Compiled guide' } }, { route: '/guide' });

  expect(html).toEqual('<guide-page></guide-page>');
  expect(calls.length).toEqual(1);
  expect(calls[0].tag).toEqual('guide-page');
  expect(calls[0].options.ssrRenderableTags).toEqual(admitted);
  expect(calls[0].options.sourceInfo).toEqual({ route: '/guide' });
});

test('layout href localization keeps locale-neutral and external hrefs untouched', () => {
  expect(localizeLayoutHref('/', 'zh', 'en')).toEqual('/zh');
  expect(localizeLayoutHref('/docs', 'zh', 'en')).toEqual('/zh/docs');
  expect(localizeLayoutHref('/zh/docs', 'zh', 'en')).toEqual('/zh/docs');
  expect(localizeLayoutHref('/docs', 'en', 'en')).toEqual('/docs');
  expect(localizeLayoutHref('https://example.com/docs', 'zh', 'en')).toEqual(
    'https://example.com/docs',
  );
});
