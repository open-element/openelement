/**
 * zag-combobox-shared — imperative Zag Vanilla wiring shared by the
 * shadow/DSD (`zag-combobox`) and light-mode (`zag-combobox-light`) spike
 * islands built for issue #1149.
 *
 * v0.44 composition contract under test (ADR-0143):
 * - The COMPILED class owns the structure: render() lowers the static
 *   combobox markup (data-part nodes, items list) to a Part Program that the
 *   server serializer and the client claim/creation runtimes execute; the
 *   kernel owns the root.
 * - Zag owns state, keyboard, focus, ARIA, and collection behavior. The
 *   machine starts only after activation (the island classes call
 *   startZagCombobox from onDsdHydrated/onCsrRendered) and stops in
 *   disconnectedCallback. Updates reach the DOM through in-place
 *   spreadProps() diffing against the surviving nodes — never through a
 *   root replacement.
 * - Machine state lives here (a WeakMap keyed by host), because compiled
 *   classes may only carry @property fields + methods.
 * - Visuals consume Open Props scale values through --oe-* semantic tokens
 *   (mirroring third-party component package/src/open-props-tokens.css conventions), injected
 *   by the islands as a compiled static <style> node.
 *
 * Zag dependencies resolve through the ROOT deno.json import map — every
 * fixture gate (build, dev SSR, e2e) runs with the root config, and Vite
 * finds the packages in the root node_modules materialized by `deno install`.
 * No published package manifest references them.
 */

import * as combobox from '@zag-js/combobox';
import { normalizeProps, spreadProps, VanillaMachine } from '@zag-js/vanilla';
import { StyleSheet } from '@openelement/element';
import type { StyleSheetLike } from '@openelement/element';

export interface ComboboxItem {
  value: string;
  label: string;
  disabled?: boolean;
}

/** Cherry is intentionally disabled so the e2e spec can cover disabled options. */
export const COMBOBOX_ITEMS: ComboboxItem[] = [
  { value: 'apple', label: 'Apple' },
  { value: 'banana', label: 'Banana' },
  { value: 'cherry', label: 'Cherry', disabled: true },
  { value: 'mango', label: 'Mango' },
  { value: 'orange', label: 'Orange' },
];

export interface ZagComboboxSnapshot {
  value: string[];
  valueAsString: string;
  inputValue: string;
  open: boolean;
  highlightedValue: string | null;
  collectionValues: string[];
}

interface ZagComboboxBinding {
  /**
   * Controlled-prop update path: updateProps() -> subscribe -> spreadProps().
   * Sets value + inputValue together (Zag's documented controlled pattern).
   * Note: getInputProps spreads `defaultValue`, not live `value` — the DOM
   * input text follows on the machine's next syncInputValue transition
   * (open/close), which the e2e spec drives explicitly.
   */
  setControlledValue(value: string): void;
  /** Machine-state snapshot for assertions after controlled updates. */
  snapshot(): ZagComboboxSnapshot;
  /** onValueChange firings since start; the e2e spec uses it to detect duplicated listeners. */
  readonly selectionCount: number;
  stop(): void;
}

export interface StartZagComboboxOptions {
  /** Unique machine id; scopes every generated element id inside the scope root. */
  id: string;
  /** Form field name spread onto the input (light-mode form participation). */
  name?: string;
  items?: ComboboxItem[];
  /**
   * Where data-part nodes are queried: the island's ShadowRoot (shadow mode)
   * or the host element itself (light mode).
   */
  partsRoot: ParentNode;
  /**
   * Zag scope root for getElementById/activeElement resolution: the island
   * ShadowRoot for the shadow island; host.getRootNode() for the light island
   * (a ShadowRoot when nested in a page, the Document at top level).
   */
  getRootNode(): Document | ShadowRoot | Node;
}

/** One machine binding per host element; the compiled classes own the lifecycle calls. */
const bindings = new WeakMap<HTMLElement, ZagComboboxBinding>();

