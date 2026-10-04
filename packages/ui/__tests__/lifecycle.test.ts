/**
 * @openelement/ui lifecycle tests (#1227, B2.2 — audit findings L4/L5).
 *
 * Package-level pins for the semantics the independent audit called out:
 * multi-instance independence, dual-state transitions, reconnect exactly-once
 * and dispose cleanup. Everything here asserts observable behavior — event
 * counts, attribute stores, instance-state slots, call sequences — against
 * the imperative methods the compiler copies verbatim.
 *
 * What this harness deliberately does NOT assert (it would fake-pass):
 * - computed reactivity (open-callout icon fallback, open-input inputClass):
 *   uncompiled, @property fields are plain values, so `computed()` snapshots
 *   the initializer and never re-derives — the reactive path only exists in
 *   the compiled program.
 * - ElementInternals channels (setFormValue/setValidity/:state): `_internals`
 *   is a kernel-owned getter with no kernel attached in Deno tests.
 * - connectedCallback → rAF → initTheme scheduling: `_requestAnimationFrame`
 *   is kernel/detached-lifecycle owned.
 * Browser-level evidence for those lives in
 * tests/fixtures/router-ui-dogfood/e2e (forms, tabs reconnect,
 * dialog states) and www/e2e/theme-system.spec.ts (theme init/toggle/
 * persistence/multi-toggle on the shipped page).
 */
import { expect, test } from 'vitest';
import {
  dialogWith,
  fakeDialog,
  installDomHarness,
  installThemeGlobals,
  themeHarness,
} from './harness.ts';
import { readInstanceState, writeInstanceState } from '../src/instance-state.ts';

installDomHarness();

// oxlint-disable-next-line no-explicit-any
type AnyComponent = any;

// ─── instance-state: the per-host foundation every lifecycle guard builds on ─

test('instance-state: slots are per-host — writes never leak across instances', () => {
  const hostA = {};
  const hostB = {};
  let inits = 0;
  const first = readInstanceState(hostA, 'key', () => {
    inits++;
    return 'a-value';
  });
  // The initializer runs exactly once per host.
  expect(readInstanceState(hostA, 'key', () => 'other')).toEqual('a-value');
  expect(inits).toEqual(1);
  // A second host gets its own slot, initialized independently.
  writeInstanceState(hostB, 'key', 'b-value');
  expect(readInstanceState(hostA, 'key', () => 'other')).toEqual('a-value');
  expect(first).toEqual('a-value');
  expect(readInstanceState(hostB, 'key', () => 'other')).toEqual('b-value');
});

// ─── open-theme-toggle: multi-instance / dual-state / reconnect / dispose (L4) ─

async function newToggle() {
  const { OpenThemeToggle } = await import('../src/open-theme-toggle.tsx');
  return new (OpenThemeToggle as unknown as new () => AnyComponent)();
}

test('open-theme-toggle: two instances on one page resolve independently from their own priority chains', async () => {
  const harness = themeHarness({ savedTheme: 'dark', mediaLight: false });
  installThemeGlobals(harness);

  const fromStorage = await newToggle();
  const withAttr = await newToggle();
  withAttr.setAttribute('theme', 'light');

  // The storage instance resolves first, from storage (document untouched).
  fromStorage.initTheme();
  // The attribute instance resolves from its own attribute — not from the
  // document theme the first instance just propagated.
  withAttr.initTheme();

  // Per-instance resolution: storage said dark for one, the attribute light
  // for the other; neither read the other's instance state.
  expect(fromStorage.theme).toEqual('dark');
  expect(withAttr.theme).toEqual('light');
  // Each instance writes only its own host attribute.
  expect(fromStorage.getAttribute('data-theme')).toEqual('dark');
  expect(withAttr.getAttribute('data-theme')).toEqual('light');
  // The shared document reflects each application in order (last writer wins)
  // — instances converge through the document channel, never by sharing state.
  expect(harness.docAttributes).toEqual([
    ['data-theme', 'dark'],
    ['data-theme', 'light'],
  ]);
  // Each instance propagated its own resolution exactly once.
  expect(harness.dispatched).toEqual(['open:theme-change', 'open:theme-change']);
  expect(harness.writes, 'init must not persist').toEqual([]);
});

