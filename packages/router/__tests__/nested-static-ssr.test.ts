import { expect, test } from 'vitest';
import { createNativePageRenderer } from '../src/vite/internal/server-runtime/renderer-runtime.ts';
import { localizeShellHref } from '../src/vite/internal/server-runtime/document-runtime.ts';

test('generated SSR delegates admitted nested composition to Element', () => {
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

  expect(html).toEqual('<guide-page></guide-page>');
  expect(calls.length).toEqual(1);
  expect(calls[0].tag).toEqual('guide-page');
  expect(calls[0].options.ssrRenderableTags).toEqual(admitted);
  expect(calls[0].options.sourceInfo).toEqual({ route: '/guide' });
});

test('shell href localization keeps locale-neutral and external hrefs untouched', () => {
  expect(localizeShellHref('/', 'zh', 'en')).toEqual('/zh');
  expect(localizeShellHref('/docs', 'zh', 'en')).toEqual('/zh/docs');
  expect(localizeShellHref('/zh/docs', 'zh', 'en')).toEqual('/zh/docs');
  expect(localizeShellHref('/docs', 'en', 'en')).toEqual('/docs');
  expect(localizeShellHref('https://example.com/docs', 'zh', 'en')).toEqual(
    'https://example.com/docs',
  );
});
