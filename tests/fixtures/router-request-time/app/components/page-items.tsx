/**
 * /items page element — list morph continuity (compiled, v0.44).
 *
 * KNOWN GRAMMAR GAP (flagged in the alpha.8 integration report): the compiled
 * each-Region item templates carry exactly one {item.<field>} text slot and
 * no per-item attribute slots, so rows cannot emit id attributes
 * (`<li id="row-a">`). The morph client aligns id-keyed subtrees by element
 * id, so island identity across list reorder is positional here — the e2e
 * asserts island state survival and fresh-row hydration rather than id-keyed
 * identity until the Region schema gains item attribute slots.
 */
import { element, OpenElement, property } from '@openelement/element';

@element('items-page', { root: 'shadow-open' })
export default class ItemsPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  rows: Array<{ id: string; label: string }> = [];

  /** Serialized items for the hidden form field (the action reads `items`). */
  @property({ reflect: false, attribute: false })
  itemsValue = 'a,b';

  render() {
    return (
      <main>
        <form method='post' data-open-enhance>
          <input type='hidden' name='items' value={this.itemsValue} />
          <button id='prepend' type='submit'>Prepend</button>
          <button id='reverse' type='submit' formaction='?/reverse'>Reverse</button>
        </form>
        <ul>
          {this.rows.map((item) => (
            <li key={item.id}>
              <span class='row-label'>{item.label}</span>
              <live-counter></live-counter>
            </li>
          ))}
        </ul>
      </main>
    );
  }
}
