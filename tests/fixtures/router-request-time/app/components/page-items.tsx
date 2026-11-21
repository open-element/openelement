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
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ tag: 'items-page', root: 'shadow' });

interface ItemsPageProps {
  rows?: Array<{ id: string; label: string }>;
  itemsValue?: string;
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
