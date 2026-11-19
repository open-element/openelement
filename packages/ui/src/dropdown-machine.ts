/**
 * @openelement/ui - open-dropdown activation choreography (module helper).
 *
 * The generated element owns the compiled template (trigger span, native
 * popover content) and the declared `anchorName` property; this module owns
 * the imperative activation the compiled program cannot express: the
 * realm-unique anchor-name assignment and the cross-shadow focus-return
 * restoration (#1226). The platform does the rest — the content is a native
 * `popover` (top layer, built-in light dismiss), placement is CSS anchor
 * positioning, and no behavior machine rides on either.
 *
 * The lifecycle hooks run before the template's nodes exist, so the
 * focus-return listeners wire on the SHADOW ROOT synchronously — the shell
 * attaches the retained root before mounting, but the nodes do not exist
 * yet, and wiring on the content itself would need a frame of deferral that
 * loses the first-open capture to an interaction in the mount frame. The
 * listeners ride the shadow ROOT in capture phase because the popover's
 * `beforetoggle`/`toggle` events neither bubble nor compose: a
 * `composed: false` event's propagation path truncates at the shadow
 * boundary, so the host (or anything light-side) never sees them, while the
 * shadow root — the last node on the truncated path — does, in either phase.
 * The content's `position-anchor` half is applied lazily at `beforetoggle`
 * (the spec fires it before the open flip, so the anchor is in place before
 * the popover can become visible).
 *
 * Functions take the host explicitly — the same host the lifecycle `env`
 * provides — so the unit harness drives them without connecting an element.
 */
import { deepActiveElement, nextInstanceId } from './component-recipes.ts';
import { readInstanceState, writeInstanceState } from './instance-state.ts';

/** The generated element's declared `anchorName` property, as authored. */
export type DropdownHost = HTMLElement & { anchorName: string };

function dropdownContent(host: DropdownHost): HTMLElement | null {
  const content = host.shadowRoot?.querySelector('.content');
  return (content as HTMLElement | null) ?? null;
}

/**
 * Assign the realm-unique anchor name and apply the HOST half (`anchor-name`).
 * Idempotent: an author-assigned name (a public property write re-entering
 * through the change channel) re-applies the same value, and the
 * instance-assigned name never changes after activation.
 *
 * The CONTENT half (`position-anchor`) is NOT applied here: a reconnect
 * re-claims the retained nodes against the compiled static seeds, and a
 * runtime-written inline style would count as an extra static attribute
 * (`OEIR_LEAF_CLAIM_MISMATCH`). The content half lives only inside the open
 * window instead — applied at `beforetoggle`, removed on close and on
 * dispose — so the closed element's static surface stays exactly the compiled
 * declaration, and the anchor is still in place before any open is
 * observable.
 */
export function syncDropdownAnchor(host: DropdownHost): void {
  if (host.anchorName === '') {
    // #1061: every instance anchors its popover to its own host. The same
    // counter realm serves server and client, so assignments can never
    // collide.
    host.anchorName = `--open-dropdown-trigger-${nextInstanceId()}`;
  }
  host.style.setProperty('anchor-name', host.anchorName);
  // The content half is a CSS custom property read by the authored sheet
  // (`.content { position-anchor: var(--oe-dropdown-anchor) }`), so setting it
  // here covers BOTH the closed element and a rename inside the open window —
  // and it never puts a runtime inline style on the compiled leaf, which a
  // reconnect claim would count as an extra static attribute.
  host.style.setProperty('--oe-dropdown-anchor', host.anchorName);
}

/**
 * Drop the content's runtime `position-anchor` so the closed element's
 * static surface matches the compiled seeds again (a reconnect re-claims the
 * retained nodes against them). Removing the LAST declaration leaves a
 * residual `style=""` attribute on this engine, and the claim counts
 * attributes, not declarations — an extra `style` member fails the seed
 * compare (`OEIR_LEAF_CLAIM_MISMATCH`). An empty declaration block therefore
 * drops the attribute itself: only an element with no inline declarations
 * left is affected, so an authored style attribute would never be touched.
 */
function dropContentPositionAnchor(content: HTMLElement): void {
  // The anchor identity now rides the host's custom property, so this leaf
  // never receives one. The function stays as the single place that guarantees
  // the compiled leaf's inline surface is empty: a stale inline style from an
  // older build (or an engine hiccup) would otherwise fail the reconnect
  // claim's static-seed compare.
  if (content.hasAttribute('style')) content.removeAttribute('style');
}

export function clearDropdownPositionAnchor(host: DropdownHost): void {
  const content = dropdownContent(host);
  if (content !== null) dropContentPositionAnchor(content);
}

