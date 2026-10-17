/**
 * The server function component host dispatcher (R2, alpha15 server lane).
 *
 * `compileServerComponentIfAdmitted` is the ONE admission bridge a host build
 * calls after the class lane declined: it answers null for the class lane's
 * modules, for modules with no exported JSX-returning function, and for
 * non-TSX ids — and delegates to `compileServerComponentModule` otherwise,
 * threading the host options through unchanged (nested-component resolution
 * and the admitted @element compiled-host tag set).
 */

import { describe, expect, test } from 'vitest';
import { compileServerComponentIfAdmitted } from '../src/compiler.ts';

const FILE = '/proj/app/routes/home.tsx';

describe('compileServerComponentIfAdmitted: the admission bridge', () => {
  test('a module with an exported JSX-returning function admits through the server lane', () => {
    const result = compileServerComponentIfAdmitted(
      `
      export function Card(props: { name: string }) {
        return <article>{props.name}</article>;
      }
      `,
      FILE,
    );
    expect(result).not.toBeNull();
    expect(result!.components).toEqual(['Card']);
    expect(result!.code).toContain('__h("article"');
    expect(result!.code).toContain('__t(props.name)');
  });

  test('a module carrying the compiled-element decorator belongs to the class lane (null)', () => {
    const result = compileServerComponentIfAdmitted(
      `
      import { element, OpenElement } from '@openelement/element';
      @element('my-card')
      export default class MyCard extends OpenElement {
        render() { return <article>card</article>; }
      }
      `,
      FILE,
    );
    expect(result).toBeNull();
  });

  test('a module whose decorator provenance is unsupported stays on the class lane (null)', () => {
    const result = compileServerComponentIfAdmitted(
      `
      import { element } from './local.ts';
      @element('my-card')
      export default class MyCard {}
      export function Card(props: { name: string }) {
        return <article>{props.name}</article>;
      }
      `,
      FILE,
    );
    // The class lane compiles this module so it fails closed with OEC9027;
    // the server lane must not claim it.
    expect(result).toBeNull();
  });

  test('a module with no exported JSX-returning function answers null', () => {
    const result = compileServerComponentIfAdmitted(
      `export function helper(props: { name: string }) { return props.name; }`,
      FILE,
    );
    expect(result).toBeNull();
  });

  test('a non-tsx id never enters the server lane (null)', () => {
    const result = compileServerComponentIfAdmitted(
      `export function Card(props: { name: string }) { return props.name; }`,
      '/proj/app/routes/helper.ts',
    );
    expect(result).toBeNull();
  });

  test('the cheap prefilter keeps modules without export or JSX off the compile', () => {
    expect(compileServerComponentIfAdmitted(`const x = 1;`, FILE)).toBeNull();
    expect(compileServerComponentIfAdmitted(`export const x = 1;`, FILE)).toBeNull();
  });

  test('host options thread through: nested components resolve by source and compose by call', () => {
    const result = compileServerComponentIfAdmitted(
      `
      import { Shell } from './shell.tsx';
      export function Page(props: { name: string }) {
        return <Shell name={props.name}></Shell>;
      }
      `,
      FILE,
      {
        resolveModule: (specifier) =>
          specifier === './shell.tsx'
            ? `export function Shell(props: { name: string; children?: string }) {
                 return <div class="shell">{props.name}</div>;
               }`
            : undefined,
        compiledTags: ['oe-panel'],
      },
    );
    expect(result).not.toBeNull();
    expect(result!.code).toContain('Shell({');
  });

  test('an admitted compiled host tag rides __ssr through the dispatcher', () => {
    const result = compileServerComponentIfAdmitted(
      `
      export function Page(props: { name: string }) {
        return <oe-panel name={props.name}></oe-panel>;
      }
      `,
      FILE,
      { compiledTags: ['oe-panel'] },
    );
    expect(result).not.toBeNull();
    expect(result!.code).toContain('__ssr("oe-panel"');
  });

  test('the compiled candidates surface through the dispatcher result', () => {
    const result = compileServerComponentIfAdmitted(
      `
      export function Card(props: { name: string }) {
        return <article class="card surface">{props.name}</article>;
      }
      `,
      FILE,
    );
    expect(result).not.toBeNull();
    expect(result!.classCandidates ?? []).toEqual(['card', 'surface']);
  });
});
