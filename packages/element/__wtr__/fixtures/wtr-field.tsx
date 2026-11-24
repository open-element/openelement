/**
 * Element browser conformance fixture (#1333): minimal form-associated custom
 * element (FACE).
 *
 * WHAT THE PLATFORM NEEDS. One form-associated host whose `value` travels in
 * FormData, whose `required` row raises the valueMissing constraint, and whose
 * reset restores the declared default. That is exactly the shell's bounded
 * forms contract (M09-2d/2e): the declared sidecar rows ARE the form contract,
 * and there is no author internals API — the retired class fixture's
 * hand-written `setFormValue`/`setValidity`/`formResetCallback` mirroring is
 * now the shell's job, so re-deriving it in the component would create a
 * second source of truth for the same platform facts.
 *
 * WHAT THE COMPONENT STILL OWNS. The inner native <input> lives in the shadow
 * root, so typing in it must reach the host property: the `onInput` handler
 * writes `host.value`, and the `value` binding re-renders the input from that
 * same property (in place — the focused node is never replaced).
 */
import { defineIslandConfig } from '@openelement/router';
import { useHost } from '@openelement/element/lifecycle';

export const openElement = defineIslandConfig({
  root: 'shadow',
  formAssociated: true,
  properties: {
    value: { default: '' },
    name: {},
    required: { default: false },
  },
});

function WtrField(props: { value: string; name: string; required: boolean }) {
  // Typing reaches the host's own declared `value` row: the inner input's
  // `onInput` writes it, and the same property is what the shell reports to
  // the form.
  const host = useHost() as HTMLElement & { value: string };
  return (
    <input
      type='text'
      value={props.value}
      name={props.name}
      required={props.required}
      onInput={(event: Event) => {
        host.value = (event.target as HTMLInputElement).value;
      }}
    />
  );
}

export default WtrField;
