/**
 * M14 full-await slice of the alpha15 server function lane.
 *
 * Supported: an async function or async arrow whose body is still one JSX
 * return, with `await load()`, `await load(<literal or props.field>)`, or
 * `await props.field` in a text child (D1) or a nested server-component prop
 * (D2 — `<Child value={await load()} />`, where `Child` is another server
 * function component composed by direct call; the definition's two positions
 * are `docs/architecture/m14-full-await-definition.md` §2). An async parent
 * awaits an imported async child. Synchronous components keep their previous
 * emission. Everything else in this file is a located OEC9032.
 *
 * D2 note: `Child` must be IMPORTED. A same-module sibling function is not an
 * admitted nested component (`<Child> is not a server function component —
 * import it from the module that exports it`), so a D2 fixture defines the
 * child in a separate module and resolves it through `resolveModule` — the
 * same shape R7's composition row uses.
 *
 * The matrix's `T+`/`T−` (type-level) cells have NO fixture in this suite: it
 * is a compile/emit suite only, with no TypeScript-program or type-check row.
 * `packages/compiler/__tests__/semantic-ir/m03-frontend-matrix.test.ts` covers
 * the TSX-* T cells it names, and it has no TSX-17 row either, so the
 * "type-checks with the authored types" / "a type error is reported for the
 * stated misuse" cells for the server async boundary are unclaimed here.
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
 * text/attribute sink is refused at the read, `{await props.p}` stays admitted.
 * The `__t` runtime backstop for untyped props is pinned in the element suite
 * (`server-html.test.ts`). The former class-vs-server parity row for the
 * Promise shape retired with the class lane: there is no second frontend left
 * to hold parity with, and the surviving rows above still pin this lane's
 * guard.
 */
import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compiledElementPlugin } from '../src/compiler.ts';
import {
  compileServerComponentIfAdmitted,
  compileServerComponentModule,
} from '../src/internal/compiler/semantic-core/server-component.ts';
import {
  CompiledElementError,
  type ElementCompilerDiagnostic,
} from '../src/internal/compiler/semantic-core/compiler-diagnostics.ts';
import type { ServerComponentCompileOptions } from '../src/internal/compiler/semantic-core/server-component.ts';

const FILE = '/proj/app/server/page.tsx';

/** The repository root — the scratch modules below live inside it so the
 * emitted `@openelement/element/server` specifier resolves through the
 * workspace's own package exports (no machine-path rewriting). */
