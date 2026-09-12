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
import { assert, assertEquals, assertNotEquals, assertStringIncludes } from '@std/assert';
import {
  dialogWith,
  fakeDialog,
  installDomHarness,
  installThemeGlobals,
  themeHarness,
} from './harness.ts';

installDomHarness();

// deno-lint-ignore no-explicit-any
type AnyComponent = any;

// ─── open-button: click/form choreography (#637, #757) ──────────────────────

Deno.test('open-button: click dispatches open-click and submits an associated form', async () => {
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
  assert(openClickSeen, 'open-click must fire');
  assertEquals(events, ['submit', 'requestSubmit']);
});

Deno.test('open-button: a prevented submit skips requestSubmit', async () => {
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
  assertEquals(events, ['submit']);
});

Deno.test('open-button: type=reset resets the form; anchor branch never touches forms (#637)', async () => {
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
  assertEquals(events, ['reset']);

  // Anchor branch: navigation control, not a form control.
  const anchor = new (OpenButton as unknown as new () => AnyComponent)();
  anchor.closest = () => fakeForm;
  anchor.href = '/go';
  anchor.type = 'submit';
  anchor.handleClick(new Event('click'));
  assertEquals(events, ['reset']);
});

Deno.test('open-button: disabled click prevents default and fires nothing (#757)', async () => {
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
  assertEquals(openClickSeen, false);
  assertEquals(submits.length, 0);
  assertEquals(event.defaultPrevented, true);
});

// ─── open-dialog: top-layer state machine (#1030) ────────────────────────────

Deno.test('open-dialog: show/close/toggle manage the open property', async () => {
  const el = await dialogWith(fakeDialog());
  el.show();
  assertEquals(el.open, true);
  el.close();
  assertEquals(el.open, false);
  el.toggle();
  assertEquals(el.open, true);
});

Deno.test('open-dialog: modal open closes the attribute-driven open, then showModal (#1030)', async () => {
  const fake = fakeDialog();
  const el = await dialogWith(fake);
  el.open = true;
  el.onDsdHydrated();
  // The bool sink (compiled) marks dialog.open; the sync closes that state and
  // enters the top layer via showModal exactly once per open session.
  assertEquals(fake.calls.includes('showModal'), true);
});

Deno.test('open-dialog: non-modal mode uses show() only', async () => {
  const fake = fakeDialog();
  const el = await dialogWith(fake, 'non-modal');
  el.open = true;
  el.onCsrRendered();
  assertEquals(fake.calls, ['show']);
  assertEquals(fake.calls.includes('showModal'), false);
});

Deno.test('open-dialog: close dispatches open-dialog-close; cancel prevents default first', async () => {
  const el = await dialogWith(fakeDialog());
  let closes = 0;
  el.addEventListener('open-dialog-close', () => {
    closes++;
  });
  const cancel = new Event('cancel', { cancelable: true });
  el.handleCancel(cancel);
  assertEquals(cancel.defaultPrevented, true);
  assertEquals(closes, 1);
  assertEquals(el.open, false);
});

Deno.test('open-dialog: modal close restores the sink-removed open attribute before close() (#1226)', async () => {
  const fake = fakeDialog();
  const el = await dialogWith(fake);
  el.open = true;
  el.onDsdHydrated();
  assertEquals(fake.calls.includes('showModal'), true);
  // The compiled bool sink may remove the inner `open` attribute before the
  // component's sync runs; per spec close() is then a no-op and the dialog
  // stays :modal forever. The sync must restore the attribute first.
  fake.open = false;
  fake.calls.length = 0;
  el.open = false;
  el.syncDialogElement();
  assertEquals(fake.calls, ['setAttribute:open', 'close']);
  assertEquals(fake.open, false);
});

Deno.test('open-dialog: the native close echo of a programmatic close does not re-dispatch (#1226)', async () => {
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
  assertEquals(closes, 1);
  // The inner dialog's native close event arrives after the programmatic
  // close; the session already fired its event.
  fake.open = false;
  el.handleNativeClose();
  assertEquals(closes, 1);
  // A genuine native close (e.g. form method="dialog") with the session
  // still open still dispatches exactly once.
  el.open = true;
  fake.open = false;
  el.handleNativeClose();
  assertEquals(closes, 2);
  assertEquals(el.open, false);
});

