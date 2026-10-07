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
import {
  dialogWith,
  fakeDialog,
  installDomHarness,
  installThemeGlobals,
  themeHarness,
} from './harness.ts';

installDomHarness();

// oxlint-disable-next-line no-explicit-any
type AnyComponent = any;

// ─── open-button: click/form choreography (#637, #757) ──────────────────────

test('open-button: click dispatches open-click and submits an associated form', async () => {
  const { OpenButton } = await import('../src/open-button.tsx');
  const btn = new (OpenButton as unknown as new () => AnyComponent)();

  const events: string[] = [];
  const fakeForm = {
    tagName: 'FORM',
    dispatchEvent: (e: Event) => {
      events.push(e.type);
      return true;
    },
    reset: () => events.push('reset'),
    requestSubmit: () => events.push('requestSubmit'),
  };
  let openClickSeen = false;
  btn.addEventListener('open-click', () => {
    openClickSeen = true;
  });
  btn.closest = () => fakeForm;
  btn.type = 'submit';
  btn.handleClick(new Event('click'));
  expect(openClickSeen, 'open-click must fire').toBeTruthy();
  expect(events).toEqual(['submit', 'requestSubmit']);
});

test('open-button: a prevented submit skips requestSubmit', async () => {
  const { OpenButton } = await import('../src/open-button.tsx');
  const btn = new (OpenButton as unknown as new () => AnyComponent)();
  const events: string[] = [];
  const fakeForm = {
    tagName: 'FORM',
    dispatchEvent: (e: Event) => {
      e.preventDefault();
      events.push(e.type);
      return true;
    },
    reset: () => events.push('reset'),
    requestSubmit: () => events.push('requestSubmit'),
  };
  btn.closest = () => fakeForm;
  btn.type = 'submit';
  btn.handleClick(new Event('click'));
  expect(events).toEqual(['submit']);
});

test('open-button: type=reset resets the form; anchor branch never touches forms (#637)', async () => {
  const { OpenButton } = await import('../src/open-button.tsx');
  const btn = new (OpenButton as unknown as new () => AnyComponent)();
  const events: string[] = [];
  const fakeForm = {
    tagName: 'FORM',
    dispatchEvent: (e: Event) => {
      events.push(e.type);
      return true;
    },
    reset: () => events.push('reset'),
    requestSubmit: () => events.push('requestSubmit'),
  };
  btn.closest = () => fakeForm;
  btn.type = 'reset';
  btn.handleClick(new Event('click'));
  expect(events).toEqual(['reset']);

  // Anchor branch: navigation control, not a form control.
  const anchor = new (OpenButton as unknown as new () => AnyComponent)();
  anchor.closest = () => fakeForm;
  anchor.href = '/go';
  anchor.type = 'submit';
  anchor.handleClick(new Event('click'));
  expect(events).toEqual(['reset']);
});

test('open-button: disabled click prevents default and fires nothing (#757)', async () => {
  const { OpenButton } = await import('../src/open-button.tsx');
  const btn = new (OpenButton as unknown as new () => AnyComponent)();
  let openClickSeen = false;
  btn.addEventListener('open-click', () => {
    openClickSeen = true;
  });
  const submits: string[] = [];
  btn.closest = () => ({
    dispatchEvent: (e: Event) => {
      submits.push(e.type);
      return true;
    },
    reset: () => {},
    requestSubmit: () => {},
  });
  btn.disabled = true;
  btn.type = 'submit';
  const event = new Event('click', { cancelable: true });
  btn.handleClick(event);
  expect(openClickSeen).toEqual(false);
  expect(submits.length).toEqual(0);
  expect(event.defaultPrevented).toEqual(true);
});

// ─── open-dialog: top-layer state machine (#1030) ────────────────────────────

test('open-dialog: show/close/toggle manage the open property', async () => {
  const el = await dialogWith(fakeDialog());
  el.show();
  expect(el.open).toEqual(true);
  el.close();
  expect(el.open).toEqual(false);
  el.toggle();
  expect(el.open).toEqual(true);
});

test('open-dialog: modal open closes the attribute-driven open, then showModal (#1030)', async () => {
  const fake = fakeDialog();
  const el = await dialogWith(fake);
  el.open = true;
  el.onDsdHydrated();
  // The bool sink (compiled) marks dialog.open; the sync closes that state and
  // enters the top layer via showModal exactly once per open session.
  expect(fake.calls.includes('showModal')).toEqual(true);
});

test('open-dialog: non-modal mode uses show() only', async () => {
  const fake = fakeDialog();
  const el = await dialogWith(fake, 'non-modal');
  el.open = true;
  el.onCsrRendered();
  expect(fake.calls).toEqual(['show']);
  expect(fake.calls.includes('showModal')).toEqual(false);
});

