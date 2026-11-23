/**
 * zag-combobox-shared — imperative Zag Vanilla wiring shared by the
 * shadow/DSD (`zag-combobox`) and light-mode (`zag-combobox-light`) spike
 * islands built for issue #1149.
 *
 * GENERATED lane (F16: class → function). v0.44 composition contract under
 * test (ADR-0143):
 * - The COMPILED component owns the structure: the generated leaf lowers the
 *   static combobox markup (data-part nodes, items list) to a program that the
 *   server serializer and the client claim/creation runtimes execute; the
 *   kernel owns the root.
 * - Zag owns state, keyboard, focus, ARIA, and collection behavior. This module
 *   helper (the `copy-feedback.ts` / `dialog-machine.ts` shape) owns the
 *   machine and takes the host explicitly; the islands drive it from the
 *   generated lane's lifecycle intrinsics. The machine starts one macrotask
 *   after `onConnect` — the replay runs in the mount/claim PROLOGUE, before the
 *   claimed/created region exists (`16b-migration-note` R2) and before the
 *   strict claim has validated the static attribute set, so starting earlier
 *   would both query an empty tree and make Zag's attribute writes a claim
 *   mismatch. It stops from the `onConnect` cleanup, which runs at that
 *   disconnection. Updates reach the DOM through in-place spreadProps()
 *   diffing against the surviving nodes — never through a root replacement.
 * - Machine state lives HERE, not on the element: the generated lane has no
 *   authored-field capability, so the host surface is the sidecar's DECLARED
 *   property rows (see `ZagComboboxHost`). The two e2e hooks the class spelled
 *   as instance methods (`demoSetControlledValue` / `demoSnapshot`) are those
 *   rows: `controlledValue` is written by the spec and drives
 *   `machine.updateProps`, `machineSnapshot` is written back by the machine on
 *   every publish so the spec can read the state it used to return.
 * - Visuals consume Open Props scale values through --oe-* semantic tokens
 *   (mirroring the @openelement/ui semantic-tokens.css conventions), declared
 *   through the islands' sidecar `styles` list.
 *
 * Zag dependencies resolve from this fixture's own package.json (`@zag-js/*`
 * pins) through the workspace node_modules; no published openElement package
 * manifest references them.
 */

import * as combobox from '@zag-js/combobox';
import { normalizeProps, spreadProps, VanillaMachine } from '@zag-js/vanilla';

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

/**
 * The host surface these helpers drive: the islands' sidecar `properties` rows,
 * which are the generated element's whole authored host API (no authored
 * methods exist in this lane).
 */
export interface ZagComboboxHost extends HTMLElement {
  /** The class's `@property({ reflect: false }) machineId` — attribute-backed. */
  machineId: string;
  /** Write-to-drive channel for the controlled-prop evidence path. */
  controlledValue: string;
  /** Machine-state snapshot the machine writes back on every publish. */
  machineSnapshot: string;
}

/**
 * Which root the island declared in its sidecar. The shadow variant queries its
 * own ShadowRoot; the light variant queries the host itself and scopes Zag by
 * `host.getRootNode()`. The caller passes the same fact its sidecar declares.
 */
export type ZagComboboxRoot = 'shadow' | 'light';

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

/** One machine binding per host element; the islands' connect cleanup owns the lifecycle calls. */
const bindings = new WeakMap<HTMLElement, ZagComboboxBinding>();

/** Start the machine against the host's (claimed or freshly created) DOM. Idempotent. */
export function startZagCombobox(host: ZagComboboxHost, options: StartZagComboboxOptions): void {
  if (bindings.has(host)) return;
  const items = options.items ?? COMBOBOX_ITEMS;
  const { partsRoot } = options;
  // Capture the pristine structure BEFORE the machine writes anything. This is
  // the exact tree the generated claim just validated (or the mount just
  // inserted): the generated leaf's claim compares each element's attribute
  // seed as an ORDERED list (claim-invariants.ts `staticAttributeSeedMismatch`
  // reports "out of order"), so a reconnect needs this order back — a hardcoded
  // attribute table would have to mirror the authored spelling forever.
  const pristine = capturePartsStructure(partsRoot);

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

  /** Read the machine's public state — the shape the class's `demoSnapshot()` returned. */
  const readSnapshot = (): ZagComboboxSnapshot => {
    const api = combobox.connect(machine.service, normalizeProps);
    return {
      value: [...api.value],
      valueAsString: api.valueAsString,
      inputValue: api.inputValue,
      open: api.open,
      highlightedValue: api.highlightedValue,
      collectionValues: api.collection.getValues(),
    };
  };

  /**
   * Publish the machine state onto the host's declared `machineSnapshot` row —
   * the read half of the class lane's authored `demoSnapshot()` method. The row
   * is property-only (`attribute: false` in the sidecar), so this is a state
   * channel, not a new attribute wire.
   */
  const publishSnapshot = (): void => {
    host.machineSnapshot = JSON.stringify(readSnapshot());
  };

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
    publishSnapshot();
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
      // Publish eagerly: the class lane read the machine live, and the spec
      // reads the row synchronously after writing `controlledValue`, so the
      // row must not depend on the subscription's own repaint timing.
      publishSnapshot();
    },
    snapshot: readSnapshot,
    get selectionCount(): number {
      return selectionCount;
    },
    stop(): void {
      unsubscribe();
      for (const cleanup of cleanups.values()) cleanup();
      cleanups.clear();
      machine.stop();
      // Restore AFTER the machine stopped, so nothing can write over the
      // pristine attribute order on its way out. `16b-migration-note` R2: the
      // reconnect's claim is strict, and Zag's mutations are not part of the
      // compiled program.
      restorePartsStructure(pristine);
    },
  });
}