/** True when the focus event's composed path runs through this popover's content. */
function focusTargetsPopover(host: DropdownHost, event: FocusEvent): boolean {
  const content = dropdownContent(host);
  if (content === null) return false;
  return event.composedPath().includes(content);
}

/**
 * Wire the cross-shadow focus-return restoration once per host (reconnects
 * keep the existing listeners). Native popover focus return only works when
 * the previously focused element lives in the same tree as the popover; the
 * trigger is slotted light DOM while the popover sits in this shadow root, so
 * on real pages (the host inside a page's shadow tree) the platform drops
 * focus to <body> on dismiss (#1226). The trigger path records the composed
 * focused element as the popover opens; on close, restore it only when the
 * platform failed to.
 *
 * The wiring is ELEMENT-lifetime, not connection-lifetime: `signal` is the
 * shell's instance-lifetime teardown signal, so it cannot bound a
 * per-connection listener set (a reconnect would find the wiring disposed
 * while the compiled nodes were re-claimed). It is accepted for the intrinsic
 * call contract and deliberately ignored (`void signal`); the listeners live
 * once per host on the retained root and are removed by
 * `disposeDropdownFocusWiring` at activation and at teardown. ADR-0182's
 * 2026-11-20 correction records this reading; the earlier connection-signal
 * wording was wrong.
 */
export function watchDropdownFocusReturn(host: DropdownHost, signal?: AbortSignal): void {
  if (readInstanceState(host, 'focusWired', () => false)) return;
  const root = host.shadowRoot;
  // The shell attaches the retained root before mounting, so the root exists
  // at hook time; a null root means the element never connected a shadow and
  // no popover events can fire inside one either.
  if (root === null) return;
  // The generation this wiring belongs to: bumped on every activation, read by
  // the queued-task handlers below to reject work from a dead connection.
  const generation = readInstanceState(host, 'connectionGeneration', () => 0);
  const onFocusIn = (event: Event) => {
    // ShadowRoot's event map carries no focusin row (slotchange only), so the
    // generic overload applies and the narrowing happens here.
    if (focusTargetsPopover(host, event as FocusEvent))
      writeInstanceState(host, 'popoverHadFocus', true);
  };
  const onBeforeToggle = (event: Event) => {
    const toggle = event as ToggleEvent;
    const content = event.target;
    if (!(content instanceof HTMLElement) || content !== dropdownContent(host)) return;
    if (toggle.newState === 'closed') {
      // The open window ends at the SYNCHRONOUS closed flip: the popover's
      // state is observable as closed from here, while the queued toggle
      // task can land later — dropping the runtime content anchor here
      // keeps the closed element's static surface (which a reconnect
      // re-claims against the compiled seeds) clean the moment the close
      // is observable.
      dropContentPositionAnchor(content);
      return;
    }
    if (toggle.newState !== 'open') return;
    // The anchor identity already lives on the host's custom property, so an
    // open needs no write on this compiled leaf.
    writeInstanceState(host, 'popoverHadFocus', false);
    writeInstanceState(host, 'previouslyFocused', deepActiveElement());
  };
  const onToggleClosed = (event: Event) => {
    const toggle = event as ToggleEvent;
    const content = event.target;
    if (!(content instanceof HTMLElement) || content !== dropdownContent(host)) return;
    if (toggle.newState !== 'closed') return;
    // Toggle events are QUEUED tasks: the task for a close that happened before
    // a disconnect can land AFTER the reconnect claim and re-drop the content
    // half the new connection just re-seeded (observed: activation cleared the
    // residue and this stale task wrote `style=""` back). The drop is therefore
    // gated on the connection generation the listener was wired for, so a task
    // from a dead connection is a no-op.
    if (readInstanceState(host, 'connectionGeneration', () => 0) !== generation) return;
    dropContentPositionAnchor(content);
    const hadFocus = readInstanceState(host, 'popoverHadFocus', () => false);
    const previous = readInstanceState(host, 'previouslyFocused', () => null as HTMLElement | null);
    writeInstanceState(host, 'previouslyFocused', null);
    if (!hadFocus || !previous?.isConnected) return;
    // The platform settles focus around the toggle event, not before it:
    // the same-tree native restore lands by itself (active === previous),
    // while the cross-shadow defect leaves focus inside the closing
    // popover or drops it to <body> — both mean "restore it ourselves".
    // A deliberate move (outside click) is neither and is left alone.
    queueMicrotask(() => {
      // A connection that died between the toggle task and this microtask
      // owns no focus decisions anymore: restoring into the document from a
      // detached host would move focus on behalf of a connection that no
      // longer exists.
      if (!host.isConnected) return;
      if (!previous.isConnected) return;
      const active = deepActiveElement();
      if (active === previous) return;
      const focusInside = active !== null && (host.contains(active) || content.contains(active));
      const dropped = !active || active === document.body || active === document.documentElement;
      if (!focusInside && !dropped) return;
      previous.focus();
    });
  };
  writeInstanceState(host, 'focusWired', true);
  // Capture phase on the ROOT: the popover's beforetoggle/toggle events are
  // composed:false (their propagation truncates at this boundary) and
  // focus events are filtered by their composed path (a slotted light-DOM
  // element's path runs through the slot into the content, while the
  // trigger's path — slotted into the trigger wrapper — does not).
  const listeners: DropdownFocusListener[] = [
    ['focusin', onFocusIn],
    ['beforetoggle', onBeforeToggle],
    ['toggle', onToggleClosed],
  ];
  for (const [type, listener] of listeners) root.addEventListener(type, listener, true);
  writeInstanceState(host, 'focusListeners', listeners);
  // NOTE: `env.signal` is the ELEMENT-lifetime channel (the shell's retained
  // instance signal), not a per-connection one — the shell aborts it on a
  // failed connect pass and at teardown, so it cannot bound a per-connection
  // listener set (a reconnect would find the wiring disposed while the
  // compiled nodes were re-claimed). The wiring therefore lives once per host
  // on the retained root — which is precisely what a reconnect needs — and is
  // removed by `disposeDropdownFocusWiring` at element teardown (`onDispose`).
  void signal;
}

