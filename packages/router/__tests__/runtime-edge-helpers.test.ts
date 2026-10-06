import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
import { readdirSync } from 'node:fs';
import {
  cleanSsrArtifacts,
  postProcessClientIslandBuild,
} from '../src/vite/internal/ssg/build-postprocess.ts';
import { createIslandLifecycle } from '../src/vite/internal/ssg/island-lifecycle.ts';
import { createMorphFocusRestore } from '../src/vite/internal/ssg/morph-focus-restore.ts';
import { createMorphWebkitFix } from '../src/vite/internal/ssg/morph-webkit-fix.ts';
import { join } from 'node:path';

interface FakeAttr {
  name: string;
  value: string;
}

class FakeNode {
  constructor(
    public nodeType: number,
    public childNodes: FakeNode[] = [],
  ) {}
}

class FakeText extends FakeNode {
  constructor(public data: string) {
    super(3);
  }
}

class FakeElement extends FakeNode {
  shadowRoot: object | null = {};
  attributes: FakeAttr[];
  constructor(
    public tagName: string,
    attrs: Record<string, string> = {},
    children: FakeNode[] = [],
  ) {
    super(1, children);
    this.attributes = Object.entries(attrs).map(([name, value]) => ({ name, value }));
  }
  getAttribute(name: string): string | null {
    return this.attributes.find((attribute) => attribute.name === name)?.value ?? null;
  }
  hasAttribute(name: string): boolean {
    return this.attributes.some((attribute) => attribute.name === name);
  }
}

test('island lifecycle compares normalized light DOM and keeps the scheduler hook', () => {
  let observed = 0;
  const lifecycle = createIslandLifecycle({ observeVisible: () => observed++ });
  lifecycle.observeVisible();
  expect(observed).toEqual(1);

  const template = new FakeElement('TEMPLATE', { shadowrootmode: 'open' });
  const oldTree = new FakeElement('X-ISLAND', { mode: 'ready' }, [
    new FakeText('  '),
    new FakeElement('SPAN', { title: 'same' }, [new FakeText('value')]),
  ]);
  const newTree = new FakeElement('X-ISLAND', { mode: 'ready' }, [
    template,
    new FakeElement('SPAN', { title: 'same' }, [new FakeText('value')]),
  ]);
  expect(
    lifecycle.islandIntact(oldTree as unknown as Element, newTree as unknown as Element),
  ).toEqual(true);

  oldTree.shadowRoot = null;
  expect(
    lifecycle.islandIntact(oldTree as unknown as Element, newTree as unknown as Element),
  ).toEqual(false);
  oldTree.shadowRoot = {};

  const changedAttr = new FakeElement('X-ISLAND', { mode: 'changed' }, newTree.childNodes);
  expect(
    lifecycle.islandIntact(oldTree as unknown as Element, changedAttr as unknown as Element),
  ).toEqual(false);
  const changedText = new FakeElement('X-ISLAND', { mode: 'ready' }, [
    new FakeElement('SPAN', { title: 'same' }, [new FakeText('changed')]),
  ]);
  expect(
    lifecycle.islandIntact(oldTree as unknown as Element, changedText as unknown as Element),
  ).toEqual(false);
  const changedTag = new FakeElement('X-ISLAND', { mode: 'ready' }, [
    new FakeElement('STRONG', { title: 'same' }, [new FakeText('value')]),
  ]);
  expect(
    lifecycle.islandIntact(oldTree as unknown as Element, changedTag as unknown as Element),
  ).toEqual(false);
});

interface FocusElement {
  id: string;
  isConnected: boolean;
  shadowRoot?: { activeElement: FocusElement | null } | null;
  selectionStart?: number | null;
  selectionEnd?: number | null;
  focus(): void;
  setSelectionRange?(start: number, end: number): void;
}

test('focus restore follows shadow focus and restores a same-id replacement selection', () => {
  const calls: unknown[] = [];
  const body: FocusElement = { id: '', isConnected: true, focus() {} };
  const original: FocusElement = {
    id: 'email',
    isConnected: false,
    selectionStart: 2,
    selectionEnd: 5,
    focus: () => calls.push('original'),
  };
  const host: FocusElement = {
    id: 'host',
    isConnected: true,
    shadowRoot: { activeElement: original },
    focus() {},
  };
  const replacement: FocusElement = {
    id: 'email',
    isConnected: true,
    focus: () => calls.push('replacement'),
    setSelectionRange: (start, end) => calls.push([start, end]),
  };
  const nestedHost: FocusElement = {
    id: 'nested',
    isConnected: true,
    shadowRoot: null,
    focus() {},
  };
  const doc = {
    activeElement: host,
    body,
    querySelectorAll: () => [nestedHost],
  };
  const nestedRoot = { querySelectorAll: () => [replacement] };
  nestedHost.shadowRoot = { activeElement: null };
  Object.assign(nestedHost.shadowRoot, nestedRoot);

  const focus = createMorphFocusRestore({ doc: doc as unknown as Document });
  const snapshot = focus.captureFocus();
  doc.activeElement = body;
  focus.restoreFocus(snapshot);
  expect(calls).toEqual(['replacement', [2, 5]]);

  // A connected original is preferred, and a surviving focused node is a no-op.
  original.isConnected = true;
  doc.activeElement = host;
  const connected = focus.captureFocus();
  doc.activeElement = body;
  focus.restoreFocus(connected);
  expect(calls.at(-1)).toEqual('original');
  doc.activeElement = host;
  focus.restoreFocus(connected);
  focus.restoreFocus(null);
  doc.activeElement = body;
  expect(focus.captureFocus()).toEqual(null);
});

