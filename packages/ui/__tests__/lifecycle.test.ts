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
import { dialogHostWith, dropdownHostWith, fakeDialog, installDomHarness } from './harness.ts';
import { readInstanceState, writeInstanceState } from '../src/instance-state.ts';

installDomHarness();

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

// ─── open-dialog: session lifecycle (dialog-machine helpers; generated lane) ─

test('open-dialog: each open session enters the top layer exactly once; reopen re-enters', async () => {
  const { syncOpenDialog } = await import('../src/dialog-machine.ts');
  const fake = fakeDialog();
  const el = dialogHostWith(fake);
  const states = new Set<string>();
  el.open = true;
  syncOpenDialog(el, states);
  expect(fake.calls).toEqual(['showModal']);
  // A repeated sync inside the same open session must not re-enter (the
  // modalActive guard), or showModal() would throw InvalidStateError.
  syncOpenDialog(el, states);
  expect(fake.calls).toEqual(['showModal']);

  el.open = false;
  syncOpenDialog(el, states);
  expect(fake.calls).toEqual(['showModal', 'close']);

  // A new session re-enters the top layer exactly once.
  el.open = true;
  syncOpenDialog(el, states);
  expect(fake.calls).toEqual(['showModal', 'close', 'showModal']);
});

// The class's openEffect dispose/reconnect rows moved with the component: the
// generated lane's connection-signal teardown is shell-owned (not observable
// through this harness, per the header), and the same disconnect/reconnect
// semantics — clean teardown, exactly-once close events across reconnect —
// are pinned at browser level in
// packages/element/__wtr__/tests/overlay-contract.test.js ('disconnect/
// reconnect leaves a working dialog with single-event closes').

// ─── open-dropdown: activation wiring is reconnect-safe (dropdown-machine) ───

test('open-dropdown: activation wires the focus-return listeners on the retained root and keeps the anchor stable', async () => {
  const { activateDropdown } = await import('../src/dropdown-machine.ts');
  const additions: Record<string, number> = {};
  const removals: Record<string, number> = {};
  const content = { matches: () => false, togglePopover: () => {} };
  const el = dropdownHostWith(content);
  el.shadowRoot.addEventListener = (type: string) => {
    additions[type] = (additions[type] ?? 0) + 1;
  };
  el.shadowRoot.removeEventListener = (type: string) => {
    removals[type] = (removals[type] ?? 0) + 1;
  };

  activateDropdown(el);
  expect(additions).toEqual({ focusin: 1, beforetoggle: 1, toggle: 1, slotchange: 1 });
  const anchor = el.anchorName;
  expect(anchor).not.toEqual('');
  // Both anchor halves: the host carries `anchor-name` and the custom property
  // the authored sheet reads; the compiled content leaf stays style-free.
  expect(el.style.getPropertyValue('anchor-name')).toEqual(anchor);
  expect(el.style.getPropertyValue('--oe-dropdown-anchor')).toEqual(anchor);

  // A reconnect re-runs activation: the previous generation's listeners come
  // off FIRST and the new generation wires exactly once more, so a queued task
  // from the dead connection cannot mutate the fresh claim. The realm-unique
  // anchor name is not re-assigned.
  activateDropdown(el);
  expect(removals).toEqual({ focusin: 1, beforetoggle: 1, toggle: 1, slotchange: 1 });
  expect(additions).toEqual({ focusin: 2, beforetoggle: 2, toggle: 2, slotchange: 2 });
  expect(el.anchorName).toEqual(anchor);
});

// ─── open-dropdown: element teardown removes the wiring ─────────────────────

test('open-dropdown: element teardown removes the wiring once, idempotently', async () => {
  const { activateDropdown, disposeDropdownFocusWiring } =
    await import('../src/dropdown-machine.ts');
  const removals: Record<string, number> = {};
  const content = { matches: () => false, togglePopover: () => {} };
  const el = dropdownHostWith(content);
  el.shadowRoot.addEventListener = () => {};
  el.shadowRoot.removeEventListener = (type: string) => {
    removals[type] = (removals[type] ?? 0) + 1;
  };

  activateDropdown(el);
  disposeDropdownFocusWiring(el);
  expect(removals).toEqual({ focusin: 1, beforetoggle: 1, toggle: 1, slotchange: 1 });
  expect(readInstanceState(el, 'focusWired', () => true)).toEqual(false);
  // Idempotent: a second teardown removes nothing.
  disposeDropdownFocusWiring(el);
  expect(removals).toEqual({ focusin: 1, beforetoggle: 1, toggle: 1, slotchange: 1 });
});

// ─── open-dropdown: the anchor identity is a host custom property ───────────

test('open-dropdown: renaming the anchor moves the host custom property the sheet reads', async () => {
  const { syncDropdownAnchor, clearDropdownPositionAnchor } =
    await import('../src/dropdown-machine.ts');
  const content = { matches: () => false, togglePopover: () => {} };
  const el = dropdownHostWith(content);
  syncDropdownAnchor(el);
  expect(el.style.getPropertyValue('--oe-dropdown-anchor')).toEqual(el.anchorName);

  el.anchorName = '--author-renamed';
  syncDropdownAnchor(el);
  expect(el.style.getPropertyValue('anchor-name')).toEqual('--author-renamed');
  expect(el.style.getPropertyValue('--oe-dropdown-anchor')).toEqual('--author-renamed');

  // The content leaf never receives an inline declaration, so the reconnect
  // claim's static-seed compare stays satisfied; the guard clears a stale one.
  clearDropdownPositionAnchor(el);
  expect(content.hasAttribute('style')).toEqual(false);
});

// ─── open-input is a generated (function-component) element ─────────────────
//
// It is no longer a class with `onCsrRendered` / `inputId` / `handleFocus`.
// The generated lane spells its ids statically inside the shadow template
// (the shadow boundary is its own id scope, and a connect-time id write would
// fail the claim's static-seed check) and installs the focus/blur listeners in
// the compiled template, so the class-time rows above have no subject left.
// Browser evidence for the shipped element: `ui-input-control.spec.ts`
// (control surface, error/ARIA both directions) and `ui-form.spec.ts`
// (delegatesFocus, per-input events, form participation), three engines.
