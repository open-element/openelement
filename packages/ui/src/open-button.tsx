/**
 * @openelement/ui - open-button
 *
 * Minimal button component following Swiss International Style.
 * Violet brand accents with subtle hover states.
 *
 * v0.44: compiled authoring (ADR-0143). The anchor/button switch is compiled
 * as two sibling controls, exactly one visible: `linkMode`/`buttonMode`
 * computeds read the `href` property, and `hidden` sinks pick the visible
 * branch — so SSR emits a working link (no-JS navigation) and the claim
 * preserves it. Variant/size styling follows the reflected host attributes
 * (:host([variant=...]) selectors); click/form behavior lives in methods.
 *
 * Variants: default (outlined), primary (filled), ghost (no border), accent (gradient)
 * Sizes: sm, md (default), lg
 *
 * @csspart control - The visible button or anchor element
 *
 * Usage:
 * ```html
 * <open-button>Click me</open-button>
 * <open-button variant="primary">Submit</open-button>
 * <open-button size="sm" disabled>Small</open-button>
 * <open-button href="/guide">Navigate</open-button>
 * ```
 */
import { computed, element, OpenElement, property } from '@openelement/element';
import { closestFormOf, controlRecipe, recipe, syncDisabledState } from './component-recipes.ts';

@element('open-button', { root: 'shadow-open', delegatesFocus: true, formAssociated: true })
export class OpenButton extends OpenElement {
  static override styles = [
    controlRecipe,
    recipe(`
    :host {
      display: inline-block;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--size-2);
      font-family: var(--font-sans);
      font-weight: var(--font-weight-8);
      text-decoration: none;
      cursor: pointer;
      border: var(--border-size-1) solid color-mix(in srgb, var(--border) 72%, var(--brand));
      background: color-mix(in srgb, var(--bg-elevated) 78%, transparent);
      color: var(--ui-control-text);
      border-radius: var(--ui-control-radius);
      box-shadow: var(--ui-control-highlight);
      transition: color var(--ease-3) var(--duration-2), border-color var(--ease-3) var(--duration-2), background var(--ease-3) var(--duration-2), transform var(--ease-3) var(--duration-2), box-shadow var(--ease-3) var(--duration-2);
      white-space: nowrap;
      letter-spacing: 0;
    }

    .btn[hidden] {
      display: none;
    }

    /* Sizes */
    :host([size='sm']) .btn {
      padding: var(--size-1) var(--size-3);
      font-size: var(--font-size-0);
      min-height: 30px;
    }

    :host(:not([size])) .btn,
    :host([size='md']) .btn {
      padding: var(--size-2) var(--size-4);
      font-size: var(--font-size-1);
      min-height: 38px;
    }

    :host([size='lg']) .btn {
      padding: var(--size-3) var(--size-5);
      font-size: var(--font-size-2);
      min-height: 48px;
    }

    /* Variants (default is the base .btn treatment) */
    :host(:not([variant])) .btn:hover,
    :host([variant='default']) .btn:hover {
      color: var(--brand-deep);
      border-color: var(--brand-light);
      background: color-mix(in srgb, var(--brand-pale) 52%, var(--bg-elevated));
    }

    :host([variant='primary']) .btn {
      background: linear-gradient(135deg, var(--brand), var(--brand-light));
      color: var(--on-brand);
      border-color: transparent;
      box-shadow: 0 var(--size-2) var(--size-5) color-mix(in srgb, var(--brand) 22%, transparent);
    }

    :host([variant='primary']) .btn:hover {
      background: linear-gradient(135deg, var(--brand-hover), var(--brand-light));
      border-color: transparent;
      transform: translateY(calc(var(--border-size-1) * -1));
      box-shadow: 0 var(--size-3) var(--size-6) color-mix(in srgb, var(--brand) 28%, transparent);
    }

    :host([variant='ghost']) .btn {
      border-color: transparent;
    }

    :host([variant='ghost']) .btn:hover {
      background: color-mix(in srgb, var(--brand-pale) 38%, transparent);
      border-color: transparent;
    }

    :host([variant='accent']) .btn {
      background: var(--brand);
      color: var(--on-brand);
      border-color: transparent;
    }
    :host([variant='accent']) .btn:hover {
      transform: translateY(-1px);
      filter: brightness(1.05);
    }
    :host([variant='accent']) .btn:active {
      transform: translateY(0);
      box-shadow: var(--shadow-1);
    }

    /* States */
    .btn:disabled,
    .btn[aria-disabled='true'] {
      opacity: 0.5;
      cursor: not-allowed;
      pointer-events: none;
    }

    .btn:focus-visible {
      outline: 2px solid var(--brand, var(--indigo-6));
      outline-offset: 2px;
    }

    :host(:state(disabled)) .btn {
      opacity: 0.5;
      cursor: not-allowed;
      pointer-events: none;
    }
  `),
  ];

  @property({ reflect: true })
  variant = 'default';

  @property({ reflect: true })
  size = 'md';