/**
 * Remove the focus-return listeners this module wired on the host's shadow
 * root and reset its bookkeeping state. Runs at activation (before re-wiring)
 * and at element-lifetime teardown (idempotent): after teardown no listener of
 * this module may stay attached to the retained root.
 */
/** One wired focus-return listener pair: the event type and its root listener. */
type DropdownFocusListener = [type: string, listener: EventListener];

export function disposeDropdownFocusWiring(host: DropdownHost): void {
  const listeners = readInstanceState<DropdownFocusListener[] | undefined>(
    host,
    'focusListeners',
    () => undefined,
  );
  const root = host.shadowRoot;
  if (listeners !== undefined && root !== null) {
    for (const [type, listener] of listeners) root.removeEventListener(type, listener, true);
  }
  writeInstanceState(host, 'focusListeners', undefined);
  writeInstanceState(host, 'focusWired', false);
  writeInstanceState(host, 'popoverHadFocus', false);
  writeInstanceState(host, 'previouslyFocused', null);
}

/**
 * Activation = anchor sync + focus-return wiring. The wiring is element-lifetime
 * (idempotent while the same connection stays live); the optional `signal` is
 * accepted for the intrinsic call contract and deliberately ignored — see
 * `watchDropdownFocusReturn`.
 */
export function activateDropdown(host: DropdownHost, signal?: AbortSignal): void {
  // A new activation opens a new connection generation: every listener set
  // wired by the previous generation is torn down first, so a queued task that
  // outlived its connection cannot mutate the fresh claim.
  disposeDropdownFocusWiring(host);
  writeInstanceState(
    host,
    'connectionGeneration',
    readInstanceState(host, 'connectionGeneration', () => 0) + 1,
  );
  // A reconnect re-claims the retained nodes against the compiled static
  // seeds, and a disconnect can leave the runtime content half behind (no
  // closed beforetoggle fires on a detached root). Activation therefore
  // starts from the seed surface: the closed element carries no inline style,
  // and the open window re-applies it at beforetoggle.
  clearDropdownPositionAnchor(host);
  syncDropdownAnchor(host);
  watchDropdownFocusReturn(host, signal);
}

/**
 * Trigger pointerdown bookkeeping: a mouse click is preceded by a pointerdown
 * that natively light-dismisses an open popover; the click that follows must
 * not re-open it. Keyboard/programmatic clicks have no pointerdown and toggle
 * normally.
 */
export function recordDropdownPointerDown(host: DropdownHost): void {
  const content = dropdownContent(host);
  writeInstanceState(host, 'openAtPointerDown', content?.matches(':popover-open') ?? false);
}

/**
 * Trigger click: the pointerdown light-dismiss guard, then the native
 * `togglePopover()`. The synchronous 'beforetoggle' listener is the single
 * owner of the return-focus capture (#1226); it runs inside togglePopover()
 * before the open flip, so nothing can move focus between this call and the
 * capture.
 */
export function toggleDropdown(host: DropdownHost): void {
  const wasOpen = readInstanceState(host, 'openAtPointerDown', () => false);
  writeInstanceState(host, 'openAtPointerDown', false);
  if (wasOpen) return;
  const content = dropdownContent(host);
  if (!content) return;
  content.togglePopover();
}
