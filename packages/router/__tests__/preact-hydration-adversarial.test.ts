/**
 * @openelement/router — adversarial Preact hydration lifecycle tests (#1146,
 * area 2), rebased onto the v0.44 foreign-element bridge (ADR-0143).
 *
 * The v0.44 island hydrates its host's LIGHT-DOM children (there is no DSD
 * shadow root): connectedCallback() hydrates when the host carries
 * prerendered content and the island is ssr-enabled, otherwise renders fresh.
 * These cases attack the gaps around connectedCallback()/hydrate()/ownership:
 *   2a. First hydration over a light host pre-populated with real SSR
 *       children must bind the existing tree (no duplication/replacement),
 *       flow attribute and options props, and keep teardown exactly-once.
 *   2b. hydrate → update → real detach → reconnect must keep a single tree,
 *       a single mount per attach, and no leaked effect subscriptions.
 *   2c. Double connectedCallback() on the same host (upgrade race) is an
 *       idempotent no-op through the Preact owner, not a second mount.
 *
 * Stub fidelity note: StubTextNode inherits setAttribute() from StubNode, so
 * it fails preact's hydration matcher, which uses `'setAttribute' in value`
 * to tell elements from text. Preact therefore replaces text children during
 * hydrate where a real browser reuses them. Element identity — the assertion
 * that matters here — is unaffected.
 */

import { assert, assertEquals } from '@std/assert';
import { signal } from '@openelement/element';
import { h } from 'preact';
import { useLayoutEffect } from 'preact/hooks';
import { definePreactIsland } from '../src/preact.ts';
import { installDomStubs, StubNode, StubTextNode } from './dom-stubs.ts';

// ─── Helpers ───────────────────────────────────────────────────────

/** A host pre-populated with the light-DOM children the server prerendered. */
function hostWithSsrContent(tag: string, text: string): { host: StubNode; element: StubNode } {
  const host = new StubNode();
  const element = new StubNode(1, tag);
  element.appendChild(new StubTextNode(text) as unknown as Node);
  host.appendChild(element as unknown as Node);
  return { host, element };
}

interface TestIsland extends HTMLElement {
  connectedCallback(): void;
  disconnectedCallback(): void;
  update(): void;
}

/**
 * Instantiate the island, move its content in from the "server" host, and
 * stub a flippable connection state (the shared stub element reports
 * isConnected=true unconditionally). Returns the connection flag handle.
 */
function islandWithContent(
  ctor: ReturnType<typeof definePreactIsland>,
  ssr: { host: StubNode },
): { instance: TestIsland; setConnected(value: boolean): void } {
  const instance = new ctor() as TestIsland;
  for (const child of [...ssr.host.childNodes]) {
    instance.appendChild(child);
  }
  let connected = true;
  Object.defineProperty(instance, 'isConnected', {
    configurable: true,
    get: () => connected,
  });
  return { instance, setConnected: (value) => connected = value };
}

// ─── 2a. First hydration onto real pre-existing SSR children ───────

Deno.test('Preact adversarial 2a: first hydration binds real SSR children without duplicating them (#1146)', async () => {
  const restore = installDomStubs();
  try {
    const count = signal(0);
    let starts = 0;
    let cleanups = 0;
    const Component = (props: { name?: string; count: { value: number } }) => {
      useLayoutEffect(() => {
        starts++;
        return () => cleanups++;
      }, []);
      return h('p', { class: 'msg' }, `Hello, ${props.name}! Count: ${props.count.value}`);
    };
    const ctor = definePreactIsland('test-adv-ssr-hydrate', Component as never, {
      props: { count } as never,
    });
    const { host, element } = hostWithSsrContent('P', 'Hello, SSR! Count: 0');
    const { instance, setConnected } = islandWithContent(ctor, { host });
    // The attribute channel carries the SSR-era props.
    instance.setAttribute('name', 'SSR');

    instance.connectedCallback();

    // The pre-existing SSR element is bound in place: mounted once, no
    // duplication, no replacement.
    assertEquals(starts, 1);
    assertEquals(cleanups, 0);
    assertEquals(instance.childNodes.length, 1);
    assert(instance.childNodes[0] === (element as unknown as Node));
    // The attribute prop and the options signal both flowed into the render.
    assertEquals(instance.textContent, 'Hello, SSR! Count: 0');

    // Signal + attribute updates re-render through the Preact owner in place.
    count.value = 7;
    instance.setAttribute('name', 'Client');
    instance.update();
    assertEquals(instance.textContent, 'Hello, Client! Count: 7');
    assertEquals(instance.childNodes.length, 1);
    assert(instance.childNodes[0] === (element as unknown as Node));
    assertEquals(starts, 1);
    assertEquals(cleanups, 0);

    // Teardown stays exactly-once, even under a double-detach storm.
    setConnected(false);
    instance.disconnectedCallback();
    instance.disconnectedCallback();
    await Promise.resolve();
    await Promise.resolve();
    assertEquals(cleanups, 1);
    assertEquals(starts, 1);
    assertEquals(instance.childNodes.length, 0);
  } finally {
    restore();
  }
});

