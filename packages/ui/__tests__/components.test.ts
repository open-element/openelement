/**
 * @openelement/ui public contract tests (v0.44 compiled authoring, ADR-0143).
 *
 * The 0.44 components are compiled Part Program classes: their render() runs
 * at compile time only, so the legacy VNode-tree assertions are gone. This
 * suite exercises the imperative behavior that survives in methods (the
 * compiler copies methods verbatim): click/form choreography, dialog top-layer
 * state machine, theme initialization priority, tabs keyboard pattern,
 * dropdown popover guard, code-block copy feedback. The fake-DOM harness is
 * shared with lifecycle.test.ts (./harness.ts).
 *
 * Compiled-sink behavior (attribute ↔ signal ↔ DOM) is covered by the element
 * package's compiled facade/claim suites and by www's e2e against the shipped
 * components — Deno tests import the sources uncompiled (no Part Program), so
 * nothing here connects an element.
 */
import { expect, test } from 'vitest';
import { dialogHostWith, dropdownHostWith, fakeDialog, installDomHarness } from './harness.ts';

installDomHarness();

// ─── open-button: click/form choreography (#637, #757) ──────────────────────
//
// The choreography now lives in `button-machine.ts` (a compiled component module
// may carry no top-level helper, so the originated logic moved to a plain .ts
// module verbatim). These rows keep driving it — same assertions, real subject —
// with a host stub standing in for the generated element's declared rows.

import { activateButton, type ButtonHost } from '../src/button-machine.ts';

/** A host stub: the declared rows plus the event/dispatch surface the helper reads. */
function buttonHost(rows: Partial<ButtonHost> = {}): ButtonHost {
  const listeners = new Set<(event: Event) => void>();
  return Object.assign(new EventTarget(), {
    disabled: false,
    href: '',
    type: 'button',
    closest: () => null,
    ...rows,
    addEventListener: (type: string, listener: (event: Event) => void) => {
      if (type === 'open-click') listeners.add(listener);
    },
    dispatchEvent: (event: Event) => {
      if (event.type === 'open-click') for (const listener of listeners) listener(event);
      return true;
    },
  }) as unknown as ButtonHost;
}

function fakeForm(events: string[], prevent = false): HTMLFormElement {
  return {
    tagName: 'FORM',
    dispatchEvent: (event: Event) => {
      if (prevent) event.preventDefault();
      events.push(event.type);
      return true;
    },
    reset: () => events.push('reset'),
    requestSubmit: () => events.push('requestSubmit'),
  } as unknown as HTMLFormElement;
}

test('open-button: click dispatches open-click and submits an associated form', () => {
  const events: string[] = [];
  const host = buttonHost({ type: 'submit', closest: () => fakeForm(events) });
  let openClickSeen = false;
  host.addEventListener('open-click', () => {
    openClickSeen = true;
  });
  const publish = () => host.dispatchEvent(new Event('open-click'));
  activateButton(host, new Event('click'), publish);
  expect(openClickSeen, 'open-click must fire').toBeTruthy();
  expect(events).toEqual(['submit', 'requestSubmit']);
});

test('open-button: a prevented submit skips requestSubmit', () => {
  const events: string[] = [];
  const host = buttonHost({ type: 'submit', closest: () => fakeForm(events, true) });
  activateButton(host, new Event('click'), () => {});
  expect(events).toEqual(['submit']);
});

test('open-button: type=reset resets the form; anchor branch never touches forms (#637)', () => {
  const events: string[] = [];
  const reset = buttonHost({ type: 'reset', closest: () => fakeForm(events) });
  activateButton(reset, new Event('click'), () => {});
  expect(events).toEqual(['reset']);

  // Anchor branch: a navigation control, not a form control.
  const anchor = buttonHost({ href: '/go', type: 'submit', closest: () => fakeForm(events) });
  activateButton(anchor, new Event('click'), () => {});
  expect(events, 'the anchor branch must not submit').toEqual(['reset']);
});

test('open-button: disabled click prevents default and fires nothing (#757)', () => {
  const events: string[] = [];
  const host = buttonHost({ disabled: true, type: 'submit', closest: () => fakeForm(events) });
  let openClickSeen = false;
  host.addEventListener('open-click', () => {
    openClickSeen = true;
  });
  const event = new Event('click', { cancelable: true });
  const publish = () => host.dispatchEvent(new Event('open-click'));
  activateButton(host, event, publish);
  expect(openClickSeen).toEqual(false);
  expect(events.length).toEqual(0);
  expect(event.defaultPrevented).toEqual(true);
});

// ─── open-dialog: top-layer state machine (#1030, dialog-machine helpers) ────

