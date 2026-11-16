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
 * - computed reactivity (open-input inputClass):
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
import { dialogWith, fakeDialog, installDomHarness } from './harness.ts';
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

// ─── open-theme-toggle: generated element (see the www e2e suite) ────────────
//
// The class these rows drove no longer exists: the component is authored as a
// function component and compiled into `OpenThemeToggleElement`, registered by
// the build. The same L4 semantics (multi-instance priority chains, document
// convergence, dual-state transitions, reconnect exactly-once, disconnect
// teardown and the attribute-driven no-persist rule) are asserted in
// `www/e2e/theme-toggle-instances.spec.ts` against the real element.

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
