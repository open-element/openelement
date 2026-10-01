/**
 * js-framework-benchmark keyed implementation for OpenElement (issue #1219).
 *
 * One meaningful component boundary manages ordinary table DOM: the rows are
 * plain <tr> nodes owned by a single keyed `each` Region — NOT one custom
 * element per row. Row select/remove use one delegated click handler on the
 * table because grammar v1 admits no per-item event handlers; selection is
 * carried in row data (`cls`) so the keyed diff writes exactly the affected
 * class attributes, matching stock JFB select semantics (vanillajs touches
 * two rows). The jumbotron buttons are part of the component, matching the
 * stock JFB page structure.
 */
import { element, OpenElement, property } from '@openelement/element';
import { buildData, type JfbRow } from './data.ts';

@element('jfb-oe-table')
export class JfbOeTable extends OpenElement {
  @property({ reflect: false })
  rows: JfbRow[] = [];

  run(): void {
    this.rows = buildData(1000);
  }

  runLots(): void {
    this.rows = buildData(10000);
  }

  add(): void {
    this.rows = this.rows.concat(buildData(1000));
  }

  update(): void {
    const data = this.rows.slice();
    for (let i = 0; i < data.length; i += 10) {
      const row = data[i];
      data[i] = { id: row.id, label: `${row.label} !!!`, cls: row.cls };
    }
    this.rows = data;
  }

  clear(): void {
    this.rows = [];
  }

  swapRows(): void {
    if (this.rows.length > 998) {
      const data = this.rows.slice();
      const tmp = data[1];
      data[1] = data[998];
      data[998] = tmp;
      this.rows = data;
    }
  }

  select(id: number): void {
    const data = this.rows.slice();
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      if (row.id === id && row.cls !== 'danger') {
        data[i] = { id: row.id, label: row.label, cls: 'danger' };
      } else if (row.id !== id && row.cls === 'danger') {
        data[i] = { id: row.id, label: row.label, cls: '' };
      }
    }
    this.rows = data;
  }

  remove(id: number): void {
    const idx = this.rows.findIndex((row) => row.id === id);
    this.rows = this.rows.slice(0, idx).concat(this.rows.slice(idx + 1));
  }

  handleTableClick(event: unknown): void {
    let node = (event as Event).target as HTMLElement | null;
    let action: 'select' | 'remove' | undefined;
    while (node) {
      if (node.tagName === 'A') {
        action =
          node.parentElement?.tagName === 'TD' &&
          node.parentElement.previousElementSibling !== null &&
          node.parentElement.previousElementSibling.previousElementSibling === null
            ? 'select'
            : 'remove';
        break;
      }
      if (node.tagName === 'TABLE') return;
      node = node.parentElement;
    }
    let row = (event as Event).target as HTMLElement | null;
    while (row && row.tagName !== 'TR') row = row.parentElement;
    if (!action || !row) return;
    const id = Number(row.getAttribute('data-id'));
    if (action === 'remove') this.remove(id);
    else this.select(id);
  }

  render() {
    return (
      <div class='container'>
        <div class='jumbotron'>
          <div class='row'>
            <div class='col-md-6'>
              <h1>OpenElement keyed</h1>
            </div>
            <div class='col-md-6'>
              <div class='row'>
                <div class='col-sm-6 smallpad'>
                  <button
                    type='button'
                    class='btn btn-primary btn-block'
                    id='run'
                    onClick={this.run}
                  >
                    Create 1,000 rows
                  </button>
                </div>
                <div class='col-sm-6 smallpad'>
                  <button
                    type='button'
                    class='btn btn-primary btn-block'
                    id='runlots'
                    onClick={this.runLots}
                  >
                    Create 10,000 rows
                  </button>
                </div>
                <div class='col-sm-6 smallpad'>
                  <button
                    type='button'
                    class='btn btn-primary btn-block'
                    id='add'
                    onClick={this.add}
                  >
                    Append 1,000 rows
                  </button>
                </div>
                <div class='col-sm-6 smallpad'>
                  <button
                    type='button'
                    class='btn btn-primary btn-block'
                    id='update'
                    onClick={this.update}
                  >
                    Update every 10th row
                  </button>
                </div>
                <div class='col-sm-6 smallpad'>
                  <button
                    type='button'
                    class='btn btn-primary btn-block'
                    id='clear'
                    onClick={this.clear}
                  >
                    Clear
                  </button>
                </div>
                <div class='col-sm-6 smallpad'>
                  <button
                    type='button'
                    class='btn btn-primary btn-block'
                    id='swaprows'
                    onClick={this.swapRows}
                  >
                    Swap Rows
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <table class='table table-hover table-striped test-data' onClick={this.handleTableClick}>
          <tbody id='tbody'>
            {this.rows.map((row) => (
              <tr key={row.id} data-id={row.id} class={row.cls}>
                <td class='col-md-1'>{row.id}</td>
                <td class='col-md-4'>
                  <a>{row.label}</a>
                </td>
                <td class='col-md-1'>
                  <a>
                    <span class='glyphicon glyphicon-remove' aria-hidden='true'></span>
                  </a>
                </td>
                <td class='col-md-6'></td>
              </tr>
            ))}
          </tbody>
        </table>
        <span class='preloadicon glyphicon glyphicon-remove' aria-hidden='true'></span>
      </div>
    );
  }
}
