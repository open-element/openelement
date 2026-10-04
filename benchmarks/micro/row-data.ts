/**
 * Row data for the micro suite's keyed-table fixture (#1219).
 *
 * This module is imported by the compiled element (compiled-module grammar
 * admits imports; the generated module copies them verbatim). The algorithm
 * is the verbatim stock js-framework-benchmark data generator — same word
 * lists, same _random, same module-level monotonically increasing id counter
 * as the stock preact-signals implementation — so the rows are
 * distributionally identical to every stock implementation's rows.
 */

let idCounter = 1;

const adjectives = [
  'pretty',
  'large',
  'big',
  'small',
  'tall',
  'short',
  'long',
  'handsome',
  'plain',
  'quaint',
  'clean',
  'elegant',
  'easy',
  'angry',
  'crazy',
  'helpful',
  'mushy',
  'odd',
  'unsightly',
  'adorable',
  'important',
  'inexpensive',
  'cheap',
  'expensive',
  'fancy',
];
const colours = [
  'red',
  'yellow',
  'blue',
  'green',
  'pink',
  'brown',
  'purple',
  'brown',
  'white',
  'black',
  'orange',
];
const nouns = [
  'table',
  'chair',
  'house',
  'bbq',
  'desk',
  'car',
  'pony',
  'cookie',
  'sandwich',
  'burger',
  'pizza',
  'mouse',
  'keyboard',
];

function _random(max: number): number {
  return Math.round(Math.random() * 1000) % max;
}

export interface BenchRow {
  id: number;
  label: string;
  /** Carries selection state so the keyed Region diff writes class changes. */
  cls: string;
}

export function buildData(count: number): BenchRow[] {
  const data: BenchRow[] = new Array(count);
  for (let i = 0; i < count; i++) {
    data[i] = {
      id: idCounter++,
      label: `${adjectives[_random(adjectives.length)]} ${colours[_random(colours.length)]} ${
        nouns[_random(nouns.length)]
      }`,
      cls: '',
    };
  }
  return data;
}
