/**
 * The shadow walkers are serialized with Function.prototype.toString() and run
 * inside a page, so they only ever touch `querySelector`, `querySelectorAll`,
 * `matches` and `shadowRoot`. That narrow surface is what this test fakes: it
 * pins traversal order and open-shadow-root piercing without a browser.
 */
import { assertEquals } from '@std/assert';
import { deepQueryAllInPage, deepQueryFirstInPage } from './shadow-walker.ts';

class FakeNode {
  children: FakeNode[] = [];
  shadowRoot: FakeNode | null = null;

  constructor(readonly selector: string, readonly id = '') {}

  with(...children: FakeNode[]): this {
    this.children = children;
    return this;
  }

  shadows(shadow: FakeNode): this {
    this.shadowRoot = shadow;
    return this;
  }

  matches(selector: string): boolean {
    if (selector === '*') return true;
    return selector.startsWith('#') ? this.id === selector.slice(1) : this.selector === selector;
  }

  /** Direct children only — the walkers combine this with a `'*'` sweep. */
  querySelector(selector: string): FakeNode | null {
    for (const child of this.children) {
      if (child.matches(selector)) return child;
    }
    return null;
  }

  querySelectorAll(selector: string): FakeNode[] {
    const found: FakeNode[] = [];
    const visit = (node: FakeNode): void => {
      for (const child of node.children) {
        if (child.matches(selector)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }

  asRoot(): Document {
    return this as unknown as Document;
  }
}

const inner = new FakeNode('open-button', 'inner');
const host = new FakeNode('open-card', 'host').shadows(new FakeNode('#shadow').with(inner));
const light = new FakeNode('open-input', 'light');
const page = new FakeNode('#document').with(host, light);

Deno.test('deepQueryFirstInPage returns a light-DOM match', () => {
  const found = deepQueryFirstInPage(page.asRoot(), 'open-input');
  assertEquals((found as unknown as FakeNode | null)?.id, 'light');
});

Deno.test('deepQueryFirstInPage pierces an open shadow root', () => {
  const found = deepQueryFirstInPage(page.asRoot(), '#inner');
  assertEquals((found as unknown as FakeNode | null)?.id, 'inner');
});

Deno.test('deepQueryFirstInPage returns null when nothing matches', () => {
  assertEquals(deepQueryFirstInPage(page.asRoot(), '#absent'), null);
});

Deno.test('deepQueryAllInPage filters a light-DOM selector', () => {
  const found = deepQueryAllInPage(page.asRoot(), 'open-input');
  assertEquals((found as unknown as FakeNode[]).map((node) => node.id), ['light']);
});

Deno.test('deepQueryAllInPage sweeps shadow content in document order', () => {
  const found = deepQueryAllInPage(page.asRoot(), '*');
  assertEquals((found as unknown as FakeNode[]).map((node) => node.id), [
    'host',
    'inner',
    'light',
  ]);
});
