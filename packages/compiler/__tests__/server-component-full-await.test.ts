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
 *
 * M14-1 pins the refusal MESSAGE contract: every refused position prints the
 * stable head sentence plus its own clause naming the position and the nearest
 * lawful spelling (no admission change; the code stays OEC9032). M14-2 pins
 * "a Promise is not a normal child": a `Promise<...>`-annotated prop read at a
 * text/attribute sink is refused at the read, `{await props.p}` stays admitted,
 * and the class path keeps today's behavior. The `__t` runtime backstop for
 * untyped props is pinned in the element suite (`server-html.test.ts`).
 */
import { describe, expect, test } from 'vitest';
import { compiledElementPlugin } from '../src/compiler.ts';
import {
  compileServerComponentIfAdmitted,
  compileServerComponentModule,
} from '../src/internal/compiler/semantic-core/server-component.ts';
import { compileElementProgram } from '../src/internal/compiler/semantic-core/compile.ts';
import {
  CompiledElementError,
  type ElementCompilerDiagnostic,
} from '../src/internal/compiler/semantic-core/compiler-diagnostics.ts';
import type { ServerComponentCompileOptions } from '../src/internal/compiler/semantic-core/server-component.ts';

const FILE = '/proj/app/server/page.tsx';

function compile(
  source: string,
  options: ServerComponentCompileOptions = {},
): ReturnType<typeof compileServerComponentModule> {
  return compileServerComponentModule(source, FILE, options);
}

function codesOf(source: string, options: ServerComponentCompileOptions = {}): string[] {
  return diagnosticsOf(source, options).map((diagnostic) => diagnostic.code);
}

function diagnosticsOf(
  source: string,
  options: ServerComponentCompileOptions = {},
): ElementCompilerDiagnostic[] {
  try {
    compile(source, options);
  } catch (error) {
    expect(error).toBeInstanceOf(CompiledElementError);
    return (error as CompiledElementError).diagnostics;
  }
  throw new Error('the compile returned; a diagnostic was expected');
}

/**
 * The authored position of `fragment` in `source`, 1-based. Every located
 * refusal below asserts the code AND the line/character of the node the
 * author wrote, not just that some diagnostic exists.
 */
function locationOf(source: string, fragment: string): { line: number; character: number } {
  const offset = source.indexOf(fragment);
  if (offset < 0) throw new Error(`fragment not found in source: ${fragment}`);
  const before = source.slice(0, offset);
  return { line: before.split('\n').length, character: offset - before.lastIndexOf('\n') };
}

/**
 * The M14-1 contract: one OEC9032, at the authored node, whose ONE sentence is
 * the stable head plus the per-position clause. Both halves are asserted — a
 * message that loses the head stops naming the admitted set, and one that
 * loses the clause stops naming the position.
 */
