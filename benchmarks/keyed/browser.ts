interface BenchRow {
  id: number;
  label: string;
}

type TableHost = HTMLElement & { rows: BenchRow[] };

export function installBenchmark(
  Table: CustomElementConstructor,
  { tag, rowCount, updates }: { tag: string; rowCount: number; updates: number },
) {
  customElements.define(tag, Table);
  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  async function runKeyedSample(): Promise<number> {
    const host = document.createElement(tag) as TableHost;
    const data = Array.from({ length: rowCount }, (_, index) => ({
      id: index + 1,
      label: `row ${index + 1}`,
    }));
    host.rows = data;
    document.body.append(host);
    try {
      await frame();
      const update = host.querySelector('button');
      const before = [...host.querySelectorAll('tbody tr')];
      if (!update || before.length !== rowCount) throw new Error('Keyed table did not mount');

      const start = performance.now();
      for (let iteration = 0; iteration < updates; iteration++) update.click();
      const elapsed = performance.now() - start;

      const after = [...host.querySelectorAll('tbody tr')];
      if (after.length !== rowCount) throw new Error('Keyed update changed the row count');
      for (const [index, row] of data.entries()) {
        const element = after[index]!;
        const expected = row.label + (index % 10 === 0 ? ' !!!'.repeat(updates) : '');
        if (
          element !== before[index] ||
          element.getAttribute('data-id') !== String(row.id) ||
          element.querySelector('a')?.textContent !== expected
        ) {
          throw new Error(`Keyed identity or label changed incorrectly at row ${row.id}`);
        }
      }
      return elapsed;
    } finally {
      host.remove();
      await frame();
    }
  }

  Object.assign(globalThis, { runKeyedSample });
}
