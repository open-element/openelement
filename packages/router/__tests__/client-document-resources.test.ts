import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createGeneratedApp } from '../src/vite/internal/server-runtime/app.ts';
import { closedIslandSource } from '../src/vite/internal/ssg/document-island-source.ts';
import { extractCustomElementTags } from '../src/vite/internal/ssg/island-manifest.ts';

beforeEach(() => {
  const definitions = new Map<string, unknown>();
  vi.stubGlobal('customElements', {
    define: (name: string, constructor: unknown) => definitions.set(name, constructor),
    get: (name: string) => definitions.get(name),
  });
});

afterEach(() => vi.unstubAllGlobals());

function makeApp(devClientScriptSrc: string | null = null) {
  return createGeneratedApp({
    islands: { 'my-counter': '/counter.tsx', 'server-badge': '/badge.tsx' },
    clientIslandTags: ['my-counter'],
    layoutPlan: { default: false, layouts: {} },
    locales: [],
    navSections: [],
    headerNav: [],
    defaultLocale: 'en',
    devClientScriptSrc,
    pageHandlerPaths: [],
  });
}

test('dev, prerender and request-time descriptors follow the wrapped document', () => {
  for (const devUrl of ['/nested/client/islands/client.js', null]) {
    const app = makeApp(devUrl);
    const cdnUrl = 'https://assets.example.test/sub/client/islands/client.js';
    app.setRequestTimeClientScript(cdnUrl, ['my-counter']);
    const src = devUrl ?? cdnUrl;
    const present = [{ type: 'module', src }];
    const layout = '<main><p>Page copy</p></main><my-counter></my-counter>';
    expect(app.clientScriptDescriptors(layout)).toEqual(present);
    expect(app.clientScriptDescriptors('<form DATA-OPEN-ENHANCE></form>')).toEqual(present);
    expect(app.clientScriptDescriptors('<form data-label="data-open-enhance"></form>')).toEqual([]);
    expect(app.clientScriptDescriptors('<p>A static route</p><server-badge/>')).toEqual([]);
    expect(app.clientScriptDescriptors('<foreign-widget></foreign-widget>')).toEqual([]);
    expect(app.clientScriptDescriptors()).toEqual(present);
  }
});

test('non-executing markup and inert template content do not imply a client capability', () => {
  const app = makeApp('/client/islands/client.js');
  const html = [
    '<!-- <my-counter> -->',
    '<p title="> <my-counter>">A static route</p>',
    '<template><template shadowrootmode="open"><my-counter></my-counter></template></template>',
    '<textarea><my-counter></textarea>',
    '<script type="application/ld+json">{"label":"<my-counter>"}</script>',
  ].join('');
  expect(app.clientScriptDescriptors(html)).toEqual([]);
  expect(extractCustomElementTags(html)).toEqual([]);
});

test('open DSD fragment targets and nested delivered hosts keep their capabilities', () => {
  const app = makeApp('/client/islands/client.js');
  const shell = (mode: string, body: string) =>
    `<static-shell><template shadowrootmode="${mode}">${body}</template></static-shell>`;
  expect(app.clientScriptDescriptors(shell('open', '<span>Copy</span>'))).toEqual([]);
  expect(app.clientScriptDescriptors(shell('closed', '<span id="target">Copy</span>'))).toEqual([]);
  expect(app.clientScriptDescriptors(shell('open', '<span id="target">Copy</span>'))).toHaveLength(
    1,
  );
  expect(
    app.clientScriptDescriptors(shell('&#111;pen', '<span id="target">Copy</span>')),
  ).toHaveLength(1);
  const nested = shell('&#111;pen', '<my-counter></my-counter>');
  expect(app.clientScriptDescriptors(nested)).toHaveLength(1);
  expect(extractCustomElementTags(nested)).toEqual(['static-shell', 'my-counter']);
});

test('authored code that can introduce a host retains the existing bootstrap', () => {
  const app = makeApp('/client/islands/client.js');
  const html = '<p>Initial markup</p>';
  expect(
    app.clientScriptDescriptors(html, '<script type="module" src="/app.js"></script>'),
  ).toHaveLength(1);
  expect(app.clientScriptDescriptors('<button onclick="addCounter()">Add</button>')).toHaveLength(
    1,
  );
  expect(app.clientScriptDescriptors(html, '<script type="speculationrules">{}</script>')).toEqual(
    [],
  );
  expect(app.clientScriptDescriptors('<p title="incomplete')).toHaveLength(1);
});

test('primitive generated state proves literal children while an opaque callback retains fallback', () => {
  const source = `
    import { signal as state } from '@openelement/element';
    export default function Parent() {
      const show = state(false);
      return <main>
        <button onClick={() => (show.value = true)}>Show</button>
        {show.value ? <future-counter /> : null}
      </main>;
    }
  `;
  expect(closedIslandSource(source, 'parent.tsx')).toEqual(['future-counter']);
  expect(
    closedIslandSource(
      source.replace('() => (show.value = true)', '() => globalThis.setTimeout("mountHost()", 1)'),
      'parent.tsx',
    ),
  ).toBeUndefined();
  expect(
    closedIslandSource(
      source.replace('() => (show.value = true)', '(show) => (show.value = true)'),
      'parent.tsx',
    ),
  ).toBeUndefined();
  expect(
    closedIslandSource(
      source.replace('() => (show.value = true)', '() => (opaque.value = true)'),
      'parent.tsx',
    ),
  ).toBeUndefined();
});

test('trusted JavaScript navigation carries late activations even before the first host', () => {
  const app = makeApp();
  const file = '/client/activate.js';
  const islands = {
    'my-counter': { file, strategy: 'load', activation: { file, children: [] } },
    'future-counter': { file, strategy: 'load', activation: { file, children: [] } },
  } as const;
  app.setRequestTimeClientScript('/client/client.js', islands);
  const host = '<my-counter></my-counter>';
  const rows = (html: string) => JSON.parse(app.clientScriptDescriptors(html)[0]!.code!);
  expect(rows(host)).toEqual([['my-counter', 'load', file]]);
  for (const link of [
    '<a href="javascript:add()">Add</a>',
    '<a href="&#9;java&#115cript&colon;add()">Add</a>',
    '<a href="java&Tab;script&#58;add()">Add</a>',
  ]) {
    expect(rows(link)).toHaveLength(2);
  }
  const ordinary = '<a href="/article?lang=en&amp;page=2">Read</a>';
  const escaped = '<a href="java&amp;#115;cript&colon;add()">Read</a>';
  const sandboxed = '<iframe sandbox src="javascript:add()"></iframe>';
  const external = '<iframe src="https://example.test/frame"></iframe>';
  expect(rows(host + ordinary)).toEqual([['my-counter', 'load', file]]);
  expect(rows(host + external)).toHaveLength(2);
  for (const html of [
    ordinary,
    escaped,
    sandboxed,
    external,
    '<button is="native-button">More</button>',
  ]) {
    expect(app.clientScriptDescriptors(html)).toEqual([]);
  }
});
