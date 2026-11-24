/**
 * /items page element — list morph continuity (compiled, v0.44).
 *
 * KNOWN GRAMMAR GAP (flagged in the alpha.8 integration report): the compiled
 * each-Block item templates carry exactly one {item.<field>} text slot and no
 * per-item attribute slots, so rows cannot emit id attributes (`<li id="row-a">`).
 * The morph client aligns id-keyed subtrees by element id, so island identity
 * across list reorder is positional here — the e2e asserts island state survival
 * and fresh-row hydration rather than id-keyed identity until the Block schema
 * gains item attribute slots.
 *
 * GENERATED lane (F16: class → function). The class lane's two `@property` fields
 * become props; `root` stays `shadow` so the page keeps the open DSD root the
 * shadow-walker helpers pierce.
 *
 * The sidecar's `properties` table is REQUIRED, not decoration: a generated
 * root's props parameter must be fully replaced by declared rows. Without it the
 * lane refuses the module (`OEIR_GENERATED_ELEMENT_UNDECLARED_PROPS`), the scan
 * records no compiler-owned host producer for it, and page classification then
 * fails the whole build for /items with `light-no-producer` — the measured
 * pre-existing break this table fixes. The members are declared REQUIRED with
 * the initial value in the sidecar default: an optional member is refused
 * separately (`OEIR_GENERATED_ELEMENT_PROPS_TYPE_UNSUPPORTED` — "the generated
 * element always supplies a value"). `rows` is a property-only array row, so it
 * crosses the SSR→claim seam through the `data-oe-prop-seed` JSON channel
 * (ADR-0182 D-18c / ADR-0181 A5).
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'items-page',
  root: 'shadow',
  properties: {
    rows: { attribute: false, default: [] },
    itemsValue: { attribute: false, default: 'a,b' },
  },
});

interface ItemsPageProps {
  rows: Array<{ id: string; label: string }>;
  itemsValue: string;
}

export default function ItemsPage(props: ItemsPageProps) {
  const rows = props.rows ?? [];
  const itemsValue = props.itemsValue ?? 'a,b';
  return (
    <main>
      <form method="post" data-open-enhance>
        <input type="hidden" name="items" value={itemsValue} />
        <button id="prepend" type="submit">
          Prepend
        </button>
        <button id="reverse" type="submit" formaction="?/reverse">
          Reverse
        </button>
      </form>
      <ul>
        {rows.map((item) => (
          <li key={item.id}>
            <span class="row-label">{item.label}</span>
            <live-counter></live-counter>
          </li>
        ))}
      </ul>
    </main>
  );
}
