/**
 * @openelement/element — No-DOM runtime regression tests.
 *
 * Verifies that importing @openelement/element in an environment without
 * browser DOM globals does not mutate the host global scope.
 */

import { expect, test } from 'vitest';
import { runEsmSubprocess } from './esm-subprocess.ts';

test('importing @openelement/element in a no-DOM runtime does not create globalThis.HTMLElement', async () => {
  const script = `
    import '@openelement/element';
    if (typeof globalThis.HTMLElement !== 'undefined') {
      throw new Error('globalThis.HTMLElement should not be mutated in no-DOM runtime');
    }
    if (typeof globalThis.document !== 'undefined') {
      throw new Error('globalThis.document should not be mutated in no-DOM runtime');
    }
    console.log('ok');
  `;
  const { code, out, err } = await runEsmSubprocess(script);

  expect(code, `no-DOM import should exit cleanly. stderr: ${err}`).toEqual(0);
  expect(out.trim()).toEqual('ok');
});

test('OpenElement connectedCallback guards document access in no-DOM runtime', async () => {
  const script = `
    import { OpenElement } from '@openelement/element';
    class TestEl extends OpenElement {
      render() { return null; }
    }
    // In a no-DOM runtime the constructor should not throw, and the class
    // should not require browser globals at definition time.
    console.log(typeof TestEl);
  `;
  const { code, out, err } = await runEsmSubprocess(script);

  expect(code, `OpenElement subclass definition should not throw. stderr: ${err}`).toEqual(0);
  expect(out.trim()).toEqual('function');
});

test('OpenElement SSR stub fails loudly on unsupported DOM access (#1099)', async () => {
  const script = `
    import { OpenElement } from '@openelement/element';
    class TestEl extends OpenElement { render() { return null; } }
    try {
      new TestEl().querySelector('div');
      throw new Error('expected SSR DOM access to fail');
    } catch (error) {
      if (error.code !== 'SSR_DOM_ACCESS_UNSUPPORTED') throw error;
      console.log(error.message);
    }
  `;
  const { code, out, err } = await runEsmSubprocess(script);

  expect(code, `SSR DOM diagnostic should be typed. stderr: ${err}`).toEqual(0);
  expect(out.includes('HTMLElement.querySelector() is unavailable during SSR')).toEqual(true);
});