/** Start the machine against the host's (claimed or freshly created) DOM. Idempotent. */
export function startZagCombobox(host: HTMLElement, options: StartZagComboboxOptions): void {
  if (bindings.has(host)) return;
  const items = options.items ?? COMBOBOX_ITEMS;
  const { partsRoot } = options;

  // ADR-0142 composition: in-place activation preserves pre-upgrade input
  // values, so seed the machine from the live DOM. Without this, the first
  // spreadProps/syncInputValue pass would reset the input to '' and clobber
  // whatever the user typed before the island chunk loaded.
  const preUpgradeInputValue =
    partsRoot.querySelector<HTMLInputElement>('[data-part="input"]')?.value ?? '';

  let selectionCount = 0;
  // Typeahead filtering is consumer-owned in Zag: onInputValueChange swaps in
  // a filtered collection; renderParts then hides non-matching <li> nodes.
  let visibleItems = items;
  const makeCollection = (nextItems: ComboboxItem[]) =>
    combobox.collection<ComboboxItem>({
      items: nextItems,
      itemToValue: (item) => item.value,
      itemToString: (item) => item.label,
      isItemDisabled: (item) => item.disabled === true,
    });
  const machine = new VanillaMachine(combobox.machine, {
    id: options.id,
    name: options.name,
    collection: makeCollection(items),
    defaultInputValue: preUpgradeInputValue,
    getRootNode: () => options.getRootNode(),
    onValueChange(_details: { value: string[] }) {
      selectionCount += 1;
      // Cross-instance duplicate-listener probe for the e2e spec.
      const globalScope = globalThis as { __zagSelectCounts?: Record<string, number> };
      const counts = (globalScope.__zagSelectCounts ??= {});
      counts[options.id] = (counts[options.id] ?? 0) + 1;
    },
    onInputValueChange(details: { inputValue: string }) {
      const query = details.inputValue.trim().toLowerCase();
      visibleItems = query
        ? items.filter((item) => item.label.toLowerCase().includes(query))
        : items;
      machine.updateProps({ collection: makeCollection(visibleItems) });
    },
  });

  // spreadProps() diffs against the previous attrs per node (WeakMap-keyed),
  // so every notification patches the surviving SSR/CSR nodes in place. Only
  // the latest cleanup per node is retained for deterministic teardown.
  const cleanups = new Map<Element, () => void>();
  const spread = (el: Element | null, attrs: Record<string, unknown>): void => {
    if (!el) return;
    cleanups.set(el, spreadProps(el, attrs));
  };

  const renderParts = (): void => {
    const api = combobox.connect(machine.service, normalizeProps);
    spread(partsRoot.querySelector('[data-part="root"]'), api.getRootProps());
    spread(partsRoot.querySelector('[data-part="label"]'), api.getLabelProps());
    spread(partsRoot.querySelector('[data-part="control"]'), api.getControlProps());
    spread(partsRoot.querySelector('[data-part="input"]'), api.getInputProps());
    spread(partsRoot.querySelector('[data-part="trigger"]'), api.getTriggerProps());
    spread(partsRoot.querySelector('[data-part="positioner"]'), api.getPositionerProps());
    spread(partsRoot.querySelector('[data-part="content"]'), api.getContentProps());
    for (const item of items) {
      const el = partsRoot.querySelector<HTMLElement>(
        `[data-part="item"][data-value="${item.value}"]`,
      );
      if (!el) continue;
      if (!visibleItems.includes(item)) {
        // Filtered out by typeahead: hide and drop the stale spread listeners.
        cleanups.get(el)?.();
        cleanups.delete(el);
        el.hidden = true;
        continue;
      }
      el.hidden = false;
      cleanups.set(el, spreadProps(el, api.getItemProps({ item })));
    }
  };

  const unsubscribe = machine.subscribe(renderParts);
  machine.start();
  // start() publishes synchronously in 1.43.3; the explicit pass keeps the
  // wiring correct even if a future Zag version defers the initial notify.
  renderParts();

  // ADR-0142 composition seam: in-place activation preserves a focus that
  // PREDATES the machine, so no focus event will ever fire for it and the
  // machine would sit in 'idle' ignoring INPUT.CHANGE (idle has no such
  // transition). Sync the machine with the DOM reality at start.
  const scopeRoot = options.getRootNode();
  const activeElement = (scopeRoot as Document | ShadowRoot).activeElement;
  if (activeElement && activeElement === partsRoot.querySelector('[data-part="input"]')) {
    machine.send({ type: 'INPUT.FOCUS' });
  }

  bindings.set(host, {
    setControlledValue(value: string): void {
      const item = items.find((candidate) => candidate.value === value);
      machine.updateProps({ value: [value], inputValue: item?.label ?? value });
    },
    snapshot() {
      const api = combobox.connect(machine.service, normalizeProps);
      return {
        value: [...api.value],
        valueAsString: api.valueAsString,
        inputValue: api.inputValue,
        open: api.open,
        highlightedValue: api.highlightedValue,
        collectionValues: api.collection.getValues(),
      };
    },
    get selectionCount(): number {
      return selectionCount;
    },
    stop(): void {
      unsubscribe();
      for (const cleanup of cleanups.values()) cleanup();
      cleanups.clear();
      machine.stop();
    },
  });
}

