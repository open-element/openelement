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
}

/**
 * Drop the content's runtime `position-anchor` so the closed element's
 * static surface matches the compiled seeds again (a reconnect re-claims the
 * retained nodes against them).
 */
export function clearDropdownPositionAnchor(host: DropdownHost): void {
  const content = dropdownContent(host);
  if (content !== null) content.style.removeProperty('position-anchor');
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
 */
export function watchDropdownFocusReturn(host: DropdownHost): void {
  if (readInstanceState(host, 'focusWired', () => false)) return;
  const root = host.shadowRoot;
  // The shell attaches the retained root before mounting, so the root exists
  // at hook time; a null root means the element never connected a shadow and
  // no popover events can fire inside one either.
  if (root === null) return;
  writeInstanceState(host, 'focusWired', true);
  // Capture phase on the ROOT: the popover's beforetoggle/toggle events are
  // composed:false (their propagation truncates at this boundary) and
  // focus events are filtered by their composed path (a slotted light-DOM
  // element's path runs through the slot into the content, while the
  // trigger's path — slotted into the trigger wrapper — does not).
  root.addEventListener(
    'focusin',
    // ShadowRoot's event map carries no focusin row (slotchange only), so the
    // generic overload applies and the narrowing happens here.
    (event: Event) => {
      if (focusTargetsPopover(host, event as FocusEvent))
        writeInstanceState(host, 'popoverHadFocus', true);
    },
    true,
  );
  // 'beforetoggle' fires synchronously before the open flip — therefore
  // before showPopover()'s focusing steps (an autofocus descendant) and
  // before any same-task programmatic .focus() into the popover (the
  // menu-button composition pattern). Resetting the record here, instead of
  // in the queued 'toggle' task, closes the race where focus entering the
  // popover within the opening task had its focusin record wiped, silently
  // disabling focus return. The same synchronous point also captures the
  // return-focus target for every open path, including direct showPopover()
  // calls that never pass through toggle().
  root.addEventListener(
    'beforetoggle',
    (event) => {
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
        content.style.removeProperty('position-anchor');
        return;
      }
      if (toggle.newState !== 'open') return;
      // The anchor half rides the same synchronous point: the popover cannot
      // become visible before this listener returns, so the position-anchor
      // is always in place before an open is observable.
      content.style.setProperty('position-anchor', host.anchorName);
      writeInstanceState(host, 'popoverHadFocus', false);
      writeInstanceState(host, 'previouslyFocused', deepActiveElement());
    },
    true,
  );
  root.addEventListener(
    'toggle',
    (event) => {
      const toggle = event as ToggleEvent;
      const content = event.target;
      if (!(content instanceof HTMLElement) || content !== dropdownContent(host)) return;
      if (toggle.newState !== 'closed') return;
      const hadFocus = readInstanceState(host, 'popoverHadFocus', () => false);
      const previous = readInstanceState(
        host,
        'previouslyFocused',
        () => null as HTMLElement | null,
      );
      writeInstanceState(host, 'previouslyFocused', null);
      if (!hadFocus || !previous?.isConnected) return;
      // The platform settles focus around the toggle event, not before it:
      // the same-tree native restore lands by itself (active === previous),
      // while the cross-shadow defect leaves focus inside the closing
      // popover or drops it to <body> — both mean "restore it ourselves".
      // A deliberate move (outside click) is neither and is left alone.
      queueMicrotask(() => {
        if (!previous.isConnected) return;
        const active = deepActiveElement();
        if (active === previous) return;
        const focusInside = active !== null && (host.contains(active) || content.contains(active));
        const dropped = !active || active === document.body || active === document.documentElement;
        if (!focusInside && !dropped) return;
        previous.focus();
      });
    },
    true,
  );
}

/** Activation = anchor sync + focus-return wiring (idempotent across reconnects). */
export function activateDropdown(host: DropdownHost): void {
  syncDropdownAnchor(host);
  watchDropdownFocusReturn(host);
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
