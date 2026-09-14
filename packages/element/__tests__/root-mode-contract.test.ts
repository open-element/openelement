/**
 * Public root-mode contract.
 *
 * The compiled Part Program's `root.kind` is public wire behavior: a
 * component with no `root` option must compile to light DOM (the current
 * default), and `{ root: 'shadow-open' | 'shadow-closed' }` must select the
 * matching shadow mode. The package README must state the same contract, so
 * the documentation and implementation cannot silently diverge again.
 */
import { assert, assertEquals } from '@std/assert';
import { compileElementProgram } from '../src/internal/compiler/semantic-core/compile.ts';

function compile(option: string): string {
  const source = `
import { element, OpenElement } from '@openelement/element';
@element('root-mode-probe'${option})
export default class RootModeProbe extends OpenElement {
  render() { return <div>probe</div>; }
}`;
  return compileElementProgram(source, '/project/app/components/root-mode-probe.tsx').program
    .root.kind;
}

Deno.test('root mode: no option compiles to the light default', () => {
  assertEquals(compile(''), 'light');
});

Deno.test('root mode: shadow-open and shadow-closed are explicit selections', () => {
  assertEquals(compile(", { root: 'shadow-open' }"), 'shadow-open');
  assertEquals(compile(", { root: 'shadow-closed' }"), 'shadow-closed');
});

Deno.test('root mode: the package README documents the same contract', async () => {
  const readme = await Deno.readTextFile(new URL('../README.md', import.meta.url));
  assert(
    readme.includes('Light DOM is the current compiled default'),
    'README must document light DOM as the current default',
  );
  assert(
    /Shadow\/DSD is a first-class mode selected explicitly/.test(readme),
    'README must document Shadow/DSD as an explicit first-class mode',
  );
});