test('open-dialog: the open property drives the custom states', async () => {
  const { updateDialogStates } = await import('../src/dialog-machine.ts');
  const el = dialogHostWith(fakeDialog());
  const states = new Set<string>();
  el.open = true;
  updateDialogStates(el, states);
  expect(states.has('open')).toEqual(true);
  expect(states.has('closed')).toEqual(false);
  el.open = false;
  updateDialogStates(el, states);
  expect(states.has('open')).toEqual(false);
  expect(states.has('closed')).toEqual(true);
});

test('open-dialog: modal open closes the attribute-driven open, then showModal (#1030)', async () => {
  const { syncOpenDialog } = await import('../src/dialog-machine.ts');
  const fake = fakeDialog();
  const el = dialogHostWith(fake);
  el.open = true;
  // The compiled bool sink marks dialog.open at mount; the sync closes that
  // state and enters the top layer via showModal exactly once per session.
  fake.open = true;
  syncOpenDialog(el, new Set<string>());
  expect(fake.calls).toEqual(['close', 'showModal']);
});

test('open-dialog: non-modal mode uses show() only', async () => {
  const { syncOpenDialog } = await import('../src/dialog-machine.ts');
  const fake = fakeDialog();
  const el = dialogHostWith(fake, 'non-modal');
  el.open = true;
  syncOpenDialog(el, new Set<string>());
  expect(fake.calls).toEqual(['show']);
  expect(fake.calls.includes('showModal')).toEqual(false);
});

test('open-dialog: cancel prevents default first, then closes and dispatches open-dialog-close', async () => {
  const { handleDialogCancel } = await import('../src/dialog-machine.ts');
  const el = dialogHostWith(fakeDialog());
  let closes = 0;
  el.addEventListener('open-dialog-close', () => {
    closes++;
  });
  el.open = true;
  const cancel = new Event('cancel', { cancelable: true });
  handleDialogCancel(el, cancel);
  expect(cancel.defaultPrevented).toEqual(true);
  expect(closes).toEqual(1);
  expect(el.open).toEqual(false);
});

test('open-dialog: modal close restores the sink-removed open attribute before close() (#1226)', async () => {
  const { syncOpenDialog } = await import('../src/dialog-machine.ts');
  const fake = fakeDialog();
  const el = dialogHostWith(fake);
  el.open = true;
  fake.open = true;
  syncOpenDialog(el, new Set<string>());
  expect(fake.calls.includes('showModal')).toEqual(true);
  // The compiled bool sink may remove the inner `open` attribute before the
  // sync runs; per spec close() is then a no-op and the dialog stays :modal
  // forever. The sync must restore the attribute first.
  fake.open = false;
  fake.calls.length = 0;
  el.open = false;
  syncOpenDialog(el, new Set<string>());
  expect(fake.calls).toEqual(['setAttribute:open', 'close']);
  expect(fake.open).toEqual(false);
});

test('open-dialog: the native close echo of a programmatic close does not re-dispatch (#1226)', async () => {
  const { handleDialogCancel, handleDialogNativeClose, syncOpenDialog } =
    await import('../src/dialog-machine.ts');
  const fake = fakeDialog();
  const el = dialogHostWith(fake);
  let closes = 0;
  el.addEventListener('open-dialog-close', () => {
    closes++;
  });
  el.open = true;
  fake.open = true;
  syncOpenDialog(el, new Set<string>());
  // The user-facing close path (close button / cancel) fires the event.
  handleDialogCancel(el, new Event('cancel', { cancelable: true }));
  expect(closes).toEqual(1);
  // The inner dialog's native close event arrives after the programmatic
  // close; the session already fired its event.
  fake.open = false;
  handleDialogNativeClose(el);
  expect(closes).toEqual(1);
  // A genuine native close (e.g. form method="dialog") with the session
  // still open still dispatches exactly once.
  el.open = true;
  fake.open = false;
  handleDialogNativeClose(el);
  expect(closes).toEqual(2);
  expect(el.open).toEqual(false);
});

// ─── open-input is a generated (function-component) element ─────────────────
//
// It no longer exists as a class to instantiate. The five rows that used to
// drive `handleInput` / `inputId` / `formResetCallback` / `formDisabledCallback`
// on the class are deliberately not re-spelled against a stub: the generated
// lane's behaviour lives in the compiler-emitted element (the handlers are
// inline in the compiled template, the form contract is the shell's mapping),
// so only the real shipped element can answer them. They are covered by
// `tests/fixtures/router-ui-dogfood/e2e/ui-form.spec.ts` (FormData submission,
// valueMissing, reset, the fieldset-effective disabled state and its input
// refusal, delegatesFocus, per-input events) and
// `tests/fixtures/router-ui-dogfood/e2e/ui-input-control.spec.ts` (the control
// surface, the error/ARIA wiring in both directions, `part=control`), both on
// the built framework in Chromium, Firefox and WebKit.

