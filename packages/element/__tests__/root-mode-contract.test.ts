/**
 * Public root-mode contract.
 *
 * The compiled Part Program's `root.kind` is public wire behavior: a
 * component with no `root` option must compile to light DOM (the current
 * default), and `{ root: 'shadow-open' | 'shadow-closed' }` must select the
 * matching shadow mode. The package README must state the same contract, so
 * the documentation and implementation cannot silently diverge again.
 */
import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { compileElementProgram } from '../../../packages/compiler/src/internal/compiler/semantic-core/compile.ts';

function compile(option: string): string {
  const source = `
import { element, OpenElement } from '@openelement/element';
@element('root-mode-probe'${option})
export default class RootModeProbe extends OpenElement {
  render() { return <div>probe</div>; }
}`;
  return compileElementProgram(source, '/project/app/components/root-mode-probe.tsx').program.root
    .kind;
}

test('root mode: no option compiles to the light default', () => {
  expect(compile('')).toEqual('light');
});

test('root mode: shadow-open and shadow-closed are explicit selections', () => {
  expect(compile(", { root: 'shadow-open' }")).toEqual('shadow-open');
  expect(compile(", { root: 'shadow-closed' }")).toEqual('shadow-closed');
});

test('root mode: the package README documents the same contract', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  expect(
    readme.includes('Light DOM is the current compiled default'),
    'README must document light DOM as the current default',
  ).toBeTruthy();
  expect(
    /Shadow\/DSD is a first-class mode selected explicitly/.test(readme),
    'README must document Shadow/DSD as an explicit first-class mode',
  ).toBeTruthy();
});
