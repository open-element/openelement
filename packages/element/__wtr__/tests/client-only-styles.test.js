/**
 * Client-only shadow style adoption (2026-11-20, GH #1800's last slice).
 *
 * `wtr-live-timer` is the starter's `live-timer` shape compiled through the
 * generated-element lane: `ssr: false` + a shadow root + one declared sheet.
 * No DSD template exists, so nothing carries a `<link>`; the root is created by
 * the shell in the browser. The only way the `:host { display: inline-block }`
 * rule can reach it is the compiler's emitted module-graph import plus the
 * shell's adoption of the resulting sheet object.
 *
 * These assertions are deliberately about the OBSERVABLE outcome, not the
 * descriptor: computed style is what the user sees, and the adopted-sheet list
 * is the browser's own record of the delivery. A missing import, a missing
 * descriptor row, or an unconnected scope each fail here with no fake.
 */
import { afterEach, assert, expect, test } from 'vitest';
import { waitFor } from './helpers.js';
import { WtrLiveTimerElement } from '../generated/wtr-live-timer.ts';
import { createRecipe } from '@openelement/element/internal/compiled/leaf-runtime';
import { createGeneratedElementClass } from '@openelement/element/internal/compiled/generated-element/shell';

customElements.define('wtr-live-timer', WtrLiveTimerElement);
await customElements.whenDefined('wtr-live-timer');

/** Hosts this file created, removed after each row. */
const hosts = [];

afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

function mount() {
  const host = document.createElement('wtr-live-timer');
  document.body.append(host);
  hosts.push(host);
  return host;
}

test('the shell-created shadow root adopts the declared sheet: :host display is inline-block', async () => {
  const host = mount();
  // The root exists only after the first connect; from then on the sidecar's
  // one rule is the host's box (`inline` is the custom-element default, so this
  // value is unreachable without the adopted sheet).
  await waitFor(() => host.shadowRoot?.adoptedStyleSheets.length === 1, 'the sheet is adopted');
  expect(getComputedStyle(host).display, 'the :host rule reached the host').toBe('inline-block');
  // The adoption target is the shadow root the SHELL created, not the document.
  expect(document.adoptedStyleSheets).not.toContain(host.shadowRoot.adoptedStyleSheets[0]);
});

test('the client-only mount still runs: the compiled clock text advances', async () => {
  const host = mount();
  const elapsed = () =>
    host.shadowRoot?.querySelector('#elapsed')?.textContent ?? '';
  await waitFor(() => elapsed() !== '', 'the mounted text Part renders');
  const first = elapsed();
  // `onConnect` starts the clock from the document time origin, and its read of
  // the retained `signal` is a real closure capture (the 2026-11-20 lifecycle
  // fix): before it, the hook was silently dropped and this text froze.
  await waitFor(() => elapsed() !== first, 'the clock advances');
  expect(elapsed()).toMatch(/^\d+\.\d$/);
});

test('disconnect releases the adoption and reconnect re-arms exactly one copy', async () => {
  const host = mount();
  await waitFor(() => host.shadowRoot?.adoptedStyleSheets.length === 1, 'first adoption');
  host.remove();
  // The generated lane keeps the DOM across disconnect (LC-0); the style scope
  // is the one part that must release, so the next connect does not stack a
  // second copy on the same retained root.
  expect(host.shadowRoot.adoptedStyleSheets.length, 'disconnect removes the shadow adoption').toBe(
    0,
  );
  document.body.append(host);
  hosts.push(host);
  await waitFor(
    () => host.shadowRoot?.adoptedStyleSheets.length === 1,
    'the reconnect re-adopts exactly one sheet',
  );
  expect(getComputedStyle(host).display).toBe('inline-block');
});

test('two instances of one component share the ONE module-level sheet object', async () => {
  const first = mount();
  const second = mount();
  await waitFor(
    () =>
      first.shadowRoot?.adoptedStyleSheets.length === 1 &&
      second.shadowRoot?.adoptedStyleSheets.length === 1,
    'both roots adopt',
  );
  // One import, one sheet object: the second instance must not duplicate the
  // module-graph edge or build a second sheet.
  assert.strictEqual(
    first.shadowRoot.adoptedStyleSheets[0],
    second.shadowRoot.adoptedStyleSheets[0],
  );
});

// ---- the descriptor contract behind the fixture (shell-only rows) ----------

/**
 * A mount-only recipe for the hand-built descriptors below. The shell passes
 * the per-connection scope as the recipe factory's owner, exactly like the
 * generated `<Name>__mount` path.
 */
function mountOnlyRecipe(owner) {
  return createRecipe({
    definitionOwner: owner,
    source: 'client-only-styles.test.js',
    mount() {
      const node = document.createElement('span');
      node.textContent = 'x';
      return [node];
    },
  });
}

let descriptorSequence = 0;

/** Build + define one shell class with a unique tag, return its constructor. */
function defineShell({ tag: name, ...descriptor }) {
  descriptorSequence += 1;
  const tag = `${name}-${descriptorSequence}`;
  const ctor = createGeneratedElementClass({
    tag,
    createRecipe: mountOnlyRecipe,
    ...descriptor,
  });
  customElements.define(tag, ctor);
  return { tag, ctor };
}

test('a non-sheet styles entry fails descriptor normalization (no silent unstyled render)', () => {
  // What a build that failed to intercept the emitted `.css` import hands over:
  // a string (Vite's CSS default export) or a missing binding. Adopting it would
  // throw inside `adoptedStyleSheets` or render nothing, so the shell refuses at
  // class creation with a coded build-phase error.
  expect(() =>
    defineShell({
      tag: 'x-bad-sheet',
      root: 'shadow-open',
      styles: ['./not-a-sheet.css'],
    }),
  ).toThrow(/styles\[0\] is not a stylesheet object/);
});

test('a light root adopts the declared sheet into the tree it is in', async () => {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(':host { color: rgb(1, 2, 3); }');
  const { tag } = defineShell({ tag: 'x-light-adopt', root: 'light', styles: [sheet] });
  const host = document.createElement(tag);
  document.body.append(host);
  hosts.push(host);
  await waitFor(() => host.textContent?.includes('x') === true, 'the shell mounted');
  expect(document.adoptedStyleSheets, 'the document is the light root target').toContain(sheet);
  host.remove();
  // The class-lane rule: a document's adoption is per-component-type and shared,
  // so a disconnect removes nothing (other live instances still need it).
  expect(document.adoptedStyleSheets).toContain(sheet);
});

test('a marked document link is the delivery: the light root adopts no second copy', async () => {
  const url = '/client/assets/oe-light-link.css';
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(':host { color: rgb(4, 5, 6); }');
  Object.defineProperty(sheet, '__openElementStyleSheetUrl', { value: url });
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  link.setAttribute('data-oe-static-styles', '');
  document.head.append(link);
  try {
    const { tag } = defineShell({ tag: 'x-light-link', root: 'light', styles: [sheet] });
    const host = document.createElement(tag);
    document.body.append(host);
    hosts.push(host);
    await waitFor(() => host.textContent?.includes('x') === true, 'the shell mounted');
    // `sheetDeliveredByLink()` sees the same canonical URL on the target's own
    // marked link and keeps that as the single delivery.
    expect(document.adoptedStyleSheets).not.toContain(sheet);
  } finally {
    link.remove();
  }
});