const REPO_ROOT = join(import.meta.dirname!, '..', '..', '..');

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
async function productionRefusal(source: string): Promise<{ returned: unknown; message: string }> {
  const plugin = compiledElementPlugin();
  const transform = plugin.transform;
  if (typeof transform !== 'function') {
    throw new Error('compiledElementPlugin transform is not a function');
  }
  let returned: unknown = undefined;
  let thrown: unknown;
  try {
    returned = await transform.call(
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

async function expectProductionOEC9032(source: string): Promise<void> {
  const pluginResult = await productionRefusal(source);
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

  test('D2: a nested server-component prop awaits its value as the whole prop value', () => {
    // The definition's D2 row (`docs/architecture/m14-full-await-definition.md`
    // §2): `<Child value={await load()} />` — ONE leading await as the WHOLE
    // prop value, `Child` another server function component composed by direct
    // call. This is not the attribute row: `Child` is a server component, so
    // the value crosses as the child's ARGUMENT (D2), never as a host
    // attribute (which is refused by `serverAwaitRefusal('attribute')`).
    const result = compile(
      `
        import { Child } from './child.tsx';
        export async function Page() {
          return <article><Child value={await load()} /></article>;
        }
      `,
      {
        resolveModule: (specifier) =>
          specifier === './child.tsx'
            ? 'export function Child(props: { value: string }) { return <span>{props.value}</span>; }'
            : undefined,
      },
    );
    const body = result!.code;
    // The recorded call shape the definition names: the child is invoked with
    // an object literal whose prop value IS the awaited expression. A sync
    // child is composed by a plain direct call (the parent alone is async).
    expect(body).toContain('Child({ "value": await load() })');
    expect(body).toContain('export async function Page()');
    // The await is the WHOLE prop value: it did not degrade into a text sink,
    // nor into a host tag's attribute.
    expect(body).not.toContain('__t(await load())');
    expect(body).not.toContain('"value": "');
  });

  test('D2: an async child is composed by an awaited direct call carrying the awaited prop', () => {
    // The composition half (R7) meets D2: the parent's direct call is itself
    // awaited, and the child's prop value is the parent's await. Both awaits
    // are generated — the author wrote exactly one, in D2 position.
    const result = compile(
      `
        import { Child } from './child.tsx';
        export async function Page() {
          return <article><Child value={await load()} /></article>;
        }
      `,
      {
        resolveModule: (specifier) =>
          specifier === './child.tsx'
            ? `export async function Child(props: { value: string }) {
                 return <span>{props.value}</span>;
               }`
            : undefined,
      },
    );
    expect(result!.code).toContain('await Child({ "value": await load() })');
  });

  test('D2: the settled output carries the awaited value, composed through the child', async () => {
    // Execution proof for the D2 row (the neighbouring D1 rows assert emitted
    // text; this one closes the loop): the parent's await settles BEFORE the
    // child is invoked, and the child's own body renders the value. The
    // modules are emitted into a scratch directory inside the repository so
    // the emitted `@openelement/element/server` specifier resolves through the
    // workspace's own exports — the real server helpers, not a stub.
    const childSource =
      'export function Child(props: { value: string }) { return <span>{props.value}</span>; }';
    const pageSource = `
      import { Child } from './child.tsx';
      export async function Page() {
        return <article><Child value={await load()} /></article>;
      }
    `;
    const dir = mkdtempSync(join(REPO_ROOT, '.tmp-m14-d2-'));
    try {
      const child = compileServerComponentModule(childSource, join(dir, 'child.tsx'), {});
      writeFileSync(join(dir, 'child.ts'), child!.code);
      const page = compileServerComponentModule(pageSource, join(dir, 'page.tsx'), {
        resolveModule: (specifier) => (specifier === './child.tsx' ? childSource : undefined),
      });
      // The emitted page imports `./child.tsx`; the scratch pair is two plain
      // modules, so point the import at the emitted child file.
      writeFileSync(
        join(dir, 'page.ts'),
        "async function load() { return 'settled-value'; }\n" +
          page!.code.replace("from './child.tsx'", "from './child.ts'"),
      );
      const mod = (await import(pathToFileURL(join(dir, 'page.ts')).href)) as {
        Page: () => Promise<string>;
      };
      const html = await mod.Page();
      expect(html).toContain('settled-value');
      expect(html).not.toContain('[object Promise]');
      expect(html).toBe('<article><span>settled-value</span></article>');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

  test('statements before the return fail closed on the production transform', async () => {
    await expectProductionOEC9032(`
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

  test('a block-bodied async arrow fails closed on the production transform', async () => {
    await expectProductionOEC9032(`
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

  test('an authored await of a reserved generated helper is refused as a reserved callee', () => {
    expectLocatedAwaitRefusal(
      `
        export async function Page() {
          return <p>{await __t("x")}</p>;
        }
      `,
      '__t("x")',
      'the refused shape is a reserved callee; that callee belongs to the generated constructor module — await the authored function instead',
    );
  });

  test('an await of eval is refused as a reserved callee', () => {
    expectLocatedAwaitRefusal(
      `
        export async function Page() {
          return <p>{await eval("x")}</p>;
        }
      `,
      'eval("x")',
      'the refused shape is a reserved callee; that callee belongs to the generated constructor module — await the authored function instead',
    );
  });

  test('an authored await of an imported server component is refused — composition auto-awaits', () => {
    expectLocatedAwaitRefusal(
      `
        import { Child } from './child.tsx';
        export async function Page() {
          return <p>{await Child("a")}</p>;
        }
      `,
      'Child("a")',
      'the refused shape is a reserved callee; that callee belongs to the generated constructor module — await the authored function instead',
      {
        resolveModule: (specifier) =>
          specifier === './child.tsx'
            ? 'export async function Child(props: { n: string }) { return <span>{props.n}</span>; }'
            : undefined,
      },
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

  // The former "class path keeps today's behavior for the same shape" row is
  // deleted rather than retargeted: it compiled an `@element` class and read
  // that class's Part Program parts, i.e. it asserted the RETIRED grammar, not
  // the server lane. Keeping the same assertions on another entry would be a
  // new test, and there is no surviving class path to hold parity with.
});
