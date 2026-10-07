/**
 * @openelement/ui - open-button
 *
 * Button or link control: an `href` property switches the compiled anchor
 * branch (no-JS navigation survives SSR), `variant`/`size` pick the styled
 * surface, and the disabled state follows the reflected host attribute.
 *
 * Experimental (owner ruling C1, #1468): internal implementation may change
 * or be removed before 1.0; the declared `::part` names follow the
 * CUSTOMIZATION.md contract (`::part` names never shrink).
 *
 * Compiled authoring. The anchor/button switch is compiled
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
import {
  computed,
  element,
  OpenElement,
  property,
  type ReadonlySignal,
  type StyleSheetLike,
} from '@openelement/element';
import { closestFormOf, syncDisabledState } from './component-recipes.ts';
import controlRecipe from './control-recipe.css';
import openButtonStyles from './open-button.css';

@element('open-button', {
  root: 'shadow-open',
  delegatesFocus: true,
  formAssociated: true,
})
export class OpenButton extends OpenElement {
  static override styles: StyleSheetLike[] = [controlRecipe, openButtonStyles];

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
  linkMode: ReadonlySignal<boolean> = computed(() => this.href !== '');

  /** True when the button branch is the visible control. */
  @property({ reflect: false, attribute: false, type: Boolean })
  buttonMode: ReadonlySignal<boolean> = computed(() => this.href === '');

  /** Disabled anchors lose their href entirely (#757/#1061). */
  @property({ reflect: false, attribute: false, type: String })
  linkHref: ReadonlySignal<string | null> = computed(() =>
    this.disabled || this.href === '' ? null : this.href,
  );

  @property({ reflect: false, attribute: false, type: String })
  linkTarget: ReadonlySignal<string | null> = computed(() =>
    this.target === '' ? null : this.target,
  );

  @property({ reflect: false, attribute: false, type: String })
  linkRel: ReadonlySignal<string | null> = computed(() =>
    this.target === '_blank' ? 'noopener noreferrer' : null,
  );

  @property({ reflect: false, attribute: false, type: String })
  linkAriaDisabled: ReadonlySignal<string | null> = computed(() => (this.disabled ? 'true' : null));

  render(): unknown {
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
          // oxlint-disable-next-line button-has-type -- dynamic type is a validated public prop
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
   * Submit `form` on behalf of this element (#637).
   *
   * Critical: the native 'submit' event is NOT composed (it does not cross
   * shadow boundaries). open-button typically lives inside another custom
   * element's shadow root (e.g. <reader-reading>), so a natively submitted
   * form would never reach a delegated listener outside the shadow tree. We
   * re-dispatch a composed, cancelable submit event on the form so the
   * enhancement layer's delegated handler (form-enhance.ts onSubmit, bound
   * per document/shadow root) can intercept it.
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
      : new Event('submit', {
          bubbles: true,
          cancelable: true,
          composed: true,
        });
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
