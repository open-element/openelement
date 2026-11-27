/**
 * @openelement/ui - open-button
 *
 * Button or link control: an `href` value switches the compiled anchor branch
 * (no-JS navigation survives SSR), `variant`/`size` pick the styled surface, and
 * the disabled state follows the reflected host attribute.
 *
 * Experimental (owner ruling C1, #1468): internal implementation may change or
 * be removed before 1.0; the declared `::part` names follow the
 * CUSTOMIZATION.md contract (`::part` names never shrink).
 *
 * Generated authoring. The control is ONE `when` branch with a single default
 * slot per branch: `href !== ''` picks `<a>`, otherwise `<button>`, so exactly
 * one control element exists in any state and the slot carries no same-name
 * competition. The earlier two-sibling shape (both controls always mounted,
 * `hidden` sinks picking the visible one) measured broken in the PR #1611
 * audit: same-name default slots assign by tree order — the first slot in the
 * shadow tree wins regardless of visibility, and `hidden` is not a slot force —
 * so button mode assigned the user's text into the HIDDEN anchor's slot,
 * leaving the visible button blank with no accessible name. The single slot
 * removes that competition outright. Clicks bubble from either branch to the
 * delegated listener on the static display:contents wrapper, and
 * `button-machine.ts` keeps the control semantics (open-click, form
 * submit/reset, the #757 disabled guard). Variant/size styling follows the
 * reflected host attributes (`:host([variant=...])` selectors). SSR semantics
 * are unchanged: in link mode the server serializes a navigable `<a>`.
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
import { activateButton, type ButtonHost } from './button-machine.ts';
import { defineComponentConfig } from './component-config.ts';

/**
 * Platform facts for the generated element: shadow root with delegated focus,
 * form association (the class lane's `formAssociated: true`, so `form.elements`
 * membership and the effective-disabled custom state are unchanged), the
 * authored stylesheet, and the six declared property rows — all reflected, the
 * class lane's exact attribute surface.
 */
export const openElement = /* @__PURE__ */ defineComponentConfig({
  root: 'shadow',
  delegatesFocus: true,
  formAssociated: true,
  styles: ['./open-button.css'],
  properties: {
    variant: { default: 'default', reflect: true },
    size: { default: 'md', reflect: true },
    disabled: { default: false, reflect: true },
    href: { default: '', reflect: true },
    target: { default: '', reflect: true },
    type: { default: 'button', reflect: true },
  },
});

/** Button or link control with variant/size surfaces and form participation. */
function OpenButton(props: {
  variant: string;
  size: string;
  disabled: boolean;
  href: string;
  target: string;
  type: string;
}) {
  // The click choreography needs the HOST (the disabled row, the href/type
  // rows, `closest('form')`), and an event handler's `currentTarget` is the
  // wrapper span inside the shadow tree — its root node is the way out.
  const hostOf = (event: Event): ButtonHost =>
    ((event.currentTarget as HTMLElement).getRootNode() as ShadowRoot).host as ButtonHost;

  // Every row-derived value below is spelled INLINE at its JSX position, so the
  // compiler derives the dependency from the read it emits. An alias here would
  // make the sink a setup-time one-shot: correct at mount/claim, never again
  // (see Reactive reads in docs/architecture/compiler-and-element-runtime.md).
  //
  // `type` is deliberately NOT bound on the button branch. The class lane
  // rendered `type={this.type}` and let the platform's native submit happen
  // inside the shadow tree; a form-associated generated element is not a native
  // submit button, so the choreography in button-machine.ts owns submission.
  // Binding both would submit twice.
  //
  // There is no `:state(disabled)` write here either: the shell already seats
  // `authorDisabled || effectiveDisabled` as the host custom state, and the
  // sheet selects `:host(:state(disabled))`. The class lane's
  //
  // The `open-click` dispatch is authored HERE, not only inside the helper: the
  // manifest's event recognizer is a module-local scan of dispatch sites, so a
  // helper-only dispatch silently drops the event from the published surface
  // (the same constraint open-dialog hit). The helper still owns the ordering
  // (fire, then act) and the disabled guard.
  return (
    <span
      style='display:contents'
      onClick={(event: Event) => {
        activateButton(hostOf(event), event, () => {
          hostOf(event).dispatchEvent(
            new globalThis.CustomEvent('open-click', { bubbles: true, composed: true }),
          );
        });
      }}
    >
      {props.href === '' ? (
        <button
          type='button'
          class='btn inline-flex items-center justify-center gap-2 font-sans font-extrabold no-underline cursor-pointer rounded-md whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-ring disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none aria-disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:pointer-events-none'
          part='control'
          disabled={props.disabled}
        >
          <slot></slot>
        </button>
      ) : (
        <a
          class='btn inline-flex items-center justify-center gap-2 font-sans font-extrabold no-underline cursor-pointer rounded-md whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-ring aria-disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:pointer-events-none'
          part='control'
          // #757/#1061: a disabled anchor loses its navigation target entirely.
          href={props.disabled ? null : props.href}
          target={props.target === '' ? null : props.target}
          rel={props.target === '_blank' ? 'noopener noreferrer' : null}
          aria-disabled={props.disabled ? 'true' : null}
        >
          <slot></slot>
        </a>
      )}
    </span>
  );
}

export default OpenButton;