// ─── open-theme-toggle is a generated (function-component) element ───────────
//
// It no longer exists as a class to instantiate: the compiler emits
// `OpenThemeToggleElement` and the build registers it. Its priority chain,
// persistence policy, per-instance resolution and reconnect/dispose semantics
// are asserted against the REAL shipped element in
// `www/e2e/theme-toggle-instances.spec.ts` (and the toggle behavior in
// `www/e2e/theme-system.spec.ts`), which is the platform-level form of the rows
// that used to drive the class methods here.

// ─── open-dropdown: pointerdown popover guard + per-instance anchor (#1061) ──

test('open-dropdown: click toggles the native popover; pointerdown on an open popover swallows the re-open', async () => {
  const { recordDropdownPointerDown, toggleDropdown } = await import('../src/dropdown-machine.ts');
  const state = { open: false, toggles: 0 };
  const content = {
    matches: (selector: string) => selector === ':popover-open' && state.open,
    togglePopover: () => {
      state.open = !state.open;
      state.toggles++;
    },
    style: { setProperty: () => {} },
  };
  const el = dropdownHostWith(content);

  // Plain click toggles open.
  toggleDropdown(el);
  expect(state.open).toEqual(true);

  // A mouse press on the trigger while open records the state; the click that
  // follows the native light-dismiss must not re-open the popover.
  state.open = false;
  state.toggles = 0;
  recordDropdownPointerDown(el);
  // (pointerdown saw the popover closed, so the click toggles normally.)
  toggleDropdown(el);
  expect(state.toggles).toEqual(1);

  state.open = true;
  recordDropdownPointerDown(el);
  toggleDropdown(el);
  expect(state.toggles, 'the post-pointerdown click is swallowed').toEqual(1);
});

test('open-dropdown: activation assigns realm-unique anchor names (host half)', async () => {
  const { activateDropdown } = await import('../src/dropdown-machine.ts');
  const content = {
    matches: () => false,
    togglePopover: () => {},
    style: { setProperty: () => {}, removeProperty: () => {} },
    addEventListener: () => {},
  };
  const first = dropdownHostWith(content);
  const second = dropdownHostWith(content);
  const hostStyles: string[] = [];
  const firstSet = first.style.setProperty.bind(first.style);
  first.style.setProperty = (name: string, value: string) => {
    hostStyles.push(`${name}=${value}`);
    firstSet(name, value);
  };
  activateDropdown(first);
  activateDropdown(second);
  expect(first.anchorName).not.toEqual(second.anchorName);
  expect(first.anchorName).toContain('--open-dropdown-trigger-');
  // The host half applies at activation; the content half (`position-anchor`)
  // rides the open window (beforetoggle) so a reconnect's re-claim of the
  // retained nodes sees exactly the compiled static seeds.
  expect(hostStyles).toContain(`anchor-name=${first.anchorName}`);
});

// ─── open-code-block is a generated (function-component) element ─────────────
//
// It no longer exists as a class to instantiate: the compiler emits
// `OpenCodeBlockElement` and the build registers it. The copy flow (success,
// failure, custom-state feedback and the reset timer) is asserted against the
// real shipped element in `www/e2e/ui-behaviour-matrix.spec.ts` (the copy
// control rows), which is the platform-level form of these rows.

// ─── package manifest: the consumer-facing attribute/event contract ──────────
// the router build derives island metadata from manifest.declarations (WC Package
// Protocol); a drifted declaration silently miscompiles consumer pages.

test("manifest: every declaration carries the component's published attributes and events", async () => {
  const { manifest } = await import('../src/index.ts');
  const expected: Record<string, { attributes: string[]; events: string[] }> = {
    'open-button': {
      attributes: ['variant', 'size', 'disabled', 'href', 'target', 'type'],
      events: ['open-click'],
    },
    'open-input': {
      attributes: [
        'type',
        'placeholder',
        'label',
        'name',
        'value',
        'disabled',
        'required',
        'error',
      ],
      events: ['open-input', 'open-change', 'open-focus', 'open-blur'],
    },
    'open-theme-toggle': { attributes: ['theme'], events: ['open:theme-change'] },
    'open-code-block': { attributes: [], events: [] },
    'open-dialog': { attributes: ['open', 'label'], events: ['open-dialog-close'] },
    'open-dropdown': { attributes: [], events: [] },
  };
  const actual = Object.fromEntries(
    manifest.declarations.map((decl) => [
      decl.tagName,
      {
        attributes: (decl.attributes ?? []).map((attr) => attr.name),
        events: (decl.events ?? []).map((event) => event.name),
      },
    ]),
  );
  expect(actual).toEqual(expected);
});
