/**
 * @openelement/ui - open-input
 *
 * Form-associated text input with a label, an inline error slot, and native
 * constraint validation (required -> valueMissing through the shell's M09-2d
 * form mapping).
 *
 * Experimental (owner ruling C1, #1468): internal implementation may change or
 * be removed before 1.0; the declared `::part` names follow the
 * CUSTOMIZATION.md contract (`::part` names never shrink).
 *
 * Generated authoring. The declared rows drive the compiled sinks; the derived
 * visibility/ARIA surface is authored as inline JSX expressions (the generated
 * lane has no authoring `computed`), and the FORM CONTRACT (setFormValue,
 * required validity, reset/restore, fieldset states) is the SHELL's mapping.
 * `input-machine.ts` only projects the live value and the disabled surface
 * (ADR-0182).
 *
 * TWO CONSTRAINTS SHAPE THIS TEMPLATE, and both come from the generated lane:
 *
 * 1. No `value={…}` binding. That name classifies as a DOM-IDL `property`
 *    channel, and a property slot makes the whole component mount-only — losing
 *    the SSR producer and the claim path.
 * 2. Every id is STATIC and therefore part of the compiled attribute seed. A
 *    claim verifies each node's static attributes, so an id written at connect
 *    time would fail it with OEIR_LEAF_CLAIM_MISMATCH. A shadow root is its own
 *    id scope, so the same spelling in every instance is correct — the class
 *    lane's realm-unique counter existed only to keep SSR and CSR agreeing on a
 *    document-wide identity, which the shadow boundary makes unnecessary.
 *
 * @csspart wrapper -The outer input-wrapper div
 * @csspart label -The label element
 * @csspart control -The input element
 * @csspart error -The error message small element
 *
 * Usage:
 * ```html
 * <open-input placeholder="Enter text"></open-input>
 * <open-input type="email" label="Email"></open-input>
 * <form>
 *   <open-input name="username" label="Username"></open-input>
 *   <button type="submit">Submit</button>
 * </form>
 * ```
 */
import { onConnect, onPropertyChange } from '@openelement/element';

import { defineComponentConfig } from './component-config.ts';
import { syncInputDisabled, syncInputValue, type InputHost } from './input-machine.ts';

export const openElement = defineComponentConfig({
  root: 'shadow',
  delegatesFocus: true,
  formAssociated: true,
  styles: ['./open-input.css'],
  properties: {
    type: { default: 'text' },
    placeholder: { default: '' },
    label: { default: '' },
    name: { default: '' },
    value: { default: '' },
    disabled: { default: false },
    required: { default: false },
    error: { default: '' },
  },
});

/** Form-associated text input with a label, an error slot and native validity. */
function OpenInput(props: {
  type: string;
  placeholder: string;
  label: string;
  name: string;
  value: string;
  disabled: boolean;
  required: boolean;
  error: string;
}) {
  // EVERY row-derived value below is spelled INLINE at its JSX position, on
  // purpose. The compiler derives a sink's dependency from the reads it can see
  // in the expression it emits: `hidden={noError}` sees a local, so it emits a
  // setup-time one-shot with no `error` edge and never refreshes; the member
  // read `props.error` inside the expression is what puts the sink on the
  // `error` row's refresh channel. Naming these in locals is therefore not
  // styling — it silently makes the whole error surface SSR-only.
  const hostOf = (event: Event): InputHost =>
    ((event.currentTarget as HTMLElement).getRootNode() as ShadowRoot).host as InputHost;

  // The fieldset-effective disabled state has ONE consumable channel and this is
  // it: the shell writes `authorDisabled || effectiveDisabled` into the host's
  // CustomStateSet, and event-time code reads the same set through the standard
  // `:state(disabled)` selector (m09-2d-forms.md, seams.md). The `props.disabled`
  // sink does NOT change on a fieldset disable, so without this guard a user can
  // still type into a locked control and the keystrokes reach the host's value
  // row — the class lane prevented that by mirroring `formDisabledCallback` onto
  // the inner `input`, which the generated lane cannot reach (the shell owns the
  // internals record, not the component's DOM).
  const lockedByFieldset = (event: Event): boolean => hostOf(event).matches(':state(disabled)');

  onConnect((env) => {
    // Only the control's live PROPERTY is written here: values are not part of
    // the claim's attribute seed, whereas an id written at this point would be.
    syncInputValue(env.host as InputHost);
  });
  onPropertyChange((event) => {
    const host = event.host as InputHost;
    if (event.name === 'value') {
      syncInputValue(host);
      return;
    }
    if (event.name === 'disabled') {
      syncInputDisabled(host);
    }
  });

  return (
    <div class='flex flex-col gap-2' part='wrapper'>
      <label
        class='text-sm font-medium text-muted-foreground tracking-normal'
        part='label'
        for='open-input-control'
        hidden={props.label === ''}
      >
        {props.label}
        <span class='required-mark'></span>
      </label>
      <input
        class='control w-full px-3 py-2 font-sans text-base text-foreground rounded-md outline-none transition-[border-color,box-shadow] duration-200 ease-out placeholder:text-muted-foreground'
        part='control'
        id='open-input-control'
        type={props.type}
        placeholder={props.placeholder}
        name={props.name}
        disabled={props.disabled}
        required={props.required}
        aria-invalid={props.error === '' ? null : 'true'}
        aria-describedby={props.error === '' ? null : 'open-input-error'}
        aria-errormessage={props.error === '' ? null : 'open-input-error'}
        onInput={(event: Event) => {
          const host = hostOf(event);
          const control = event.target as HTMLInputElement;
          // A fieldset lock reaches this control ONLY as the host's custom
          // state (the shell owns the internals record, not this DOM), so the
          // guard has to be here, at the interaction. Refusing the publish keeps
          // the value row and FormData clean; re-projecting the row onto the
          // live control also retracts the keystroke the platform already
          // inserted, so a locked field never shows text it will not submit.
          if (lockedByFieldset(event)) {
            syncInputValue(host);
            return;
          }
          host.value = control.value;
          if (host.getAttribute('value') !== control.value) {
            host.setAttribute('value', control.value);
          }
          host.dispatchEvent(
            new globalThis.CustomEvent('open-input', {
              detail: { value: control.value },
              bubbles: true,
              composed: true,
            }),
          );
        }}
        onChange={(event: Event) => {
          if (lockedByFieldset(event)) return;
          const control = event.target as HTMLInputElement;
          hostOf(event).dispatchEvent(
            new globalThis.CustomEvent('open-change', {
              detail: { value: control.value },
              bubbles: true,
              composed: true,
            }),
          );
        }}
        onFocus={(event: Event) => {
          hostOf(event).dispatchEvent(
            new globalThis.CustomEvent('open-focus', { bubbles: true, composed: true }),
          );
        }}
        onBlur={(event: Event) => {
          hostOf(event).dispatchEvent(
            new globalThis.CustomEvent('open-blur', { bubbles: true, composed: true }),
          );
        }}
      />
      <small
        id='open-input-error'
        role='alert'
        class='text-xs text-destructive'
        part='error'
        hidden={props.error === ''}
      >
        {props.error}
      </small>
    </div>
  );
}

export default OpenInput;