/** Stop the machine bound to the host (called from disconnectedCallback). */
export function stopZagCombobox(host: HTMLElement): void {
  const binding = bindings.get(host);
  if (!binding) return;
  bindings.delete(host);
  binding.stop();
}

/** e2e hook for the controlled-prop evidence path (machine.updateProps). */
export function zagComboboxSetControlledValue(host: HTMLElement, value: string): void {
  bindings.get(host)?.setControlledValue(value);
}

/** e2e hook: machine-state snapshot after controlled updates. */
export function zagComboboxSnapshot(host: HTMLElement): ZagComboboxSnapshot | null {
  return bindings.get(host)?.snapshot() ?? null;
}

// ─── Island styles (consumed via the compiled `static styles` contract) ────

/**
 * Open Props scale subset + --oe-* semantic tokens (values mirror
 * third-party component package/src/open-props-tokens.css). Built here (a non-compiled module)
 * because compiled classes ban runtime top-level statements; the islands
 * reference the sheets through `static styles` — adoptedStyleSheets on the
 * shadow island, the document-head compiled-style sink on the light island
 * (light mode shares the page's tree).
 */
export function buildComboboxSheet(hostSelector: string): StyleSheetLike {
  const sheet: StyleSheetLike = new StyleSheet();
  sheet.replaceSync(`${hostSelector} {
  /* Open Props scale subset */
  --size-1: 4px;
  --size-2: 8px;
  --size-3: 12px;
  --gray-0: #f8f9fa;
  --gray-1: #f1f3f5;
  --gray-3: #dee2e6;
  --gray-7: #495057;
  --gray-9: #212529;
  --blue-1: #e7f0fd;
  --blue-6: #228be6;
  --radius-1: 6px;
  --border-size-1: 1px;

  /* --oe-* semantic tokens */
  --oe-bg-surface: var(--gray-0);
  --oe-bg-control: #ffffff;
  --oe-text: var(--gray-9);
  --oe-text-muted: var(--gray-7);
  --oe-border: var(--gray-3);
  --oe-accent: var(--blue-6);
  --oe-highlight-bg: var(--blue-1);

  display: block;
  font-family: system-ui, sans-serif;
  color: var(--oe-text);
}

.zag-combobox {
  display: grid;
  gap: var(--size-1);
  max-width: 320px;
}

.zag-combobox-label {
  font-size: 14px;
  color: var(--oe-text-muted);
}

.zag-combobox-control {
  display: flex;
  gap: var(--size-1);
}

.zag-combobox-input {
  flex: 1;
  padding: var(--size-2) var(--size-3);
  border: var(--border-size-1) solid var(--oe-border);
  border-radius: var(--radius-1);
  background: var(--oe-bg-control);
  color: var(--oe-text);
}

.zag-combobox-input:focus {
  outline: 2px solid var(--oe-accent);
  outline-offset: 1px;
}

.zag-combobox-trigger {
  padding: var(--size-2) var(--size-3);
  border: var(--border-size-1) solid var(--oe-border);
  border-radius: var(--radius-1);
  background: var(--oe-bg-surface);
}

.zag-combobox-content {
  list-style: none;
  margin: 0;
  padding: var(--size-1);
  border: var(--border-size-1) solid var(--oe-border);
  border-radius: var(--radius-1);
  background: var(--oe-bg-control);
}

.zag-combobox-item {
  padding: var(--size-2) var(--size-3);
  border-radius: var(--radius-1);
  cursor: pointer;
}

.zag-combobox-item[data-highlighted] {
  background: var(--oe-highlight-bg);
}

.zag-combobox-item[data-disabled] {
  color: var(--oe-text-muted);
  cursor: not-allowed;
}`);
  return sheet;
}