test('open-theme-toggle: a later-initializing instance converges to the live document theme', async () => {
  const harness = themeHarness({ savedTheme: 'dark' });
  installThemeGlobals(harness);
  const first = await newToggle();
  first.setAttribute('theme', 'light');
  first.initTheme();
  expect(first.theme).toEqual('light');

  // The first instance's application wrote data-theme to the document; a
  // second instance initializing now follows the DOCUMENT (the page's live
  // theme) over its stale storage value — this is how multiple toggles on one
  // page agree instead of fighting.
  const second = await newToggle();
  second.initTheme();
  expect(second.theme).toEqual('light');
  expect(harness.dispatched).toEqual(['open:theme-change', 'open:theme-change']);
  expect(harness.writes).toEqual([]);
});

test("open-theme-toggle: one instance's toggle never disturbs another instance's state", async () => {
  const harness = themeHarness({ savedTheme: 'dark' });
  installThemeGlobals(harness);
  const first = await newToggle();
  const second = await newToggle();
  first.initTheme();
  second.initTheme();
  expect(first.theme).toEqual('dark');
  expect(second.theme).toEqual('dark');
  harness.dispatched.length = 0;
  harness.docAttributes.length = 0;

  first.handleToggle();

  expect(first.theme).toEqual('light');
  expect(first.getAttribute('data-theme')).toEqual('light');
  // The second instance's resolved state, host attribute and propagation
  // bookkeeping are untouched — no shared static leaks between instances.
  expect(second.theme).toEqual('dark');
  expect(second.getAttribute('data-theme')).toEqual('dark');
  expect(harness.dispatched).toEqual(['open:theme-change']);
  expect(harness.writes).toEqual(['light']);

  // The second instance still toggles from ITS OWN state, not the first's.
  second.handleToggle();
  expect(second.theme).toEqual('light');
  expect(harness.writes).toEqual(['light', 'light']);
  expect(harness.dispatched).toEqual(['open:theme-change', 'open:theme-change']);
});

test('open-theme-toggle: dual-state transitions re-apply host attribute, document and colorScheme per change', async () => {
  const harness = themeHarness({});
  installThemeGlobals(harness);
  const el = await newToggle();
  el.initTheme();
  expect(el.theme).toEqual('dark');

  el.handleToggle();
  expect(el.theme).toEqual('light');
  el.handleToggle();
  expect(el.theme).toEqual('dark');

  // Every actual transition is observable on all three channels.
  expect(harness.docAttributes).toEqual([
    ['data-theme', 'dark'],
    ['data-theme', 'light'],
    ['data-theme', 'dark'],
  ]);
  expect(harness.colorSchemes).toEqual(['dark', 'light', 'dark']);
  expect(harness.dispatched).toEqual([
    'open:theme-change',
    'open:theme-change',
    'open:theme-change',
  ]);
  expect(el.getAttribute('data-theme')).toEqual('dark');
});

test('open-theme-toggle: re-applying the current theme dispatches nothing and persists nothing', async () => {
  const harness = themeHarness({});
  installThemeGlobals(harness);
  const el = await newToggle();
  el.initTheme();
  expect(harness.dispatched).toEqual(['open:theme-change']);

  // The attribute echo of the already-resolved theme (old === val) is a no-op.
  el.attributeChangedCallback('theme', 'dark', 'dark');
  // Re-applying the propagated theme must not re-dispatch: subscribers would
  // re-apply a theme that never changed.
  el.applyTheme('dark');

  expect(harness.dispatched).toEqual(['open:theme-change']);
  expect(harness.writes).toEqual([]);
  expect(el.theme).toEqual('dark');
});