test('open-dialog: close dispatches open-dialog-close; cancel prevents default first', async () => {
  const el = await dialogWith(fakeDialog());
  let closes = 0;
  el.addEventListener('open-dialog-close', () => {
    closes++;
  });
  const cancel = new Event('cancel', { cancelable: true });
  el.handleCancel(cancel);
  expect(cancel.defaultPrevented).toEqual(true);
  expect(closes).toEqual(1);
  expect(el.open).toEqual(false);
});

test('open-dialog: modal close restores the sink-removed open attribute before close() (#1226)', async () => {
  const fake = fakeDialog();
  const el = await dialogWith(fake);
  el.open = true;
  el.onDsdHydrated();
  expect(fake.calls.includes('showModal')).toEqual(true);
  // The compiled bool sink may remove the inner `open` attribute before the
  // component's sync runs; per spec close() is then a no-op and the dialog
  // stays :modal forever. The sync must restore the attribute first.
  fake.open = false;
  fake.calls.length = 0;
  el.open = false;
  el.syncDialogElement();
  expect(fake.calls).toEqual(['setAttribute:open', 'close']);
  expect(fake.open).toEqual(false);
});

test('open-dialog: the native close echo of a programmatic close does not re-dispatch (#1226)', async () => {
  const fake = fakeDialog();
  const el = await dialogWith(fake);
  let closes = 0;
  el.addEventListener('open-dialog-close', () => {
    closes++;
  });
  el.open = true;
  el.onDsdHydrated();
  // The user-facing close path (close button / cancel) fires the event.
  el.handleCancel(new Event('cancel', { cancelable: true }));
  expect(closes).toEqual(1);
  // The inner dialog's native close event arrives after the programmatic
  // close; the session already fired its event.
  fake.open = false;
  el.handleNativeClose();
  expect(closes).toEqual(1);
  // A genuine native close (e.g. form method="dialog") with the session
  // still open still dispatches exactly once.
  el.open = true;
  fake.open = false;
  el.handleNativeClose();
  expect(closes).toEqual(2);
  expect(el.open).toEqual(false);
});

// ─── open-input: value channel + events ──────────────────────────────────────

test('open-input: input events write the value attribute and dispatch open-input/open-change', async () => {
  const { OpenInput } = await import('../src/open-input.tsx');
  const el = new (OpenInput as unknown as new () => AnyComponent)();
  const seen: Array<Record<string, unknown>> = [];
  el.addEventListener('open-input', (e: Event) => {
    seen.push({ type: 'input', value: (e as CustomEvent).detail.value });
  });
  el.addEventListener('open-change', (e: Event) => {
    seen.push({ type: 'change', value: (e as CustomEvent).detail.value });
  });
  el.handleInput({ target: { value: 'abc' } } as unknown as Event);
  el.handleChange({ target: { value: 'abc' } } as unknown as Event);
  expect(el.getAttribute('value')).toEqual('abc');
  expect(seen).toEqual([
    { type: 'input', value: 'abc' },
    { type: 'change', value: 'abc' },
  ]);
});

test('open-input: activation assigns realm-unique control ids', async () => {
  const { OpenInput } = await import('../src/open-input.tsx');
  const first = new (OpenInput as unknown as new () => AnyComponent)();
  const second = new (OpenInput as unknown as new () => AnyComponent)();
  expect(first.inputId).toEqual('');
  first.onCsrRendered();
  second.onCsrRendered();
  expect(first.inputId).not.toEqual(second.inputId);
  expect(first.inputId).toContain('input-');
});

test('open-input: formResetCallback clears value and error attributes', async () => {
  const { OpenInput } = await import('../src/open-input.tsx');
  const el = new (OpenInput as unknown as new () => AnyComponent)();
  el.setAttribute('value', 'x');
  el.setAttribute('error', 'bad');
  el.formResetCallback();
  expect(el.getAttribute('value')).toEqual('');
  expect(el.hasAttribute('error')).toEqual(false);
});

test('open-input: formDisabledCallback mirrors onto the property, never the attribute (#1226)', async () => {
  const { OpenInput } = await import('../src/open-input.tsx');
  const el = new (OpenInput as unknown as new () => AnyComponent)();
  el.formDisabledCallback(true);
  expect(el.disabled).toEqual(true);
  // The platform counts a form-associated custom element's own `disabled`
  // attribute toward its disabledness: writing it would make the
  // fieldset-driven state irreversible.
  expect(el.hasAttribute('disabled')).toEqual(false);
  el.formDisabledCallback(false);
  expect(el.disabled).toEqual(false);
});

// ─── open-theme-toggle: initialization priority + persistence policy (#804) ──

