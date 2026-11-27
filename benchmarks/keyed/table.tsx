import { signal } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

export interface BenchRow {
  id: number;
  label: string;
}

export const openElement = defineIslandConfig({
  root: 'light',
  properties: { rows: { attribute: false, default: [] } },
});

// The micro suite's keyed ID and label workload, driven here by a real button
// in the browser. Assignment replaces the array but retains every row key.
function KeyedTable(props: { rows: BenchRow[] }) {
  const rows = signal(props.rows);
  const update = () => {
    const next = rows.value.slice();
    for (let index = 0; index < next.length; index += 10) {
      const row = next[index]!;
      next[index] = { id: row.id, label: row.label + ' !!!' };
    }
    rows.value = next;
  };
  return (
    <div>
      <button type='button' onClick={update}>
        Update every 10th row
      </button>
      <table>
        <tbody>
          {rows.value.map((row) => (
            <tr key={row.id} data-id={row.id}>
              <td>{row.id}</td>
              <td>
                <a>{row.label}</a>
              </td>
              <td>
                <a aria-label='Remove row'>×</a>
              </td>
              <td></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default KeyedTable;