  @property({ reflect: true, type: Boolean })
  disabled = false;

  /** When set, the control is a link (the anchor branch is the visible one). */
  @property({ reflect: true })
  href = '';

  @property({ reflect: true })
  target = '';

  @property({ reflect: true })
  type = 'button';

  /** True when the anchor branch is the visible control. */
  @property({ reflect: false, attribute: false, type: Boolean })
  linkMode = computed(() => this.href !== '');

  /** True when the button branch is the visible control. */
  @property({ reflect: false, attribute: false, type: Boolean })
  buttonMode = computed(() => this.href === '');

  /** Disabled anchors lose their href entirely (#757/#1061). */
  @property({ reflect: false, attribute: false, type: String })
  linkHref = computed(() => this.disabled || this.href === '' ? null : this.href);

  @property({ reflect: false, attribute: false, type: String })
  linkTarget = computed(() => this.target === '' ? null : this.target);

  @property({ reflect: false, attribute: false, type: String })
  linkRel = computed(() => this.target === '_blank' ? 'noopener noreferrer' : null);

  @property({ reflect: false, attribute: false, type: String })
  linkAriaDisabled = computed(() => this.disabled ? 'true' : null);

  render() {
    return (
      <span style='display:contents'>
        <a
          class='control btn'
          part='control'
          href={this.linkHref}
          target={this.linkTarget}
          rel={this.linkRel}
          aria-disabled={this.linkAriaDisabled}
          hidden={this.buttonMode}
          onClick={this.handleClick}
        >
          <slot></slot>
        </a>
        <button
          class='control btn'
          part='control'
          type={this.type}
          disabled={this.disabled}
          hidden={this.linkMode}
          onClick={this.handleClick}
        >
          <slot></slot>
        </button>
      </span>
    );
  }

  override onDsdHydrated(): void {
    this.syncInternals();
  }

  override onCsrRendered(): void {
    this.syncInternals();
  }

  override attributeChangedCallback(name: string, old: string | null, val: string | null): void {
    super.attributeChangedCallback(name, old, val);
    if (old === val) return;
    if (name === 'disabled') this.syncInternals();
  }

  private syncInternals(): void {
    syncDisabledState(this._internals, this.disabled);
  }

  private handleClick(e: Event): void {
    // Disabled guard (#757): the anchor branch (and programmatic click()) can
    // reach this handler — a disabled open-button must not fire open-click,
    // navigate, or submit. The anchor keeps its disabled href out of the DOM
    // (linkHref computed); preventDefault covers the rest.
    if (this.disabled) {
      e.preventDefault();
      return;
    }

    this.dispatchEvent(new CustomEvent('open-click', { bubbles: true, composed: true }));

    // The anchor branch is a navigation control, not a form control — it must
    // never submit/reset a form (异味③, #637). Only the <button> branch may
    // trigger form submission below.
    if (this.href !== '') return;

    // Form submission: when type="submit" or type="reset" and this element is
    // associated with a <form> (via formAssociated), the inner <button> lives
    // inside the shadow DOM and its native submit/reset behavior does NOT
    // reach the outer form. We must explicitly trigger it here.
    const form = this._internals?.form ?? closestFormOf(this);
    if (!form) return;
    if (this.type === 'submit') {
      this.submitForm(form);
    } else if (this.type === 'reset') {
      form.reset();
    }
  }

  /**
   * Submit `form` on behalf of this element (v0.42.0-alpha.9, #637).
   *
   * Critical: the native 'submit' event is NOT composed (it does not cross
   * shadow boundaries). open-button typically lives inside another custom
   * element's shadow root (e.g. <reader-reading>), so a natively submitted
   * form would never reach the SPA's root listener. We re-dispatch a
   * composed, cancelable submit event on the form so the SPA's delegated
   * handler (bound on #root) can intercept it; at that listener
   * event.target is retargeted to this host, so the handler locates the
   * form through event.composedPath() (see spa.ts handleFormSubmit).
   */
  private submitForm(form: HTMLFormElement): void {
    // SubmitEvent may be unavailable in older runtimes; fall back to Event.
    const SubmitEventCtor = (globalThis as { SubmitEvent?: typeof SubmitEvent }).SubmitEvent;
    const submitEvent: Event = SubmitEventCtor
      ? new SubmitEventCtor('submit', {
        bubbles: true,
        cancelable: true,
        composed: true,
      })
      : new Event('submit', { bubbles: true, cancelable: true, composed: true });
    form.dispatchEvent(submitEvent);
    // If the SPA prevented default, the action was handled — do NOT call
    // requestSubmit() (which would cause native form GET navigation).
    if (!submitEvent.defaultPrevented) {
      const formEl = form as HTMLFormElement & {
        requestSubmit?: () => void;
        submit: () => void;
      };
      if (typeof formEl.requestSubmit === 'function') {
        formEl.requestSubmit();
      } else {
        formEl.submit();
      }
    }
  }
}