test('open-theme-toggle: init follows attribute > document > storage > media priority', async () => {
  const { OpenThemeToggle } = await import('../src/open-theme-toggle.tsx');
  const withAttr = new (OpenThemeToggle as unknown as new () => AnyComponent)();
  const attrHarness = themeHarness({ savedTheme: 'dark', mediaLight: false });
  installThemeGlobals(attrHarness);
  withAttr.setAttribute('theme', 'light');
  withAttr.initTheme();
  expect(withAttr.theme).toEqual('light');

  const withDoc = new (OpenThemeToggle as unknown as new () => AnyComponent)();
  installThemeGlobals(themeHarness({ docTheme: 'light' }));
  withDoc.initTheme();
  expect(withDoc.theme).toEqual('light');

  const withStorage = new (OpenThemeToggle as unknown as new () => AnyComponent)();
  installThemeGlobals(themeHarness({ savedTheme: 'dark' }));
  withStorage.initTheme();
  expect(withStorage.theme).toEqual('dark');

  const withMedia = new (OpenThemeToggle as unknown as new () => AnyComponent)();
  installThemeGlobals(themeHarness({ mediaLight: true }));
  withMedia.initTheme();
  expect(withMedia.theme).toEqual('light');
});

test('open-theme-toggle: init never persists; explicit toggle persists and dispatches (#804)', async () => {
  const { OpenThemeToggle } = await import('../src/open-theme-toggle.tsx');
  const harness = themeHarness({ savedTheme: 'dark' });
  installThemeGlobals(harness);
  const el = new (OpenThemeToggle as unknown as new () => AnyComponent)();
  el.initTheme();
  expect(harness.writes, 'init path must not write localStorage').toEqual([]);

  el.handleToggle();
  expect(el.theme).toEqual('light');
  expect(harness.writes).toEqual(['light']);
  expect(harness.dispatched.includes('open:theme-change')).toEqual(true);
});

// ─── open-dropdown: pointerdown popover guard + per-instance anchor (#1061) ──

test('open-dropdown: click toggles the native popover; pointerdown on an open popover swallows the re-open', async () => {
  const { OpenDropdown } = await import('../src/open-dropdown.tsx');
  const el = new (OpenDropdown as unknown as new () => AnyComponent)();
  const state = { open: false, toggles: 0 };
  const content = {
    matches: (selector: string) => selector === ':popover-open' && state.open,
    togglePopover: () => {
      state.open = !state.open;
      state.toggles++;
    },
  };
  el.shadowRoot = { querySelector: () => content };

  // Plain click toggles open.
  el.toggle();
  expect(state.open).toEqual(true);

  // A mouse press on the trigger while open records the state; the click that
  // follows the native light-dismiss must not re-open the popover.
  state.open = false;
  state.toggles = 0;
  el.onTriggerPointerDown();
  // (pointerdown saw the popover closed, so the click toggles normally.)
  el.toggle();
  expect(state.toggles).toEqual(1);

  state.open = true;
  el.onTriggerPointerDown();
  el.toggle();
  expect(state.toggles, 'the post-pointerdown click is swallowed').toEqual(1);
});

test('open-dropdown: activation assigns realm-unique anchor names to both halves', async () => {
  const { OpenDropdown } = await import('../src/open-dropdown.tsx');
  const first = new (OpenDropdown as unknown as new () => AnyComponent)();
  const second = new (OpenDropdown as unknown as new () => AnyComponent)();
  first.onCsrRendered();
  second.onCsrRendered();
  expect(first.anchorName).not.toEqual(second.anchorName);
  expect(first.anchorName).toContain('--open-dropdown-trigger-');
});

// ─── open-code-block: copy feedback contract ─────────────────────────────────

test('open-code-block: copy success and failure drive the compiled label sink', async () => {
  const { OpenCodeBlock } = await import('../src/open-code-block.tsx');
  const originalClipboard = (globalThis as { navigator?: unknown }).navigator;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: { writeText: () => Promise.resolve() } },
  });
  try {
    const el = new (OpenCodeBlock as unknown as new () => AnyComponent)();
    await el.copy();
    expect(el.copyLabel).toEqual('Copied!');
  } finally {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: originalClipboard,
    });
  }
});

test('open-code-block: failed clipboard write shows Failed', async () => {
  const { OpenCodeBlock } = await import('../src/open-code-block.tsx');
  const originalNavigator = (globalThis as { navigator?: unknown }).navigator;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: { writeText: () => Promise.reject(new Error('denied')) } },
  });
  try {
    const el = new (OpenCodeBlock as unknown as new () => AnyComponent)();
    await el.copy();
    expect(el.copyLabel).toEqual('Failed');
  } finally {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: originalNavigator,
    });
  }
});

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