test('open-theme-toggle: reconnect re-runs initTheme zero times — resolution, writes and dispatch happen exactly once per instance', async () => {
  const harness = themeHarness({ savedTheme: 'dark' });
  installThemeGlobals(harness);
  const el = await newToggle();
  el.initTheme();
  expect(el.theme).toEqual('dark');
  expect(harness.dispatched).toEqual(['open:theme-change']);
  expect(harness.docAttributes).toEqual([['data-theme', 'dark']]);

  // While "disconnected", every resolution source changes: a reconnect must
  // NOT re-resolve — the instance keeps the theme it resolved and propagated.
  harness.savedTheme = 'light';
  harness.mediaLight = true;
  (document.documentElement as unknown as { dataset: Record<string, string> }).dataset.theme =
    'light';

  // connectedCallback (rAF) + onDsdHydrated (rAF) both schedule initTheme per
  // connect; across a disconnect/reconnect cycle that is several calls.
  el.initTheme();
  el.initTheme();

  expect(el.theme, 'reconnect must not re-resolve from changed sources').toEqual('dark');
  expect(harness.dispatched, 'no re-dispatch on reconnect').toEqual(['open:theme-change']);
  expect(harness.docAttributes, 'no re-write on reconnect').toEqual([['data-theme', 'dark']]);
  expect(harness.writes, 'reconnect never persists').toEqual([]);
});

test('open-theme-toggle: dispose is teardown-free and a replacement instance initializes fresh', async () => {
  const harness = themeHarness({ savedTheme: 'dark' });
  installThemeGlobals(harness);
  const first = await newToggle();
  first.initTheme();
  expect(harness.dispatched).toEqual(['open:theme-change']);

  // The component registers no listeners or effects of its own (the compiled
  // click sink is kernel-owned), so dispose has nothing to clean: the base
  // teardown must be a safe no-op and the instance stays inert afterwards.
  first.disconnectedCallback();
  first.initTheme();
  expect(harness.dispatched, 'disposed instance does not re-init').toEqual(['open:theme-change']);

  // Instance state is keyed by host (WeakMap): the replacement instance on
  // the same page initializes fully and independently. The first instance
  // left data-theme='dark' on the document, so the replacement converges to
  // the page's live theme even though storage now disagrees.
  harness.savedTheme = 'light';
  const second = await newToggle();
  second.initTheme();
  expect(second.theme).toEqual('dark');
  expect(harness.dispatched).toEqual(['open:theme-change', 'open:theme-change']);
  expect(first.theme).toEqual('dark');
  expect(harness.writes).toEqual([]);
});

test('open-theme-toggle: an attribute-driven change applies but never persists (#804 complement)', async () => {
  const harness = themeHarness({});
  installThemeGlobals(harness);
  const el = await newToggle();
  el.attributeChangedCallback('theme', null, 'light');
  expect(el.theme).toEqual('light');
  expect(el.getAttribute('data-theme')).toEqual('light');
  expect(harness.dispatched).toEqual(['open:theme-change']);
  // Persistence is exclusive to the explicit user toggle (handleToggle).
  expect(harness.writes).toEqual([]);
  // A non-light value resolves to dark (the only two states).
  el.attributeChangedCallback('theme', 'light', 'blue');
  expect(el.theme).toEqual('dark');
  expect(harness.writes).toEqual([]);
});

// ─── open-dialog: session lifecycle + dispose ────────────────────────────────

test('open-dialog: each open session enters the top layer exactly once; reopen re-enters', async () => {
  const fake = fakeDialog();
  const el = await dialogWith(fake);
  el.open = true;
  el.onDsdHydrated();
  expect(fake.calls).toEqual(['showModal']);
  // A repeated sync inside the same open session must not re-enter (the
  // modalActive guard), or showModal() would throw InvalidStateError.
  el.syncDialogElement();
  expect(fake.calls).toEqual(['showModal']);

  el.open = false;
  el.syncDialogElement();
  expect(fake.calls).toEqual(['showModal', 'close']);

  // A new session re-enters the top layer exactly once.
  el.open = true;
  el.syncDialogElement();
  expect(fake.calls).toEqual(['showModal', 'close', 'showModal']);
});

test('open-dialog: dispose tears the open effect down exactly once; reconnect re-establishes it', async () => {
  const el = await dialogWith(fakeDialog());
  el.onCsrRendered();
  expect(typeof readInstanceState(el, 'openEffect', () => undefined)).toEqual('function');

  el.disconnectedCallback();
  expect(
    readInstanceState(el, 'openEffect', () => 'missing'),
    'the effect teardown must run and the slot must be cleared',
  ).toEqual(undefined);
  // Double dispose is safe (the cleared slot yields no second teardown call).
  el.disconnectedCallback();

  // Reconnect re-subscribes the compiled-signal effect for the new session.
  el.onCsrRendered();
  expect(typeof readInstanceState(el, 'openEffect', () => undefined)).toEqual('function');
});

