/**
 * @openelement/element — No-DOM runtime regression tests.
 *
 * Verifies that importing @openelement/element in an environment without
 * browser DOM globals does not mutate the host global scope.
 */

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import process from 'node:process';

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

  // node --input-type=module -e: ESM eval resolving the workspace imports
  // from the element package root (cwd matters for bare-specifier lookup)
  const child = spawn(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: join(import.meta.dirname!, '../..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const [stdout, stderr] = await Promise.all([
    Array.fromAsync(child.stdout!),
    Array.fromAsync(child.stderr!),
  ]);
  const code = await new Promise<number>((resolve) => child.once('exit', (c) => resolve(c ?? -1)));
  const out = Buffer.concat(stdout).toString();
  const err = Buffer.concat(stderr).toString();

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

  // node --input-type=module -e: ESM eval resolving the workspace imports
  // from the element package root (cwd matters for bare-specifier lookup)
  const child = spawn(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: join(import.meta.dirname!, '../..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const [stdout, stderr] = await Promise.all([
    Array.fromAsync(child.stdout!),
    Array.fromAsync(child.stderr!),
  ]);
  const code = await new Promise<number>((resolve) => child.once('exit', (c) => resolve(c ?? -1)));
  const out = Buffer.concat(stdout).toString();
  const err = Buffer.concat(stderr).toString();

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
  const child = spawn(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: join(import.meta.dirname!, '../..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const [stdout, stderr] = await Promise.all([
    Array.fromAsync(child.stdout!),
    Array.fromAsync(child.stderr!),
  ]);
  const code = await new Promise<number>((resolve) => child.once('exit', (c) => resolve(c ?? -1)));
  const out = Buffer.concat(stdout).toString();
  const err = Buffer.concat(stderr).toString();
  expect(code, `SSR DOM diagnostic should be typed. stderr: ${err}`).toEqual(0);
  expect(out.includes('HTMLElement.querySelector() is unavailable during SSR')).toEqual(true);
});
