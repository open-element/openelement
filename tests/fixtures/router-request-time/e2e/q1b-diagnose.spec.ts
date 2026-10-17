/**
 * Q1-B targeted diagnosis (temporary, test-side only — no product code).
 *
 * Records the real call sequence around a light island being moved in the DOM:
 * instance identity, facade lifecycle calls, head-node mutations (with owner
 * document), sheet readiness at each step, and the final computed style. Run on
 * Chromium first; extend to Firefox/WebKit only if the evidence is ambiguous.
 *
 * This file is diagnostic scaffolding: it asserts nothing about the product. It
 * exists to answer "which step first differs from the expected sequence".
 */

import { expect, test } from '@playwright/test';

const ISLAND_TAGS = ['decoupled-view', 'live-counter', 'zag-combobox-light', 'zag-combobox'];

interface Probe {
  label: string;
  lightConnected: boolean;
  sameInstance: boolean;
  nodes: number;
  nodeChars: number[];
  sheetHasReadyKey: boolean;
  sheetRules: number;
  computedRadius: string;
}

test('Q1-B diagnosis: the move sequence on Chromium', async ({ page }) => {
  const events: string[] = [];
  const allConsole: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    allConsole.push(`${message.type()}: ${text}`.slice(0, 400));
    if (text.startsWith('Q1B ')) events.push(text);
  });
  page.on('pageerror', (error) => allConsole.push(`pageerror: ${error.message}`));

  await page.addInitScript(() => {
    const log = (line: string) => console.log(`Q1B ${line} @${Math.round(performance.now())}ms`);
    (globalThis as { __q1bLog?: (line: string) => void }).__q1bLog = log;
    const owned = (node: unknown): boolean =>
      !!node &&
      (node as Node).nodeType === 1 &&
      typeof (node as Element).hasAttribute === 'function' &&
      (node as Element).hasAttribute('data-open-element-compiled-style');
    const stack = (skip = 2): string =>
      (new Error().stack ?? '')
        .split('\n')
        .slice(skip, skip + 5)
        .map((line) => line.trim().replace(/^at\s+/, ''))
        .join(' <- ');
    // Insertion / removal entry points, original behaviour preserved. The
    // overrides keep the DOM generic signatures so callers see the same
    // types the native methods expose.
    const nodeAppendChild = Node.prototype.appendChild;
    Node.prototype.appendChild = function <T extends Node>(this: Node, child: T): T {
      if (owned(child)) log(`appendChild chars=${(child.textContent ?? '').length} @ ${stack()}`);
      return nodeAppendChild.call(this, child) as T;
    };
    const nodeInsertBefore = Node.prototype.insertBefore;
    Node.prototype.insertBefore = function <T extends Node>(
      this: Node,
      child: T,
      ref: Node | null,
    ): T {
      if (owned(child)) log(`insertBefore chars=${(child.textContent ?? '').length} @ ${stack()}`);
      return nodeInsertBefore.call(this, child, ref) as T;
    };
    const nodeRemoveChild = Node.prototype.removeChild;
    Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
      if (owned(child)) log(`removeChild chars=${(child.textContent ?? '').length} @ ${stack()}`);
      return nodeRemoveChild.call(this, child) as T;
    };
    const elementRemove = Element.prototype.remove;
    Element.prototype.remove = function (this: Element) {
      if (owned(this)) log(`element.remove chars=${(this.textContent ?? '').length} @ ${stack()}`);
      return elementRemove.call(this);
    };
    // Head mutations: every owned light node creation/removal, in order.
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of [...record.addedNodes]) {
          if (owned(node)) log(`observed ADDED chars=${(node.textContent ?? '').length}`);
        }
        for (const node of [...record.removedNodes]) {
          if (owned(node)) log(`observed REMOVED chars=${(node.textContent ?? '').length}`);
        }
      }
    });
    const start = () =>
      observer.observe(document.documentElement, { childList: true, subtree: true });
    if (document.documentElement) start();
    else addEventListener('DOMContentLoaded', start);
  });

  await page.goto('/combobox', { waitUntil: 'load' });
  await page.waitForFunction(
    (tags: string[]) => tags.every((tag) => customElements.get(tag) !== undefined),
    ISLAND_TAGS,
    { timeout: 5_000 },
  );

  const probe = (label: string) =>
    page.evaluate((probeLabel: string): Probe => {
      const frame = document.querySelector('combobox-page')?.shadowRoot;
      const host = frame?.querySelector('zag-combobox-light') as HTMLElement | null;
      const nodes = [...document.querySelectorAll('style[data-open-element-compiled-style]')];
      const target = (globalThis as { __q1bHost?: unknown }).__q1bHost;
      const cls = customElements.get('zag-combobox-light') as unknown as {
        styles?: readonly { cssRules?: { length: number }; __openElementStyleReady?: unknown }[];
      };
      const sheet = cls?.styles?.[0];
      const input = frame?.querySelector('zag-combobox-light input[data-part="input"]');
      return {
        label: probeLabel,
        lightConnected: host?.isConnected ?? false,
        sameInstance: target === undefined ? false : target === host,
        nodes: nodes.length,
        nodeChars: nodes.map((node) => (node.textContent ?? '').length),
        sheetHasReadyKey: sheet ? '__openElementStyleReady' in sheet : false,
        sheetRules: sheet?.cssRules?.length ?? -1,
        computedRadius: input ? getComputedStyle(input).borderTopLeftRadius : 'no-input',
      };
    }, label);

  // Locate where the lifecycle callbacks actually live (instance own property
  // vs which prototype in the chain) and wrap every place they are found.
  await page.evaluate(() => {
    const log = (globalThis as { __q1bLog?: (line: string) => void }).__q1bLog!;
    const host = document
      .querySelector('combobox-page')
      ?.shadowRoot?.querySelector('zag-combobox-light');
    (globalThis as { __q1bHost?: unknown }).__q1bHost = host;
    const instance = host as unknown as Record<string, unknown>;
    const wrap = (target: Record<string, unknown>, key: string, where: string) => {
      const original = target[key];
      if (typeof original !== 'function') return false;
      target[key] = function (this: unknown, ...args: unknown[]) {
        log(`${where}.${key}`);
        return (original as (...a: unknown[]) => unknown).apply(this, args);
      };
      return true;
    };
    const report: string[] = [];
    report.push(
      `ownCallbackProps=[${Object.getOwnPropertyNames(instance)
        .filter((n) => n.includes('Callback'))
        .join(',')}]`,
    );
    report.push(`ownConnect=${wrap(instance, 'connectedCallback', 'instance')}`);
    report.push(`ownDisconnect=${wrap(instance, 'disconnectedCallback', 'instance')}`);
    let level = 0;
    let proto: object | null = Object.getPrototypeOf(instance);
    while (proto) {
      const names = Object.getOwnPropertyNames(proto).filter((n) => n.includes('Callback'));
      report.push(`proto${level}=${proto.constructor?.name ?? '?'} has=[${names.join(',')}]`);
      wrap(proto as Record<string, unknown>, 'connectedCallback', `proto${level}`);
      wrap(proto as Record<string, unknown>, 'disconnectedCallback', `proto${level}`);
      proto = Object.getPrototypeOf(proto);
      level += 1;
      if (level > 6) break;
    }
    log(`wrapped: ${report.join(' | ')}`);
  });

  const before = await probe('before-move');
  const sheetBeforeReady = await page.evaluate(async () => {
    const cls = customElements.get('zag-combobox-light') as unknown as {
      styles?: readonly { __openElementStyleReady?: Promise<unknown> }[];
    };
    const ready = cls?.styles?.[0]?.__openElementStyleReady;
    if (!ready) return 'no-ready-key';
    let state = 'pending';
    await Promise.race([
      ready.then(
        () => {
          state = 'fulfilled';
        },
        () => {
          state = 'rejected';
        },
      ),
      new Promise((resolve) => setTimeout(resolve, 1_000)),
    ]);
    return state;
  });

  const moved = await page.evaluate(() => {
    const log = (globalThis as { __q1bLog?: (line: string) => void }).__q1bLog!;
    const frame = document.querySelector('combobox-page')?.shadowRoot;
    const host = frame?.querySelector('zag-combobox-light') as HTMLElement | null;
    if (!host || !frame) return false;
    const parent = host.parentNode as ParentNode;
    log('move: remove() start');
    host.remove();
    log('move: remove() done');
    log('move: appendChild() start');
    parent.appendChild(host);
    log('move: appendChild() done');
    return true;
  });
  expect(moved, 'fixture must expose the light island').toBe(true);

  const immediately = await probe('immediately-after-move');
  await page.waitForTimeout(300);
  const after300 = await probe('after-300ms');
  // Bounded wait for the sheet to settle through the shadow island's fallback.
  await page.evaluate(async () => {
    const deadline = performance.now() + 5_000;
    for (;;) {
      const frame = document.querySelector('combobox-page')?.shadowRoot;
      const host = frame?.querySelector('zag-combobox[machine-id="shadow-a"]');
      const first = host?.shadowRoot?.firstChild;
      const fallback =
        !!first && first.nodeType === 1 && (first as Element).hasAttribute('data-oe-static-styles');
      if (!fallback || performance.now() > deadline) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  });
  const settled = await probe('after-sheet-settled');

  const headNodeCount = await page.evaluate(
    () => document.querySelectorAll('style[data-open-element-compiled-style]').length,
  );

  console.log(
    'Q1B REPORT ' +
      JSON.stringify(
        {
          events,
          reconnectError: allConsole.filter(
            (line) => !line.startsWith('log: Q1B') && !line.includes('Download the React'),
          ),
          sheetBeforeReady,
          before,
          immediately,
          after300,
          settled,
          headNodeCount,
        },
        null,
        2,
      ),
  );
});