// ─── open-input: value channel + events ──────────────────────────────────────

Deno.test('open-input: input events write the value attribute and dispatch open-input/open-change', async () => {
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
  assertEquals(el.getAttribute('value'), 'abc');
  assertEquals(seen, [{ type: 'input', value: 'abc' }, { type: 'change', value: 'abc' }]);
});

Deno.test('open-input: activation assigns realm-unique control ids', async () => {
  const { OpenInput } = await import('../src/open-input.tsx');
  const first = new (OpenInput as unknown as new () => AnyComponent)();
  const second = new (OpenInput as unknown as new () => AnyComponent)();
  assertEquals(first.inputId, '');
  first.onCsrRendered();
  second.onCsrRendered();
  assertNotEquals(first.inputId, second.inputId);
  assertStringIncludes(first.inputId, 'input-');
});

Deno.test('open-input: formResetCallback clears value and error attributes', async () => {
  const { OpenInput } = await import('../src/open-input.tsx');
  const el = new (OpenInput as unknown as new () => AnyComponent)();
  el.setAttribute('value', 'x');
  el.setAttribute('error', 'bad');
  el.formResetCallback();
  assertEquals(el.getAttribute('value'), '');
  assertEquals(el.hasAttribute('error'), false);
});

Deno.test('open-input: formDisabledCallback mirrors onto the property, never the attribute (#1226)', async () => {
  const { OpenInput } = await import('../src/open-input.tsx');
  const el = new (OpenInput as unknown as new () => AnyComponent)();
  el.formDisabledCallback(true);
  assertEquals(el.disabled, true);
  // The platform counts a form-associated custom element's own `disabled`
  // attribute toward its disabledness: writing it would make the
  // fieldset-driven state irreversible.
  assertEquals(el.hasAttribute('disabled'), false);
  el.formDisabledCallback(false);
  assertEquals(el.disabled, false);
});

// ─── open-theme-toggle: initialization priority + persistence policy (#804) ──

Deno.test('open-theme-toggle: init follows attribute > document > storage > media priority', async () => {
  const { OpenThemeToggle } = await import('../src/open-theme-toggle.tsx');
  const withAttr = new (OpenThemeToggle as unknown as new () => AnyComponent)();
  const attrHarness = themeHarness({ savedTheme: 'dark', mediaLight: false });
  installThemeGlobals(attrHarness);
  withAttr.setAttribute('theme', 'light');
  withAttr.initTheme();
  assertEquals(withAttr.theme, 'light');

  const withDoc = new (OpenThemeToggle as unknown as new () => AnyComponent)();
  installThemeGlobals(themeHarness({ docTheme: 'light' }));
  withDoc.initTheme();
  assertEquals(withDoc.theme, 'light');

  const withStorage = new (OpenThemeToggle as unknown as new () => AnyComponent)();
  installThemeGlobals(themeHarness({ savedTheme: 'dark' }));
  withStorage.initTheme();
  assertEquals(withStorage.theme, 'dark');

  const withMedia = new (OpenThemeToggle as unknown as new () => AnyComponent)();
  installThemeGlobals(themeHarness({ mediaLight: true }));
  withMedia.initTheme();
  assertEquals(withMedia.theme, 'light');
});

Deno.test('open-theme-toggle: init never persists; explicit toggle persists and dispatches (#804)', async () => {
  const { OpenThemeToggle } = await import('../src/open-theme-toggle.tsx');
  const harness = themeHarness({ savedTheme: 'dark' });
  installThemeGlobals(harness);
  const el = new (OpenThemeToggle as unknown as new () => AnyComponent)();
  el.initTheme();
  assertEquals(harness.writes, [], 'init path must not write localStorage');

  el.handleToggle();
  assertEquals(el.theme, 'light');
  assertEquals(harness.writes, ['light']);
  assertEquals(harness.dispatched.includes('open:theme-change'), true);
});

// ─── open-tabs: WAI-ARIA keyboard pattern ────────────────────────────────────

function tabsWith(count: number) {
  return (async () => {
    const { OpenTabs } = await import('../src/open-tabs.tsx');
    const el = new (OpenTabs as unknown as new () => AnyComponent)();
    const tabs = Array.from({ length: count }, () => ({
      focused: false,
      focus() {
        this.focused = true;
      },
      addEventListener: () => {},
      setAttribute: () => {},
      removeAttribute: () => {},
      classList: { toggle: () => false },
    }));
    el.querySelectorAll = (selector: string) =>
      (selector === '[slot="tab"]' ? tabs : tabs) as unknown as NodeListOf<Element>;
    return { el, tabs };
  })();
}

