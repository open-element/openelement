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

test('only documents loading the production bootstrap receive its dependency hints', () => {
  const entry = '/sub/client/client.js';
  const dependency = '/sub/client/dependency.js';
  const host = '<my-counter></my-counter>';
  const app = makeApp();
  app.setRequestTimeClientScript(entry, ['my-counter'], [dependency]);
  expect(app.clientDocumentResources(host)).toEqual({
    scripts: [{ type: 'module', src: entry }],
    entryPreloads: [dependency],
  });
  expect(app.clientDocumentResources('<p>Static response</p>')).toEqual({ scripts: [] });
  app.setRequestTimeClientScript(entry, ['my-counter']);
  expect(app.clientDocumentResources(host)).toEqual({ scripts: [{ type: 'module', src: entry }] });

  const dev = makeApp('/sub/client/dev.js');
  dev.setRequestTimeClientScript(entry, ['my-counter'], [dependency]);
  expect(dev.clientDocumentResources(host)).toEqual({
    scripts: [{ type: 'module', src: '/sub/client/dev.js' }],
  });
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
    '<a href="&#31;&#9;java&#115cript&colon;add()">Add</a>',
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
  // An absolute frame URL is not provably cross-origin without the document
  // URL, so the frame keeps the client bootstrap (fail closed).
  expect(app.clientScriptDescriptors(external)).not.toEqual([]);
  for (const html of [
    ordinary,
    escaped,
    sandboxed,
    '<a href="/help#javascript:">Help</a>',
    '<a href="javascript://[">Invalid navigation URL</a>',
    '<a href="data:text/plain,Reference">Reference document</a>',
    '<iframe src="data:text/plain,Reference"></iframe>',
    '<a href="vbscript:">Legacy protocol</a>',
    '<button is="native-button">More</button>',
  ]) {
    expect(app.clientScriptDescriptors(html)).toEqual([]);
  }
});

test('script-capable embedded documents retain the client bootstrap', () => {
  const app = makeApp('/client/islands/client.js');
  expect(app.clientScriptDescriptors('<p>A static route</p>')).toEqual([]);
  expect(
    app.clientScriptDescriptors('<p>Initial markup</p>', '<iframe src="/embedded"></iframe>'),
  ).toHaveLength(1);
  for (const html of [
    // A frame without `sandbox` can load a same-origin document whose script
    // reaches this document, and a relative URL is same-origin unless <base>
    // overrides it.
    '<iframe src="/embedded"></iframe>',
    '<iframe></iframe>',
    '<iframe srcdoc="<p>Embedded</p>"></iframe>',
    '<iframe srcdoc="&lt;script&gt;mount()&lt;/script&gt;"></iframe>',
    // `srcdoc` wins over `src` (HTML spec): a data: src proves nothing about
    // the srcdoc document, which is same-origin and can run authored script.
    '<iframe srcdoc="<script>mount()</script>" src="data:text/html,<p>Embedded</p>"></iframe>',
    '<iframe src="&#100;ata:text/html,<p>Embedded</p>" srcdoc="<script>mount()</script>"></iframe>',
    // An absolute URL is not provably cross-origin without the document URL.
    '<iframe src="https://embedded.example.test/frame"></iframe>',
    '<iframe src="//embedded.example.test/frame"></iframe>',
    // allow-scripts + allow-same-origin makes the sandbox removable.
    '<iframe sandbox="allow-scripts allow-same-origin" src="/embedded"></iframe>',
    '<iframe sandbox="ALLOW-SCRIPTS ALLOW-SAME-ORIGIN" srcdoc="<p>Embedded</p>"></iframe>',
    // An entity can spell the token separator, so a sandbox is not provable.
    '<iframe sandbox="allow-scripts&#32;allow-same-origin" src="/embedded"></iframe>',
    // The escapable sandbox keeps the bootstrap even over an opaque data:
    // document: the frame can navigate itself to a same-origin page.
    '<iframe sandbox="allow-scripts allow-same-origin" src="data:text/html,<p>Reference</p>"></iframe>',
    // Browsers implement `sandbox` for iframe only: object/embed ignore it.
    '<object data="/embedded.html"></object>',
    '<object sandbox data="/embedded.html"></object>',
    '<embed src="/embedded.html">',
  ]) {
    expect(app.clientScriptDescriptors(html)).toHaveLength(1);
  }
});

test('provably isolated embedded documents stay zero-JS', () => {
  const app = makeApp('/client/islands/client.js');
  expect(app.clientScriptDescriptors('<p>A static route</p>')).toEqual([]);
  for (const html of [
    // No script, or an opaque origin that cannot reach this document.
    '<iframe sandbox src="/embedded"></iframe>',
    '<iframe sandbox="allow-same-origin" src="/embedded"></iframe>',
    '<iframe sandbox="allow-scripts" src="/embedded"></iframe>',
    '<iframe sandbox srcdoc="<script>mount()</script>"></iframe>',
    '<iframe sandbox="allow-scripts" srcdoc="<p>Widget</p>"></iframe>',
    // The sandbox still wins over srcdoc when `src` is a data: document.
    '<iframe sandbox srcdoc="<script>mount()</script>" src="data:text/html,<p>Embedded</p>"></iframe>',
    '<iframe sandbox="allow-scripts" srcdoc="<script>mount()</script>" src="data:text/html,<p>Embedded</p>"></iframe>',
    // A javascript: navigation is isolated by the sandbox too.
    '<iframe sandbox="allow-scripts allow-forms" src="javascript:mount()"></iframe>',
    // A data: document is an opaque origin, so its own script cannot reach
    // this document. Isolation is initial-document only: a parent form/link
    // with `target` (or the frame navigating itself) can later load a
    // same-origin page whose script reaches the parent. Recorded residual
    // (round2-review R2-2); the static decision cannot see that navigation.
    '<iframe src="data:text/html,<p>Reference</p>"></iframe>',
    '<iframe src="DATA:text/html,<p>Reference</p>"></iframe>',
    '<iframe src="&#100;ata:text/html,<p>Reference</p>"></iframe>',
    '<object data="data:text/html,<p>Reference</p>"></object>',
    '<embed src="data:text/html,<p>Reference</p>">',
  ]) {
    expect(app.clientScriptDescriptors(html)).toEqual([]);
  }
});