// ─── 2b. Hydrate → update → detach → reconnect ─────────────────────

Deno.test('Preact adversarial 2b: hydrate-update-detach-reconnect keeps one tree and one teardown (#1146)', async () => {
  const restore = installDomStubs();
  try {
    let starts = 0;
    let cleanups = 0;
    const props: { label: string } = { label: 'ssr' };
    const Component = (p: { label?: string }) => {
      useLayoutEffect(() => {
        starts++;
        return () => cleanups++;
      }, []);
      return h('div', null, p.label ?? 'ssr');
    };
    const ctor = definePreactIsland('test-adv-lifecycle', Component as never, { props });
    const { host, element } = hostWithSsrContent('DIV', 'ssr');
    const { instance, setConnected } = islandWithContent(ctor, { host });

    // 1. Hydrate over the SSR tree.
    instance.connectedCallback();
    assertEquals(starts, 1);
    assert(instance.childNodes[0] === (element as unknown as Node));

    // 2. In-place update: no remount, no cleanup, element identity kept.
    props.label = 'updated';
    instance.update();
    assertEquals(instance.textContent, 'updated');
    assertEquals(starts, 1);
    assertEquals(cleanups, 0);
    assert(instance.childNodes[0] === (element as unknown as Node));

    // 3. Real detach: the deferred teardown unmounts exactly once.
    setConnected(false);
    instance.disconnectedCallback();
    await Promise.resolve();
    await Promise.resolve();
    assertEquals(cleanups, 1);
    assertEquals(instance.childNodes.length, 0);

    // 4. Reconnect: a fresh tree through the existing Preact owner — no
    //    hydrate replay, no duplicate mount.
    setConnected(true);
    instance.connectedCallback();
    assertEquals(starts, 2);
    assertEquals(cleanups, 1);
    assertEquals(instance.childNodes.length, 1);
    assertEquals(instance.textContent, 'updated');

    // 5. Final teardown exactly once: every mount was cleaned up, so no
    //    effect subscription leaked across the lifecycle.
    setConnected(false);
    instance.disconnectedCallback();
    await Promise.resolve();
    await Promise.resolve();
    assertEquals(cleanups, 2);
    assertEquals(starts, cleanups);
    assertEquals(instance.childNodes.length, 0);
  } finally {
    restore();
  }
});

// ─── 2c. Double connectedCallback on the same host (upgrade race) ──

Deno.test('Preact adversarial 2c: double connectedCallback is an idempotent no-op, not a second tree (#1146)', async () => {
  const restore = installDomStubs();
  try {
    let starts = 0;
    let cleanups = 0;
    const Component = () => {
      useLayoutEffect(() => {
        starts++;
        return () => cleanups++;
      }, []);
      return h('div', null, 'raced');
    };
    const ctor = definePreactIsland('test-adv-double-activate', Component as never);
    // Upgrade race on a hydrated host: the light DOM is already populated.
    const { host, element } = hostWithSsrContent('DIV', 'raced');
    const { instance, setConnected } = islandWithContent(ctor, { host });

    // Two connections without an intervening disconnect: the first hydrates,
    // the second is a no-op (the Preact owner already owns the tree).
    instance.connectedCallback();
    instance.connectedCallback();

    assertEquals(starts, 1);
    assertEquals(cleanups, 0);
    assertEquals(instance.childNodes.length, 1);
    assert(instance.childNodes[0] === (element as unknown as Node));
    assertEquals(instance.textContent, 'raced');

    // Ownership is still singular afterwards: one detach, one teardown.
    setConnected(false);
    instance.disconnectedCallback();
    await Promise.resolve();
    await Promise.resolve();
    assertEquals(cleanups, 1);
    assertEquals(starts, 1);
  } finally {
    restore();
  }
});