// ─── open-tabs: decoration wiring across activation, dispose and reconnect ───

interface FakeTab {
  attrs: Map<string, string>;
  clickListeners: EventListener[];
  focused: boolean;
  classes: Map<string, boolean>;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  removeAttribute(name: string): void;
  addEventListener(type: string, listener: EventListener): void;
  focus(): void;
  click(): void;
  classList: { toggle(name: string, on: boolean): void };
}

function fakeTab(): FakeTab {
  const tab: FakeTab = {
    attrs: new Map(),
    clickListeners: [],
    focused: false,
    classes: new Map(),
    setAttribute(name, value) {
      tab.attrs.set(name, value);
    },
    getAttribute(name) {
      return tab.attrs.get(name) ?? null;
    },
    removeAttribute(name) {
      tab.attrs.delete(name);
    },
    addEventListener(type, listener) {
      if (type === 'click') tab.clickListeners.push(listener);
    },
    focus() {
      tab.focused = true;
    },
    click() {
      for (const listener of [...tab.clickListeners]) {
        listener.call(tab as unknown as EventTarget, new Event('click'));
      }
    },
    classList: {
      toggle(name, on) {
        tab.classes.set(name, on);
      },
    },
  };
  return tab;
}

function tabsHost(tabCount: number, panelCount: number) {
  return (async () => {
    const { OpenTabs } = await import('../src/open-tabs.tsx');
    const el = new (OpenTabs as unknown as new () => AnyComponent)();
    const tabs = Array.from({ length: tabCount }, fakeTab);
    const panels = Array.from({ length: panelCount }, fakeTab);
    el.querySelectorAll = (selector: string) =>
      (selector === '[slot="tab"]' ? tabs : panels) as unknown as NodeListOf<Element>;
    return { el, tabs, panels };
  })();
}

test('open-tabs: activation decorates the WAI-ARIA wiring; selection re-decorates', async () => {
  const { el, tabs, panels } = await tabsHost(3, 3);
  el.onCsrRendered();
  expect(el.tabsId).not.toEqual('');

  expect(tabs[0].attrs.get('role')).toEqual('tab');
  expect(tabs[0].attrs.get('aria-selected')).toEqual('true');
  expect(tabs[0].attrs.get('tabindex')).toEqual('0');
  expect(tabs[1].attrs.get('aria-selected')).toEqual('false');
  expect(tabs[1].attrs.get('tabindex')).toEqual('-1');
  // id/aria-controls and aria-labelledby pair tabs with panels per instance.
  expect(tabs[1].attrs.get('aria-controls')).toEqual(`${el.tabsId}-panel-1`);
  expect(panels[1].attrs.get('aria-labelledby')).toEqual(`${el.tabsId}-tab-1`);
  expect(panels[0].attrs.has('hidden')).toEqual(false);
  expect(panels[1].attrs.get('hidden')).toEqual('');

  // Selecting a tab re-decorates the wiring (uncompiled, the compiled-signal
  // effect does not re-run — decorate() is the effect body, called directly).
  el.select(2);
  el.decorate();
  expect(tabs[2].attrs.get('aria-selected')).toEqual('true');
  expect(tabs[0].attrs.get('aria-selected')).toEqual('false');
  expect(panels[2].attrs.has('hidden')).toEqual(false);
  expect(panels[0].attrs.get('hidden')).toEqual('');
});

