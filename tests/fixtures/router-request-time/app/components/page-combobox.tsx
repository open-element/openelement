/**
 * /combobox page element — request-time page for the #1149 Zag composition
 * spike (compiled, v0.44).
 *
 * Hosts:
 * - two shadow/DSD `zag-combobox` islands (machine-id shadow-a / shadow-b)
 *   for the ShadowRoot-scoping and lifecycle evidence — nested as
 *   custom-element hosts and expanded server-side by the generated entry;
 * - one light-mode `zag-combobox-light` island inside a native form, proving
 *   form submission semantics (the light input shares the page's tree, so the
 *   POST body carries the selected fruit);
 * - a #move-target container used by the e2e spec for same-turn DOM moves.
 *
 * GENERATED lane (F16: class → function). `selectedEcho` stays
 * `attribute: false` (the route projects ?selected= in-process and the class
 * never had an attribute wire for it); the typed props record still needs a
 * sidecar entry, so the row keeps the property-only spelling. The page keeps
 * its `shadow` root because every spec in the file reaches the combobox hosts
 * through `combobox-page.shadowRoot`.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'combobox-page',
  root: 'shadow',
  properties: {
    selectedEcho: { attribute: false, default: 'selected=' },
  },
});

interface ComboboxPageProps {
  selectedEcho: string;
}

export default function ComboboxPage(props: ComboboxPageProps) {
  return (
    <main>
      <h1>zag combobox spike</h1>
      <section id='shadow-pair'>
        <zag-combobox machine-id='shadow-a'></zag-combobox>
        <zag-combobox machine-id='shadow-b'></zag-combobox>
      </section>
      <form id='fruit-form' method='post'>
        <zag-combobox-light machine-id='light-fruit'></zag-combobox-light>
        <button id='submit-fruit' type='submit'>Submit fruit</button>
      </form>
      <p id='selected-echo'>{props.selectedEcho}</p>
      <div id='move-target'></div>
    </main>
  );
}
