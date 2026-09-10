/**
 * @openelement/ui - open-dropdown
 * Popover-API dropdown with CSS Anchor Positioning placement.
 * The content is a native popover (top layer, built-in light dismiss and
 * focus return); placement anchors to the host, no hand-rolled fallback.
 *
 * v0.44: compiled authoring (ADR-0143). The per-instance anchor name is
 * assigned at activation (SSG renders every page in one process while islands
 * upgrade in arbitrary order, so server and client counters can never agree —
 * component-recipes.ts); the compiled style sink applies it to the content.
 *
 * @slot trigger - Control used to toggle the dropdown
 * @slot - Dropdown content
 * @csspart trigger - Trigger wrapper
 * @csspart content - Popover content
 */
import { computed, element, OpenElement, property } from '@openelement/element';
import { deepActiveElement, nextInstanceId, overlayRecipe, recipe } from './component-recipes.ts';
import { readInstanceState, writeInstanceState } from './instance-state.ts';

@element('open-dropdown', { root: 'shadow-open' })
export class OpenDropdown extends OpenElement {
  static override styles = [
    overlayRecipe,
    recipe(`
    :host {
      display: inline-block;
    }

    .trigger {
      display: contents;
    }

    .content {
      /* The base inset is the placement fallback for engines without CSS Anchor
         Positioning; it must stay present because Firefox's anchor resolution
         only applies anchor() longhands on top of an explicit inset. */
      position: absolute;
      inset: 100% auto auto 0;
      top: anchor(bottom);
      left: anchor(left);
      min-width: 12rem;
      /* The gap rides on margin-top: calc(anchor() + length) resolves without
         the added length in Firefox. */
      margin: var(--size-2) 0 0;
      padding: var(--size-2);
      font-family: var(--font-sans);
    }
  `),
  ];

  /** #1061: every instance anchors its popover to its own host. */
  @property({ reflect: false, attribute: false })
  anchorName = '';

  /** The content half of the anchor pair, applied via the style sink. */
  @property({ reflect: false, attribute: false, type: String })
  anchorStyle = computed(() => this.anchorName === '' ? '' : `position-anchor: ${this.anchorName}`);

  render() {
    return (
      <div>
        <span
          class='trigger'
          part='trigger'
          onPointerDown={this.onTriggerPointerDown}
          onClick={this.toggle}
        >
          <slot name='trigger'></slot>
        </span>
        <div
          class='overlay content'
          part='content'
          popover='auto'
          style={this.anchorStyle}
        >
          <slot></slot>
        </div>
      </div>
    );
  }

  override onDsdHydrated(): void {
    this.syncAnchorName();
    this.watchFocusReturn();
  }

  override onCsrRendered(): void {
    this.syncAnchorName();
    this.watchFocusReturn();
  }

  /**
   * Native popover focus return only works when the previously focused
   * element lives in the same tree as the popover. The trigger is slotted
   * light DOM while the popover sits in this shadow root, so on real pages
   * (the host inside a page's shadow tree) the platform drops focus to
   * <body> on dismiss (#1226). The trigger path records the composed focused
   * element as the popover opens; on close, restore it only when the platform
   * failed to.
   */
  private watchFocusReturn(): void {
    if (readInstanceState(this, 'focusWired', () => false)) return;
    writeInstanceState(this, 'focusWired', true);
    const content = this.shadowRoot?.querySelector<HTMLElement>('.content');
    if (!content) return;
    content.addEventListener('focusin', () => {
      writeInstanceState(this, 'popoverHadFocus', true);
    });
    // 'beforetoggle' fires synchronously before the open flip — therefore
    // before showPopover()'s focusing steps (an autofocus descendant) and
    // before any same-task programmatic .focus() into the popover (the
    // menu-button composition pattern). Resetting the record here, instead of
    // in the queued 'toggle' task, closes the race where focus entering the
    // popover within the opening task had its focusin record wiped, silently
    // disabling focus return. The same synchronous point also captures the
    // return-focus target for every open path, including direct showPopover()
    // calls that never pass through toggle().
    content.addEventListener('beforetoggle', (event) => {
      if ((event as ToggleEvent).newState !== 'open') return;
      writeInstanceState(this, 'popoverHadFocus', false);
      writeInstanceState(this, 'previouslyFocused', deepActiveElement());
    });
    content.addEventListener('toggle', (event) => {
      const toggle = event as ToggleEvent;
      if (toggle.newState !== 'closed') return;
      const hadFocus = readInstanceState(this, 'popoverHadFocus', () => false);
      const previous = readInstanceState(
        this,
        'previouslyFocused',
        () => null as HTMLElement | null,
      );
      writeInstanceState(this, 'previouslyFocused', null);
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
        const focusInside = active !== null &&
          (this.contains(active) || content.contains(active));
        const dropped = !active || active === document.body || active === document.documentElement;
        if (!focusInside && !dropped) return;
        previous.focus();
      });
    });
  }

  // Both anchor halves must hold a name from the same realm. The SSR markup
  // stays unpositioned until activation (the popover is closed until a user
  // opens it, which requires hydration anyway); at activation the client
  // assigns one realm-unique name to both halves.
  private syncAnchorName(): void {
    if (this.anchorName === '') {
      this.anchorName = `--open-dropdown-trigger-${nextInstanceId()}`;
    }
    this.style.setProperty('anchor-name', this.anchorName);
  }

  private onTriggerPointerDown(): void {
    const content = this.shadowRoot?.querySelector<HTMLElement>('.content');
    writeInstanceState(
      this,
      'openAtPointerDown',
      content?.matches(':popover-open') ?? false,
    );
  }

  private toggle(): void {
    // A mouse click on the trigger is preceded by a pointerdown that natively
    // light-dismisses an open popover; the click that follows must not re-open
    // it. Keyboard/programmatic clicks have no pointerdown and toggle normally.
    const wasOpen = readInstanceState(this, 'openAtPointerDown', () => false);
    writeInstanceState(this, 'openAtPointerDown', false);
    if (wasOpen) return;
    const content = this.shadowRoot?.querySelector<HTMLElement>('.content');
    if (!content) return;
    // watchFocusReturn's synchronous 'beforetoggle' listener is the single
    // owner of the return-focus capture (#1226); it runs inside
    // togglePopover() before the open flip, so nothing can move focus between
    // this call and the capture.
    content.togglePopover();
  }
}
