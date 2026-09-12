/**
 * /dropdown page — qualifies open-dropdown (popover-API dropdown) on the
 * compiled framework (#1226): trigger toggle (pointerdown/click guard),
 * light dismiss, Escape close, and the per-instance anchor pair.
 */
import { element, OpenElement } from '@openelement/element';
import '@openelement/ui/open-dropdown';

@element('dropdown-page', { root: 'shadow-open' })
export default class DropdownPage extends OpenElement {
  render() {
    return (
      <main>
        <h1>ui dogfood — dropdown</h1>
        <open-dropdown id='main-dropdown'>
          <button slot='trigger' id='dropdown-trigger' type='button'>Menu</button>
          <div role='menu' id='dropdown-menu'>
            <button role='menuitem' id='menu-item-1' type='button'>First action</button>
            <button role='menuitem' id='menu-item-2' type='button'>Second action</button>
          </div>
        </open-dropdown>
        <button id='outside' type='button'>Outside</button>
      </main>
    );
  }
}