test('WebKit morph helpers instantiate nested DSD and repair skipped custom elements', () => {
  const created: unknown[] = [];
  const shadowRoot = {
    nodeType: 11,
    appended: [] as unknown[],
    appendChild(node: unknown) {
      this.appended.push(node);
    },
    querySelectorAll: () => [],
  };
  const host = {
    shadowRoot: null as unknown,
    attachShadow: () => {
      host.shadowRoot = shadowRoot;
      created.push(shadowRoot);
      return shadowRoot;
    },
  };
  const template = {
    parentNode: host,
    content: { nodeType: 11 },
    getAttribute: () => 'open',
    remove: () => created.push('removed'),
  };
  const fragment = { nodeType: 11, querySelectorAll: () => [template] };

  class ExpectedElement {}
  const repaired: unknown[] = [];
  const parent = { insertBefore: (node: unknown, next: unknown) => repaired.push([node, next]) };
  const skipped = {
    localName: 'third-party-wc',
    parentNode: parent,
    nextSibling: 'next',
    remove: () => repaired.push('removed'),
  };
  const ordinary = { localName: 'div', parentNode: parent };
  const root = { querySelectorAll: () => [skipped, ordinary] };
  const win = {
    customElements: {
      get: (tag: string) => (tag === 'third-party-wc' ? ExpectedElement : undefined),
    },
  };
  const webkit = createMorphWebkitFix({ win: win as unknown as Window & typeof globalThis });

  webkit.instantiateDsd({ nodeType: 3 } as Node, created as ShadowRoot[]);
  webkit.instantiateDsd(fragment as unknown as Node, created as ShadowRoot[]);
  expect(shadowRoot.appended).toEqual([template.content]);
  expect(created.includes('removed')).toEqual(true);
  webkit.repairShadowUpgrades([root as unknown as ShadowRoot]);
  expect(repaired).toEqual(['removed', [skipped, 'next']]);
});

test('SSR artifact cleanup removes server-only chunks and preserves client assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-clean-ssr-'));
  try {
    const assets = join(root, 'dist', 'assets');
    await mkdir(assets, { recursive: true });
    const removed = [
      '_virtual_open-hono-entry-abc.js',
      '_virtual_open-hono-entry-abc.js.map',
      'src-server-abc.js',
    ];
    const kept = ['src-client-abc.js', 'app.js'];
    for (const file of [...removed, ...kept]) await writeFile(join(assets, file), file);
    await cleanSsrArtifacts({
      phase3: { root, outDir: 'dist', base: '/', upgradeStrategy: 'idle' },
      phase1: { islandTagNames: [], packageIslandDecls: [], islandMeta: {} },
    });
    for (const file of removed) {
      expect(
        await stat(join(assets, file))
          .then(() => true)
          .catch(() => false),
      ).toEqual(false);
    }
    for (const file of kept) expect((await stat(join(assets, file))).isFile()).toEqual(true);

    await cleanSsrArtifacts({
      phase3: { root, outDir: 'missing', base: '/', upgradeStrategy: 'idle' },
      phase1: { islandTagNames: [], packageIslandDecls: [], islandMeta: {} },
    });
  } finally {
    await rm(root, { recursive: true });
  }
});

test('client-island postprocess handles a static page with no islands', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-postprocess-'));
  try {
    const dist = join(root, 'dist');
    await mkdir(dist, { recursive: true });
    await writeFile(join(dist, 'index.html'), '<!doctype html><html><body>static</body></html>');
    await postProcessClientIslandBuild({
      phase3: { root, outDir: 'dist', base: '/', upgradeStrategy: 'idle' },
      phase1: { islandTagNames: [], packageIslandDecls: [], islandMeta: {} },
      // A static page with no islands: the manifest carries an entry only
      // (Phase 2 ran for enhanced forms) or nothing at all.
      clientAssetManifest: {
        entry: '/client/islands/client.js',
        islands: {},
        shared: [],
        styles: [],
      },
    });
    // #1471/S4b: no post-build script surgery — the document renderer
    // embedded the script tags at render time, so the pass leaves the HTML
    // byte-identical and only records the per-page island manifests.
    const html = await readFile(join(dist, 'index.html'), 'utf8');
    expect(html.includes('/client/islands/client.js')).toEqual(false);
    expect(html).toEqual('<!doctype html><html><body>static</body></html>');
    const manifestDir = join(dist, 'island-manifests');
    const [manifestFile] = readdirSync(manifestDir, { withFileTypes: true }).map(
      (entry) => entry.name,
    );
    const manifest = JSON.parse(await readFile(join(manifestDir, manifestFile), 'utf8'));
    expect(manifest.islands).toEqual([]);
  } finally {
    await rm(root, { recursive: true });
  }
});