test('open-tabs: click wiring attaches once per tab across dispose/reconnect; reconnect re-syncs stale ARIA', async () => {
  const { el, tabs } = await tabsHost(2, 2);
  el.onCsrRendered();
  expect(tabs.map((t) => t.clickListeners.length)).toEqual([1, 1]);

  // Click selection goes through the wired listener exactly once per click.
  tabs[1].click();
  expect(el.active).toEqual(1);

  // Dispose: the decorate effect is torn down and its slot cleared.
  el.disconnectedCallback();
  expect(readInstanceState(el, 'decorateEffect', () => 'missing')).toEqual(undefined);

  // While detached, external markup drifts stale (browser-level analog:
  // ui-dogfood ui-tabs.spec.ts reconnect test observes exactly this).
  tabs[0].setAttribute('aria-selected', 'true');
  el.select(0);

  // Reconnect: a fresh effect re-runs decorate once — stale ARIA is corrected,
  // and the WeakSet wiring guard keeps click listeners at one per tab.
  el.onCsrRendered();
  expect(typeof readInstanceState(el, 'decorateEffect', () => undefined)).toEqual('function');
  expect(tabs.map((t) => t.clickListeners.length)).toEqual([1, 1]);
  expect(tabs[0].attrs.get('aria-selected')).toEqual('true');
  expect(tabs[1].attrs.get('aria-selected')).toEqual('false');
});

test('open-tabs: two instances on one page get independent id prefixes and selection state', async () => {
  const first = await tabsHost(2, 2);
  const second = await tabsHost(2, 2);
  first.el.onCsrRendered();
  second.el.onCsrRendered();
  expect(first.el.tabsId).not.toEqual(second.el.tabsId);

  first.el.select(1);
  first.el.decorate();
  second.el.decorate();
  expect(first.tabs[1].attrs.get('aria-selected')).toEqual('true');
  // The second instance's decoration is untouched by the first's selection.
  expect(second.tabs[0].attrs.get('aria-selected')).toEqual('true');
  expect(second.tabs[1].attrs.get('aria-selected')).toEqual('false');
  expect(second.el.active).toEqual(0);
});

// ─── open-dropdown: activation wiring is reconnect-safe ──────────────────────

test('open-dropdown: focus-return wiring attaches once across dispose/reconnect; anchor name stays stable', async () => {
  const { OpenDropdown } = await import('../src/open-dropdown.tsx');
  const el = new (OpenDropdown as unknown as new () => AnyComponent)();
  const listenerCounts: Record<string, number> = {};
  const content = {
    matches: () => false,
    togglePopover: () => {},
    addEventListener: (type: string) => {
      listenerCounts[type] = (listenerCounts[type] ?? 0) + 1;
    },
  };
  el.shadowRoot = { querySelector: (sel: string) => (sel === '.content' ? content : null) };

  el.onCsrRendered();
  expect(listenerCounts).toEqual({ focusin: 1, beforetoggle: 1, toggle: 1 });
  const anchor = el.anchorName;
  expect(anchor).not.toEqual('');

  // Reconnect: the focusWired guard keeps the listeners at one each, and the
  // realm-unique anchor name is NOT re-assigned (both halves must keep the
  // name the SSR/CSR activation paired).
  el.disconnectedCallback();
  el.onCsrRendered();
  expect(listenerCounts).toEqual({ focusin: 1, beforetoggle: 1, toggle: 1 });
  expect(el.anchorName).toEqual(anchor);
});

// ─── open-input: activation id stability + focus/blur events ─────────────────

test('open-input: activation assigns the control id once — reconnect keeps it', async () => {
  const { OpenInput } = await import('../src/open-input.tsx');
  const el = new (OpenInput as unknown as new () => AnyComponent)();
  el.onCsrRendered();
  const id = el.inputId;
  expect(id).not.toEqual('');
  el.disconnectedCallback();
  el.onCsrRendered();
  expect(el.inputId, 're-activation must not re-assign the realm-unique id').toEqual(id);
});

test('open-input: focus and blur dispatch composed open-focus/open-blur events', async () => {
  const { OpenInput } = await import('../src/open-input.tsx');
  const el = new (OpenInput as unknown as new () => AnyComponent)();
  const seen: Array<{ type: string; bubbles: boolean; composed: boolean }> = [];
  el.addEventListener('open-focus', (e: Event) => {
    seen.push({ type: e.type, bubbles: e.bubbles, composed: e.composed });
  });
  el.addEventListener('open-blur', (e: Event) => {
    seen.push({ type: e.type, bubbles: e.bubbles, composed: e.composed });
  });
  el.handleFocus();
  el.handleBlur();
  expect(seen).toEqual([
    { type: 'open-focus', bubbles: true, composed: true },
    { type: 'open-blur', bubbles: true, composed: true },
  ]);
});
