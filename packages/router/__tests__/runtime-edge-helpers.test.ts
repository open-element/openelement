import { assertEquals } from '@std/assert';
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
  constructor(public nodeType: number, public childNodes: FakeNode[] = []) {}
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

Deno.test('island lifecycle compares normalized light DOM and keeps the scheduler hook', () => {
  let observed = 0;
  const lifecycle = createIslandLifecycle({ observeVisible: () => observed++ });
  lifecycle.observeVisible();
  assertEquals(observed, 1);

  const template = new FakeElement('TEMPLATE', { shadowrootmode: 'open' });
  const oldTree = new FakeElement('X-ISLAND', { mode: 'ready' }, [
    new FakeText('  '),
    new FakeElement('SPAN', { title: 'same' }, [new FakeText('value')]),
  ]);
  const newTree = new FakeElement('X-ISLAND', { mode: 'ready' }, [
    template,
    new FakeElement('SPAN', { title: 'same' }, [new FakeText('value')]),
  ]);
  assertEquals(
    lifecycle.islandIntact(oldTree as unknown as Element, newTree as unknown as Element),
    true,
  );

  oldTree.shadowRoot = null;
  assertEquals(
    lifecycle.islandIntact(oldTree as unknown as Element, newTree as unknown as Element),
    false,
  );
  oldTree.shadowRoot = {};

  const changedAttr = new FakeElement('X-ISLAND', { mode: 'changed' }, newTree.childNodes);
  assertEquals(
    lifecycle.islandIntact(oldTree as unknown as Element, changedAttr as unknown as Element),
    false,
  );
  const changedText = new FakeElement('X-ISLAND', { mode: 'ready' }, [
    new FakeElement('SPAN', { title: 'same' }, [new FakeText('changed')]),
  ]);
  assertEquals(
    lifecycle.islandIntact(oldTree as unknown as Element, changedText as unknown as Element),
    false,
  );
  const changedTag = new FakeElement('X-ISLAND', { mode: 'ready' }, [
    new FakeElement('STRONG', { title: 'same' }, [new FakeText('value')]),
  ]);
  assertEquals(
    lifecycle.islandIntact(oldTree as unknown as Element, changedTag as unknown as Element),
    false,
  );
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

Deno.test('focus restore follows shadow focus and restores a same-id replacement selection', () => {
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
  assertEquals(calls, ['replacement', [2, 5]]);

  // A connected original is preferred, and a surviving focused node is a no-op.
  original.isConnected = true;
  doc.activeElement = host;
  const connected = focus.captureFocus();
  doc.activeElement = body;
  focus.restoreFocus(connected);
  assertEquals(calls.at(-1), 'original');
  doc.activeElement = host;
  focus.restoreFocus(connected);
  focus.restoreFocus(null);
  doc.activeElement = body;
  assertEquals(focus.captureFocus(), null);
});

Deno.test('WebKit morph helpers instantiate nested DSD and repair skipped custom elements', () => {
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
      get: (tag: string) => tag === 'third-party-wc' ? ExpectedElement : undefined,
    },
  };
  const webkit = createMorphWebkitFix({ win: win as unknown as Window & typeof globalThis });

  webkit.instantiateDsd({ nodeType: 3 } as Node, created as ShadowRoot[]);
  webkit.instantiateDsd(fragment as unknown as Node, created as ShadowRoot[]);
  assertEquals(shadowRoot.appended, [template.content]);
  assertEquals(created.includes('removed'), true);
  webkit.repairShadowUpgrades([root as unknown as ShadowRoot]);
  assertEquals(repaired, ['removed', [skipped, 'next']]);
});

Deno.test('SSR artifact cleanup removes server-only chunks and preserves client assets', async () => {
  const root = await Deno.makeTempDir({ prefix: 'oe-clean-ssr-' });
  try {
    const assets = join(root, 'dist', 'assets');
    await Deno.mkdir(assets, { recursive: true });
    const removed = [
      '_virtual_open-hono-entry-abc.js',
      '_virtual_open-hono-entry-abc.js.map',
      'src-server-abc.js',
    ];
    const kept = ['src-client-abc.js', 'app.js'];
    for (const file of [...removed, ...kept]) await Deno.writeTextFile(join(assets, file), file);
    await cleanSsrArtifacts({
      phase3: { root, outDir: 'dist', base: '/', upgradeStrategy: 'idle' },
      phase1: { islandTagNames: [], packageIslandDecls: [], islandMeta: {} },
    });
    for (const file of removed) {
      assertEquals(await Deno.stat(join(assets, file)).then(() => true).catch(() => false), false);
    }
    for (const file of kept) assertEquals((await Deno.stat(join(assets, file))).isFile, true);

    await cleanSsrArtifacts({
      phase3: { root, outDir: 'missing', base: '/', upgradeStrategy: 'idle' },
      phase1: { islandTagNames: [], packageIslandDecls: [], islandMeta: {} },
    });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('client-island postprocess handles a static page with no islands', async () => {
  const root = await Deno.makeTempDir({ prefix: 'oe-postprocess-' });
  try {
    const dist = join(root, 'dist');
    await Deno.mkdir(dist, { recursive: true });
    await Deno.writeTextFile(
      join(dist, 'index.html'),
      '<!doctype html><html><body>static</body></html>',
    );
    await postProcessClientIslandBuild(
      {
        phase3: { root, outDir: 'dist', base: '/', upgradeStrategy: 'idle' },
        phase1: { islandTagNames: [], packageIslandDecls: [], islandMeta: {} },
      },
      '/client/islands/client.js',
    );
    const html = await Deno.readTextFile(join(dist, 'index.html'));
    assertEquals(html.includes('/client/islands/client.js'), true);
    const manifestDir = join(dist, 'island-manifests');
    const [manifestFile] = [...Deno.readDirSync(manifestDir)].map((entry) => entry.name);
    const manifest = JSON.parse(await Deno.readTextFile(join(manifestDir, manifestFile)));
    assertEquals(manifest.islands, []);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