/** Stop the machine bound to the host. */
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

/** Machine-state snapshot for assertions after controlled updates. */
export function zagComboboxSnapshot(host: HTMLElement): ZagComboboxSnapshot | null {
  return bindings.get(host)?.snapshot() ?? null;
}

// ─── Generated-lane lifecycle entry points ─────────────────────────────────

/**
 * Start the island's machine against the DOM its claim/mount just produced.
 *
 * Called from the island's `onConnect` replay, one macrotask later: the replay
 * runs in the mount/claim PROLOGUE, before the region is the rendered tree and
 * before the strict claim has run, so this function is only ever safe once the
 * connect pass finished — exactly the moment the class lane's
 * `onDsdHydrated` / `onCsrRendered` hooks ran.
 */
export function startZagComboboxForRoot(host: ZagComboboxHost, root: ZagComboboxRoot): void {
  if (root === 'shadow') {
    const shadowRoot = host.shadowRoot;
    if (!shadowRoot) return;
    startZagCombobox(host, {
      id: host.machineId || 'zag-combobox',
      partsRoot: shadowRoot,
      getRootNode: () => shadowRoot,
    });
    return;
  }
  startZagCombobox(host, {
    id: host.machineId || 'zag-combobox-light',
    name: 'fruit',
    partsRoot: host,
    // Light mode: the part ids live in the host's root node — a ShadowRoot
    // when nested inside a page, the Document for a top-level host.
    getRootNode: () => host.getRootNode(),
  });
}

/**
 * Hand the structure back pristine and stop the machine — the class lane's
 * `disconnectedCallback` body, run from the `onConnect` cleanup at that
 * disconnection.
 */
export function resetAndStopZagCombobox(host: ZagComboboxHost): void {
  // The binding captured the pristine structure at start and `stopZagCombobox`
  // restores it as the last step of teardown (see `startZagCombobox`), so
  // "reset" and "stop" are one owner and cannot be called out of order.
  stopZagCombobox(host);
}

// ─── Compiled-kernel ownership: hand the structure back pristine ───────────

/**
 * The compiled claim is strict (fail-closed): on reconnect it validates the
 * generated program's static structure, and each element's static attribute
 * seed is compared as an ORDERED list (`claim-invariants.ts`
 * `staticAttributeSeedMismatch`, which reports "static attribute <name> is out
 * of order"). Zag's spreadProps() mutations (role, ARIA attributes, id,
 * data-state, and the reflected `hidden` on filtered items) are therefore
 * reverted on disconnect so a moved or reconnected island re-claims cleanly and
 * the machine restarts on the pristine compiled DOM.
 *
 * The pristine record is CAPTURED at machine start, not mirrored from the
 * islands' authored markup: at start the claim has just validated this exact
 * tree (or the mount just inserted it), so the capture is the declared ordering
 * by construction, and a later edit to the island's markup cannot drift from a
 * second hand-maintained attribute table.
 */
interface PristinePart {
  readonly element: Element;
  readonly attributes: ReadonlyArray<readonly [string, string]>;
  readonly hidden: boolean;
}

/** Every node the machine writes onto: the seven parts plus the five items. */
function partElements(partsRoot: ParentNode): Element[] {
  const elements: Element[] = [];
  for (const selector of [
    '[data-part="root"]',
    '[data-part="label"]',
    '[data-part="control"]',
    '[data-part="input"]',
    '[data-part="trigger"]',
    '[data-part="positioner"]',
    '[data-part="content"]',
  ]) {
    const element = partsRoot.querySelector(selector);
    if (element) elements.push(element);
  }
  for (const element of partsRoot.querySelectorAll('[data-part="item"]')) elements.push(element);
  return elements;
}

function capturePartsStructure(partsRoot: ParentNode): PristinePart[] {
  return partElements(partsRoot).map((element) => ({
    element,
    attributes: element.getAttributeNames().map((name) => [name, element.getAttribute(name) ?? ''] as const),
    hidden: (element as HTMLElement).hidden === true,
  }));
}

function restorePartsStructure(pristine: readonly PristinePart[]): void {
  for (const part of pristine) {
    // Rebuild the attribute list in the captured order: removing every
    // attribute first is what makes the ORDER the captured one instead of
    // Zag's write order with the survivors left in place.
    for (const name of part.element.getAttributeNames()) part.element.removeAttribute(name);
    for (const [name, value] of part.attributes) part.element.setAttribute(name, value);
    (part.element as HTMLElement).hidden = part.hidden;
  }
}