Deno.test('open-tabs: ArrowRight/Left wrap, Home/End jump, focus follows selection', async () => {
  const { el, tabs } = await tabsWith(3);
  const key = (k: string) =>
    el.onKeydown({ key: k, preventDefault: () => {} } as unknown as KeyboardEvent);
  key('ArrowRight');
  assertEquals(el.active, 1);
  key('ArrowRight');
  assertEquals(el.active, 2);
  key('ArrowRight');
  assertEquals(el.active, 0, 'ArrowRight wraps');
  key('ArrowLeft');
  assertEquals(el.active, 2, 'ArrowLeft wraps backwards');
  key('End');
  assertEquals(el.active, 2);
  key('Home');
  assertEquals(el.active, 0);
  assertEquals(tabs[0].focused, true, 'selection moves DOM focus');
});

// ─── open-dropdown: pointerdown popover guard + per-instance anchor (#1061) ──

Deno.test('open-dropdown: click toggles the native popover; pointerdown on an open popover swallows the re-open', async () => {
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
  assertEquals(state.open, true);

  // A mouse press on the trigger while open records the state; the click that
  // follows the native light-dismiss must not re-open the popover.
  state.open = false;
  state.toggles = 0;
  el.onTriggerPointerDown();
  // (pointerdown saw the popover closed, so the click toggles normally.)
  el.toggle();
  assertEquals(state.toggles, 1);

  state.open = true;
  el.onTriggerPointerDown();
  el.toggle();
  assertEquals(state.toggles, 1, 'the post-pointerdown click is swallowed');
});

Deno.test('open-dropdown: activation assigns realm-unique anchor names to both halves', async () => {
  const { OpenDropdown } = await import('../src/open-dropdown.tsx');
  const first = new (OpenDropdown as unknown as new () => AnyComponent)();
  const second = new (OpenDropdown as unknown as new () => AnyComponent)();
  first.onCsrRendered();
  second.onCsrRendered();
  assertNotEquals(first.anchorName, second.anchorName);
  assertStringIncludes(first.anchorName, '--open-dropdown-trigger-');
});

// ─── open-code-block: copy feedback contract ─────────────────────────────────

Deno.test('open-code-block: copy success and failure drive the compiled label sink', async () => {
  const { OpenCodeBlock } = await import('../src/open-code-block.tsx');
  const originalClipboard = (globalThis as { navigator?: unknown }).navigator;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: { writeText: () => Promise.resolve() } },
  });
  try {
    const el = new (OpenCodeBlock as unknown as new () => AnyComponent)();
    await el.copy();
    assertEquals(el.copyLabel, 'Copied!');
  } finally {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: originalClipboard,
    });
  }
});

Deno.test('open-code-block: failed clipboard write shows Failed', async () => {
  const { OpenCodeBlock } = await import('../src/open-code-block.tsx');
  const originalNavigator = (globalThis as { navigator?: unknown }).navigator;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: { writeText: () => Promise.reject(new Error('denied')) } },
  });
  try {
    const el = new (OpenCodeBlock as unknown as new () => AnyComponent)();
    await el.copy();
    assertEquals(el.copyLabel, 'Failed');
  } finally {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: originalNavigator,
    });
  }
});

// ─── package manifest: the consumer-facing attribute/event contract ──────────
// adapter-vite derives island metadata from manifest.declarations (WC Package
// Protocol); a drifted declaration silently miscompiles consumer pages.

Deno.test("manifest: every declaration carries the component's published attributes and events", async () => {
  const { manifest } = await import('../src/index.ts');
  const expected: Record<string, { attributes: string[]; events: string[] }> = {
    'open-card': { attributes: ['variant'], events: [] },
    'open-callout': { attributes: ['type', 'label'], events: [] },
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
    'open-badge': { attributes: ['tone', 'size'], events: [] },
    'open-dialog': { attributes: ['open', 'label'], events: ['open-dialog-close'] },
    'open-dropdown': { attributes: [], events: [] },
    'open-tabs': { attributes: [], events: [] },
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
  assertEquals(actual, expected);
});
