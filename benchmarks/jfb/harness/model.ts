/**
 * Deterministic pure model of the JFB table operations, used by the harness
 * self-check tests to prove the benchmark spec (warmup sequences + DOM
 * verification invariants) is internally consistent without a browser. The
 * model mirrors stock JFB store semantics: a module-level monotonically
 * increasing id counter, in-place label suffixing for partial update, and
 * index-1/998 swap. It contains no timing logic.
 */
import { type ClickTarget, CPU_BENCHMARKS, type CpuBenchmarkSpec, type RowCheck } from './spec.ts';

export interface ModelRow {
  id: number;
  label: string;
  cls: string;
}

export class JfbModel {
  rows: ModelRow[] = [];
  #idCounter = 1;

  buildData(count: number): ModelRow[] {
    const data: ModelRow[] = new Array(count);
    for (let i = 0; i < count; i++) {
      data[i] = { id: this.#idCounter++, label: `row label ${this.#idCounter}`, cls: '' };
    }
    return data;
  }

  run(): void {
    this.rows = this.buildData(1000);
  }

  runLots(): void {
    this.rows = this.buildData(10000);
  }

  add(): void {
    this.rows = this.rows.concat(this.buildData(1000));
  }

  update(): void {
    for (let i = 0; i < this.rows.length; i += 10) this.rows[i].label += ' !!!';
  }

  clear(): void {
    this.rows = [];
  }

  swapRows(): void {
    if (this.rows.length > 998) {
      const tmp = this.rows[1];
      this.rows[1] = this.rows[998];
      this.rows[998] = tmp;
    }
  }

  select(id: number): void {
    for (const row of this.rows) row.cls = row.id === id ? 'danger' : '';
  }

  remove(id: number): void {
    const idx = this.rows.findIndex((row) => row.id === id);
    this.rows = this.rows.slice(0, idx).concat(this.rows.slice(idx + 1));
  }

  click(target: ClickTarget): void {
    if (target.kind === 'button') {
      switch (target.id) {
        case 'run':
          return this.run();
        case 'runlots':
          return this.runLots();
        case 'add':
          return this.add();
        case 'update':
          return this.update();
        case 'clear':
          return this.clear();
        case 'swaprows':
          return this.swapRows();
        default:
          throw new Error(`unknown button target ${String(target.id)}`);
      }
    }
    const row = this.rows[(target.rowIndex ?? 0) - 1];
    if (!row) throw new Error(`row ${target.rowIndex} does not exist in model`);
    if (target.cell === 'label') this.select(row.id);
    else if (target.cell === 'remove') this.remove(row.id);
    else throw new Error(`unknown cell target ${String(target.cell)}`);
  }

  check(check: RowCheck): boolean {
    switch (check.kind) {
      case 'rowIdText': {
        const row = this.rows[check.rowIndex - 1];
        return !!row && String(row.id) === check.expected;
      }
      case 'rowLabelContains': {
        const row = this.rows[check.rowIndex - 1];
        return !!row && row.label.includes(check.expected);
      }
      case 'rowClassContains': {
        const row = this.rows[check.rowIndex - 1];
        return !!row && row.cls.split(/\s+/).includes(check.expected);
      }
      case 'rowCount':
        return this.rows.length === check.expected;
      case 'rowExists':
        return this.rows.length >= check.rowIndex;
    }
  }
}

/** Execute one full measured iteration of a spec against the model. */
export function executeIteration(model: JfbModel, spec: CpuBenchmarkSpec): void {
  spec.init.forEach((step, index) => {
    model.click(step);
    for (const verify of spec.initVerify) {
      if (verify.afterStep === index && !model.check(verify.check)) {
        throw new Error(
          `model check failed during ${spec.id} init step ${index}: ${JSON.stringify(
            verify.check,
          )}`,
        );
      }
    }
  });
  for (let sub = 0; sub < spec.subRuns; sub++) model.click(spec.measured);
  for (const check of spec.verify) {
    if (!model.check(check)) {
      throw new Error(`model verification failed for ${spec.id}: ${JSON.stringify(check)}`);
    }
  }
}

export function verifyAllSpecsAgainstModel(): void {
  for (const spec of CPU_BENCHMARKS) {
    const model = new JfbModel();
    executeIteration(model, spec);
  }
}
