/**
 * M14 full-await slice of the alpha15 server function lane.
 *
 * Supported: an async function or async arrow whose body is still one JSX
 * return, with `await load()`, `await load(<literal or props.field>)`, or
 * `await props.field` in a text child or a nested server-component prop.
 * An async parent awaits an imported async child. Synchronous components keep
 * their previous emission. Everything else in this file is a located OEC9032.
 *
 * Executing the awaited HTML is the router function-page chain, which calls
 * the published renderFunctionPageAwaited seam. Emission rows use the direct
 * compile entry. Near-miss rows that the fact scan does not count (statements
 * before the return, a block-bodied async arrow) go through
 * `compiledElementPlugin`, the production transform: the admission bridge must
 * report OEC9032 and must not return null.
 */
import { describe, expect, test } from 'vitest';
import { compiledElementPlugin } from '../src/compiler.ts';
import {
  compileServerComponentIfAdmitted,
  compileServerComponentModule,
} from '../src/internal/compiler/semantic-core/server-component.ts';
import { CompiledElementError } from '../src/internal/compiler/semantic-core/compiler-diagnostics.ts';

const FILE = '/proj/app/server/page.tsx';

function compile(source: string, resolveModule?: (specifier: string) => string | undefined) {
  return compileServerComponentModule(
    source,
    FILE,
    resolveModule === undefined ? {} : { resolveModule },
  );
}

function codesOf(
  source: string,
  resolveModule?: (specifier: string) => string | undefined,
): string[] {
  try {
    compile(source, resolveModule);
  } catch (error) {
    expect(error).toBeInstanceOf(CompiledElementError);
    return (error as CompiledElementError).diagnostics.map((diagnostic) => diagnostic.code);
  }
  throw new Error('the compile returned; a diagnostic was expected');
}

/**
 * The production transform. `compiledElementPlugin` calls
 * `compileServerComponentIfAdmitted`; a near-miss must fail that hook closed
 * (OEC9032 on `this.error`) and must not come back as null, which is how the
 * host would leave the authored module on another lane.
 */
function productionRefusal(source: string): { returned: unknown; message: string } {
  const plugin = compiledElementPlugin();
  const transform = plugin.transform;
  if (typeof transform !== 'function') {
    throw new Error('compiledElementPlugin transform is not a function');
  }
  let returned: unknown = undefined;
  let thrown: unknown;
  try {
    returned = transform.call(
      {
        error(message: unknown): never {
          throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
        },
      } as never,
      source,
      FILE,
    );
  } catch (error) {
    thrown = error;
  }
  return {
    returned,
    message: thrown instanceof Error ? thrown.message : '',
  };
}

function admissionRefusal(source: string): { returned: unknown; codes: string[] } {
  try {
    return { returned: compileServerComponentIfAdmitted(source, FILE), codes: [] };
  } catch (error) {
    expect(error).toBeInstanceOf(CompiledElementError);
    return {
      returned: undefined,
      codes: (error as CompiledElementError).diagnostics.map((diagnostic) => diagnostic.code),
    };
  }
}

function expectProductionOEC9032(source: string): void {
  const pluginResult = productionRefusal(source);
  expect(pluginResult.returned).not.toBeNull();
  expect(pluginResult.returned).toBeUndefined();
  expect(pluginResult.message).toContain('OEC9032');
  expect(pluginResult.message).toContain('not an admitted server function component');
  const admitted = admissionRefusal(source);
  expect(admitted.returned).not.toBeNull();
  expect(admitted.returned).toBeUndefined();
  expect(admitted.codes).toEqual(['OEC9032']);
}

describe('full-await emission stays inside the admitted grammar', () => {
  test('a synchronous component keeps the previous function shape', () => {
    const result = compile(`
      export function Card(props: { name: string }) {
        return <article>{props.name}</article>;
      }
    `);
    expect(result!.code).toContain('export function Card(props: { name: string })');
    expect(result!.code).not.toContain('async function Card');
    expect(result!.code).toContain('__t(props.name)');
  });

  test('an async function awaits a call before the text helper runs', () => {
    const result = compile(`
      export async function Page() {
        return <p>{await pending()}</p>;
      }
    `);
    expect(result!.code).toContain('export async function Page()');
    expect(result!.code).toContain('__t(await pending())');
    expect(result!.code).not.toContain('<p>');
  });

  test('an async arrow keeps async on the generated const', () => {
    const result = compile(`
      export const Page = async (props: { id: string }) => <p>{await load(props.id)}</p>;
    `);
    expect(result!.code).toContain('export const Page = async (props: { id: string }) =>');
    expect(result!.code).toContain('__t(await load(props.id))');
  });

  test('an async parent awaits an imported async child, in source order', () => {
    const result = compile(
      `
        import { Child } from './child.tsx';
        export async function Page() {
          return <article>{await mark("a")}<Child n="b" /></article>;
        }
      `,
      (specifier) =>
        specifier === './child.tsx'
          ? `export async function Child(props: { n: string }) {
               return <span>{await mark(props.n)}</span>;
             }`
          : undefined,
    );
    const body = result!.code;
    const textAt = body.indexOf('__t(await mark("a"))');
    const childAt = body.indexOf('await Child({');
    expect(textAt).toBeGreaterThan(0);
    expect(childAt).toBeGreaterThan(textAt);
    expect(body).toContain('"n": "b"');
  });

  test('the artifact still imports only the server helper entry', () => {
    const result = compile(`
      export async function Page() {
        return <p>{await pending()}</p>;
      }
    `);
    const runtimeImports = result!.code
      .split('\n')
      .filter((line) => line.startsWith('import ') && !line.startsWith('import type '));
    expect(runtimeImports).toEqual(["import { __h, __t } from '@openelement/element/server';"]);
  });
});

describe('full-await refusals stay located OEC9032', () => {
  test('a synchronous parent cannot render an async child', () => {
    expect(
      codesOf(
        `
          import { Child } from './child.tsx';
          export function Page() {
            return <Child />;
          }
        `,
        (specifier) =>
          specifier === './child.tsx'
            ? `export async function Child() { return <span>{await pending()}</span>; }`
            : undefined,
      ),
    ).toEqual(['OEC9032']);
  });

  test('statements before the return fail closed on the production transform', () => {
    expectProductionOEC9032(`
      export async function Page() {
        const title = await pending();
        return <p>{title}</p>;
      }
    `);
  });

  test('an await in an attribute is refused', () => {
    expect(
      codesOf(`
        export async function Page() {
          return <p title={await pending()}>x</p>;
        }
      `),
    ).toEqual(['OEC9032']);
  });

  test('an await inside a condition is refused', () => {
    expect(
      codesOf(`
        export async function Page() {
          return <div>{await pending() ? <p>a</p> : <p>b</p>}</div>;
        }
      `),
    ).toEqual(['OEC9032']);
  });

  test('an arbitrary awaited expression is refused', () => {
    expect(
      codesOf(`
        export async function Page(props: { name: string }) {
          return <p>{await props.name + "!"}</p>;
        }
      `),
    ).toEqual(['OEC9032']);
  });

  test('a block-bodied async arrow fails closed on the production transform', () => {
    expectProductionOEC9032(`
      export const Page = async () => {
        return <p>{await pending()}</p>;
      };
    `);
  });
});