function expectLocatedAwaitRefusal(
  source: string,
  fragment: string,
  clause: string,
  options: ServerComponentCompileOptions = {},
): void {
  const diagnostics = diagnosticsOf(source, options);
  expect(diagnostics).toHaveLength(1);
  const [diagnostic] = diagnostics;
  expect(diagnostic!.code).toBe('OEC9032');
  expect({ line: diagnostic!.line, character: diagnostic!.character }).toEqual(
    locationOf(source, fragment),
  );
  expect(diagnostic!.message).toContain(
    'this full-await slice admits await only inside an async server function component',
  );
  expect(diagnostic!.message).toContain(clause);
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
      {
        resolveModule: (specifier) =>
          specifier === './child.tsx'
            ? `export async function Child(props: { n: string }) {
                 return <span>{await mark(props.n)}</span>;
               }`
            : undefined,
      },
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
        {
          resolveModule: (specifier) =>
            specifier === './child.tsx'
              ? `export async function Child() { return <span>{await pending()}</span>; }`
              : undefined,
        },
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

describe('the refusal names the position and the nearest lawful spelling', () => {
  test('an attribute value names the prop and text-child spellings', () => {
    expectLocatedAwaitRefusal(
      `
        export async function Page() {
          return <p title={await pending()}>x</p>;
        }
      `,
      'title={await pending()}',
      'the refused position is an attribute value (including a custom-element host prop); await the value into a nested server-component prop, or await it in a text child',
    );
  });

  test('a condition test names the sync-child branch spelling', () => {
    expectLocatedAwaitRefusal(
      `
        export async function Page() {
          return <div>{await pending() ? <p>a</p> : <p>b</p>}</div>;
        }
      `,
      '{await pending() ? <p>a</p> : <p>b</p>}',
      'the refused position is a condition test; await the value into a nested server-component prop and branch in a sync child component, or await it in a text child first',
    );
  });

  test('a list item or mapper body names the whole-list spelling', () => {
    expectLocatedAwaitRefusal(
      `
        export async function Page(props: { items: string[] }) {
          return <ul>{props.items.map((item) => <li>{await load(item)}</li>)}</ul>;
        }
      `,
      '{props.items.map((item) => <li>{await load(item)}</li>)}',
      'the refused position is a list item or mapper body; await the whole list into a nested server-component prop and map it in a sync child component',
    );
  });

  test('a static branch names the prop and sync-child spellings', () => {
    expectLocatedAwaitRefusal(
      `
        export async function Page(props: { flag: boolean }) {
          return <div>{props.flag ? <p>{await pending()}</p> : <span>x</span>}</div>;
        }
      `,
      '{props.flag ? <p>{await pending()}</p> : <span>x</span>}',
      'the refused position is a static branch; await the value into a nested server-component prop, or move the branch into a sync child component',
    );
  });

  test('a nested server-component prop names the leading-await spelling', () => {
    expectLocatedAwaitRefusal(
      `
        import { Child } from './child.tsx';
        export async function Page() {
          return <article><Child n={await mark("a") + "!"} /></article>;
        }
      `,
      'n={await mark("a") + "!"}',
      'the refused position is inside a nested server-component prop, and a prop admits one leading await as its whole value; await the value in its own prop first',
      {
        resolveModule: (specifier) =>
          specifier === './child.tsx'
            ? 'export async function Child(props: { n: string }) { return <span>{props.n}</span>; }'
            : undefined,
      },
    );
  });

  test('an awaited operand shape names the closed operand grammar', () => {
    expectLocatedAwaitRefusal(
      `
        export async function Page(props: { name: string }) {
          return <p>{await props.name + "!"}</p>;
        }
      `,
      '{await props.name + "!"}',
      'the refused shape is the awaited operand or a larger expression; the await must be the whole child and its operand must be await load(), await load(<literal or props.field>), or await props.field',
    );
  });
});

describe('previously untested refused shapes keep a located OEC9032', () => {
  test('an await in a static branch is located on the branch expression', () => {
    expectLocatedAwaitRefusal(
      `
        export async function Page(props: { flag: boolean }) {
          return <div>{props.flag ? <p>{await pending()}</p> : <span>x</span>}</div>;
        }
      `,
      '{props.flag ? <p>{await pending()}</p> : <span>x</span>}',
      'the refused position is a static branch',
    );
  });

  test('an await on a __ssr host prop is located on the attribute', () => {
    expectLocatedAwaitRefusal(
      `
        export async function Page() {
          return <open-card title={await load()}></open-card>;
        }
      `,
      'title={await load()}',
      'the refused position is an attribute value',
      { compiledTags: ['open-card'] },
    );
  });

  test('an await in a list-item attribute is located on the mapper expression', () => {
    expectLocatedAwaitRefusal(
      `
        export async function Page(props: { items: string[] }) {
          return <ul>{props.items.map((item) => <li key={item} title={await load(item)}>x</li>)}</ul>;
        }
      `,
      '{props.items.map((item) => <li key={item} title={await load(item)}>x</li>)}',
      'the refused position is a list item or mapper body',
    );
  });

  test('an await with a member-expression callee is located on the call', () => {
    expectLocatedAwaitRefusal(
      `
        export async function Page(props: { id: string }) {
          return <p>{await api.get(props.id)}</p>;
        }
      `,
      'api.get(props.id)',
      'the refused shape is the awaited operand or a larger expression',
    );
  });
});

describe('a Promise is not a normal child (M14-2)', () => {
  test('an annotated Promise prop read as text is refused at the read', () => {
    const source = `
      export async function Page(props: { p: Promise<string> }) {
        return <p>{props.p}</p>;
      }
    `;
    const diagnostics = diagnosticsOf(source);
    expect(diagnostics).toHaveLength(1);
    const [diagnostic] = diagnostics;
    expect(diagnostic!.code).toBe('OEC9032');
    expect({ line: diagnostic!.line, character: diagnostic!.character }).toEqual(
      locationOf(source, '{props.p}'),
    );
    expect(diagnostic!.message).toContain('a Promise is not a normal child');
    expect(diagnostic!.message).toContain('props.p is annotated Promise<...>');
    expect(diagnostic!.message).toContain('await it first: {await props.p}');
  });

  test('an annotated Promise prop read as an attribute is refused at the read', () => {
    const source = `
      export async function Page(props: { p: Promise<string> }) {
        return <p title={props.p}>x</p>;
      }
    `;
    const diagnostics = diagnosticsOf(source);
    expect(diagnostics).toHaveLength(1);
    const [diagnostic] = diagnostics;
    expect(diagnostic!.code).toBe('OEC9032');
    expect({ line: diagnostic!.line, character: diagnostic!.character }).toEqual(
      locationOf(source, 'title={props.p}'),
    );
    expect(diagnostic!.message).toContain('a Promise is not a normal attribute value');
    expect(diagnostic!.message).toContain('await it into a nested server-component prop');
    expect(diagnostic!.message).toContain('await props.p');
  });

  test('the sanctioned spelling {await props.p} stays admitted', () => {
    const result = compile(`
      export async function Page(props: { p: Promise<string> }) {
        return <p>{await props.p}</p>;
      }
    `);
    expect(result!.code).toContain('__t(await props.p)');
    expect(result!.code).not.toContain('[object Promise]');
  });

  test('an untyped prop compiles: the __t thenable backstop is the runtime guard', () => {
    const result = compile(`
      export async function Page(props: { p: any }) {
        return <p>{props.p}</p>;
      }
    `);
    expect(result!.code).toContain('__t(props.p)');
  });

  test("the class path keeps today's behavior for the same shape", () => {
    // The class grammar requires a serializable-literal default, so the
    // Promise annotation rides a `null` default (this fixture is compiled,
    // never type-checked). Parity is the point: the SAME annotation and the
    // SAME reads on the shared walk must keep today's text/attribute parts and
    // raise no Promise diagnostic — the guard exists only on the server path.
    const result = compileElementProgram(
      `
        import { OpenElement, element, property } from '@openelement/element';
        @element('oe-full-await-parity')
        export class FullAwaitParity extends OpenElement {
          @property({ type: Object }) p: Promise<string> = null;
          render() { return <p title={this.p}>{this.p}</p>; }
        }
      `,
      FILE,
    );
    expect(result.program.parts.some((part) => part.k === 'text' && part.signal === 'p')).toBe(
      true,
    );
    expect(result.program.parts.some((part) => part.k === 'attr' && part.name === 'title')).toBe(
      true,
    );
  });
});