/** Shared sheets: one per root scope contract (shadow :host / light class). */
export const zagComboboxShadowStyles: StyleSheetLike[] = [buildComboboxSheet(':host')];
export const zagComboboxLightStyles: StyleSheetLike[] = [
  buildComboboxSheet('.zag-combobox-light'),
];

// ─── Compiled-kernel ownership: hand the structure back pristine ───────────

/**
 * The compiled claim is strict (fail-closed): on reconnect it validates the
 * program's static structure, including exact attribute sets. Zag's
 * spreadProps() mutations (role, ARIA attributes, id, data-state, and the
 * reflected `hidden` on filtered items) are therefore removed on disconnect so a moved
 * or reconnected island re-claims cleanly and the machine restarts on the
 * pristine compiled DOM. Attribute contract mirrors the islands' static
 * markup — keep them in sync.
 */
const STATIC_ATTRS_BY_PART: Record<string, Record<string, string>> = {
  root: { class: 'zag-combobox', 'data-part': 'root' },
  label: { class: 'zag-combobox-label', 'data-part': 'label' },
  control: { class: 'zag-combobox-control', 'data-part': 'control' },
  input: {
    class: 'zag-combobox-input',
    'data-part': 'input',
    type: 'text',
    placeholder: 'Type or pick a fruit',
    autocomplete: 'off',
  },
  trigger: { class: 'zag-combobox-trigger', 'data-part': 'trigger', type: 'button' },
  positioner: { class: 'zag-combobox-positioner', 'data-part': 'positioner' },
  content: { class: 'zag-combobox-content', 'data-part': 'content' },
};

const ITEM_STATIC_ATTRS = ['class', 'data-part', 'data-value', 'data-disabled'];

function restoreAttributes(el: Element, expected: Record<string, string>): void {
  for (const name of el.getAttributeNames()) {
    if (!(name in expected)) el.removeAttribute(name);
  }
  for (const [name, value] of Object.entries(expected)) {
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  }
}

/** Restore the compiled static structure under a Zag-bound parts root. */
export function resetZagComboboxDom(partsRoot: ParentNode): void {
  for (const [part, attrs] of Object.entries(STATIC_ATTRS_BY_PART)) {
    const el = partsRoot.querySelector(`[data-part="${part}"]`);
    if (el) restoreAttributes(el, attrs);
  }
  for (const el of partsRoot.querySelectorAll('[data-part="item"]')) {
    for (const name of el.getAttributeNames()) {
      if (!ITEM_STATIC_ATTRS.includes(name)) el.removeAttribute(name);
    }
    if ((el as HTMLElement).hidden) (el as HTMLElement).hidden = false;
  }
}
