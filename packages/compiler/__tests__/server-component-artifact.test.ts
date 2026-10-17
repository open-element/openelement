/**
 * Server function component artifact assertions.
 *
 * The payload contract for the server-only TSX lane (owner ruling): the
 * compiled artifact is a pure TS/JS constructor function — NOT a Part Program,
 * NOT an element class, NOT a client module. Three artifact-level assertions
 * pin the zeros, plus the emission shapes the payload design names:
 *
 *   - zero Part Program: the generated module constructs no Part Program
 *     (no `__partProgram`, no program JSON, no Part/Block vocabulary);
 *   - zero registration: it never touches the SSR registry or the island
 *     config surface (no `customElements.define`, no `defineIslandConfig`);
 *   - zero client: its import set carries no client-graph entry (the element
 *     root barrel, client-only) — the module imports the server helpers only.
 *
 * Emission shapes: static attributes are compile-time literals; dynamic text
 * rides `__t`; nested @element compiled hosts ride `__ssr` (with the
 * host-admitted tag set); nested server function components compose by direct
 * function calls resolved from the authored imports at compile time; islands
 * and foreign custom hosts emit their tag as-is.
 */

import { describe, expect, test } from 'vitest';
import { compileServerComponentModule } from '../src/internal/compiler/semantic-core/server-component.ts';
import { analyzeModuleSemantics } from '../src/internal/compiler/semantic-core/module-analysis.ts';

const FILE = '/proj/app/server/card.tsx';

function compile(source: string, options = {}): ReturnType<typeof compileServerComponentModule> {
  return compileServerComponentModule(source, FILE, options);
}

/** The module the payload design's own example compiles to. */
const CARD = `
export function Card(props: { name: string }) {
  return <article class="card"><h2>{props.name}</h2></article>;
}
`;

describe('artifact: the generative constructor shape', () => {
  test('a component compiles to a pure function whose body is __h/__t code', () => {
    const result = compile(CARD);
    expect(result).not.toBeNull();
    expect(result!.components).toEqual(['Card']);
    expect(result!.code).toContain('export function Card(props: { name: string })');
    expect(result!.code).toContain('__h("article", { "class": "card" }');
    expect(result!.code).toContain('__h("h2", { }');
    expect(result!.code).toContain('__t(props.name)');
    // The JSX is gone from the artifact: the constructor is generated code.
    expect(result!.code).not.toContain('<article');
  });

  test('static attribute values are compile-time literalized', () => {
    const result = compile(`
      export function Card(props: { id: string }) {
        return <a href="/docs/intro" data-index={7} hidden id={props.id}>x</a>;
      }
    `);
    expect(result!.code).toContain('"href": "/docs/intro"');
    // Attribute values are attribute-shaped: a numeric literal serializes as
    // its attribute text, a bare attribute as the empty value.
    expect(result!.code).toContain('"data-index": "7"');
    expect(result!.code).toContain('"hidden": ""');
    expect(result!.code).toContain('"id": props.id');
  });

  test('each Block items map to __h through the item parameter', () => {
    const result = compile(`
      export function List(props: { rows: Array<{ id: string; label: string }> }) {
        return <ul>{props.rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>;
      }
    `);
    expect(result!.code).toContain('props.rows.map((item) =>');
    expect(result!.code).toContain('__t(item.label)');
  });

  test('per-item attribute slots ([name, itemField]) reach the constructor', () => {
    // The class lane's serializers resolve `iattrs` from the current item
    // (`itemAttributeEmission`); a server function page carries the same
    // slots through the constructor, or a list row silently loses every
    // attribute the item supplies (the 404 hub's link hrefs regressed this
    // way before the emitter read `node.iattrs`).
    const result = compile(`
      export function List(props: { rows: Array<{ href: string; label: string }> }) {
        return (
          <nav>
            {props.rows.map((row) => (
              <a key={row.href} href={row.href}>{row.label}</a>
            ))}
          </nav>
        );
      }
    `);
    expect(result!.code).toContain('"href": item.href');
    expect(result!.code).toContain('__t(item.label)');
  });

  test('when Blocks compile to conditional constructor expressions', () => {
    const result = compile(`
      export function Badge(props: { loading: boolean }) {
        return <div>{props.loading ? <span>saving</span> : <span>idle</span>}</div>;
      }
    `);
    expect(result!.code).toContain('props.loading');
    expect(result!.code).toContain('__h("span", { }, [__t("saving")])');
    expect(result!.code).toContain('__h("span", { }, [__t("idle")])');
  });

  test('inline conditional classes keep the authored condition text', () => {
    const result = compile(`
      export function Badge(props: { active: boolean }) {
        return <div class={props.active ? 'on' : 'off'}>x</div>;
      }
    `);
    expect(result!.code).toContain("(props.active ? 'on' : 'off')");
  });

  test('nested server function components compose by direct function call', () => {
    const result = compile(
      `
      import { Shell } from './shell.tsx';

      export function Page(props: { title: string }) {
        return <Shell title={props.title}><p>body</p></Shell>;
      }
    `,
      {
        resolveModule: (specifier) =>
          specifier === './shell.tsx'
            ? `export function Shell(props: { title: string; children?: string }) {
                 return <div class="shell"><h1>{props.title}</h1>{props.children}</div>;
               }`
            : undefined,
      },
    );
    expect(result!.code).toContain("import { Shell } from './shell.tsx';");
    expect(result!.code).toContain('Shell({');
    expect(result!.code).toContain('"title": props.title');
    expect(result!.code).toContain('__h("p", { }, [__t("body")])');
    // Children compose through the children prop as final HTML.
    expect(result!.code).toContain('"children": [');
  });

  test('an unresolvable nested component import is a coded rejection', () => {
    let thrown: unknown;
    try {
      compile(
        `
        import { Missing } from './missing.tsx';
        export function Page(props: { title: string }) {
          return <Missing title={props.title} />;
        }
      `,
        { resolveModule: () => undefined },
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
  });

  test('a nested @element compiled host rides __ssr when the build admits the tag', () => {
    const result = compile(
      `
      export function Page(props: { name: string }) {
        return <oe-panel name={props.name}></oe-panel>;
      }
    `,
      { compiledTags: ['oe-panel'] },
    );
    expect(result!.code).toContain('__ssr("oe-panel", {');
    expect(result!.code).toContain('"name": props.name');
  });

  test('an admitted __ssr host keeps its children as the authored-order composition record', () => {
    // The compiled children channel: a child-bearing admitted host emits
    // [slotName, html] pairs — the static `slot` attribute when present, ''
    // for the default slot — so the runtime delivers the form the host's own
    // root mode takes (light: slot projections; shadow: light DOM after the
    // DSD template), never dropping the children.
    const result = compile(
      `
      export function Page(props: { name: string }) {
        return (
          <oe-panel name={props.name}>
            <h2 slot="title">Title</h2>
            <p>body</p>
          </oe-panel>
        );
      }
    `,
      { compiledTags: ['oe-panel'] },
    );
    expect(result!.code).toContain('__ssr("oe-panel", { "name": props.name }, undefined, {');
    expect(result!.code).toContain('["title", __h("h2", { "slot": "title" }');
    expect(result!.code).toContain('[\'\', __h("p"');
  });

  test('a childless admitted __ssr host keeps the two-argument call (byte-identical)', () => {
    const result = compile(
      `
      export function Page(props: { name: string }) {
        return <oe-panel name={props.name}></oe-panel>;
      }
    `,
      { compiledTags: ['oe-panel'] },
    );
    expect(result!.code).not.toContain('groups');
    expect(result!.code).toContain('__ssr("oe-panel", { "name": props.name })');
  });

  test('an island (unadmitted custom host) emits its tag as-is through __h', () => {
    const result = compile(`
      export function Page(props: { query: string }) {
        return <open-search query={props.query}></open-search>;
      }
    `);
    expect(result!.code).toContain('__h("open-search"');
    expect(result!.code).toContain('"query": props.query');
    expect(result!.code).not.toContain('__ssr');
  });
});

describe('artifact: the three zeros', () => {
  test('zero Part Program: the generated module constructs no Part Program', () => {
    const result = compile(`
      export function Card(props: { name: string }) {
        return <article class="card">{props.name}</article>;
      }
    `);
    const code = result!.code;
    expect(code).not.toContain('__partProgram');
    expect(code).not.toContain('PART_PROGRAM_VERSION');
    expect(code).not.toContain('parts');
    expect(code).not.toContain('observedAttributes');
  });

  test('zero registration: the generated module never touches a registry', () => {
    const result = compile(`
      export function Card(props: { name: string }) {
        return <article>{props.name}</article>;
      }
    `);
    const code = result!.code;
    expect(code).not.toContain('customElements');
    expect(code).not.toContain('.define(');
    expect(code).not.toContain('defineIslandConfig');
    expect(code).not.toContain('@element');
  });

  test('zero client: the generated import set carries no client-graph entry', () => {
    const result = compile(`
      import type { TrustedHtml } from '@openelement/element';
      export function Card(props: { body: TrustedHtml }) {
        return <div trustedHtml innerHTML={props.body}></div>;
      }
    `);
    const code = result!.code;
    expect(code).toContain("from '@openelement/element/server'");
    // The client barrel installs the hydration machinery; the server
    // constructor surface must never pull it. (Type-only authored imports are
    // copied verbatim and erase at runtime — drop them before the check.)
    const runtimeImports = code
      .split('\n')
      .filter((line) => line.startsWith('import ') && !line.startsWith('import type '));
    expect(runtimeImports.filter((line) => !line.includes('@openelement/element/server'))).toEqual(
      [],
    );
    expect(code).toContain("import type { TrustedHtml } from '@openelement/element';");
  });
});

describe('discovery: analyzeModuleSemantics recognizes server function components', () => {
  test('an exported function returning JSX is a server function component fact', () => {
    const facts = analyzeModuleSemantics(CARD, FILE);
    expect(facts.serverFunctionComponents).toEqual(['Card']);
  });

  test('an exported const arrow returning JSX counts; classes and helpers do not', () => {
    const facts = analyzeModuleSemantics(
      `
      export const Icon = (props: { name: string }) => <i>{props.name}</i>;
      export function helper(props: { name: string }) { return props.name; }
      export default function Page() {
        return <div>page</div>;
      }
      function local() { return <div>local</div>; }
    `,
      FILE,
    );
    expect(facts.serverFunctionComponents).toEqual(['Icon']);
  });

  test('a module without JSX-returning exports carries no component facts', () => {
    const facts = analyzeModuleSemantics(
      `export function helper(props: { name: string }) { return props.name; }`,
      FILE,
    );
    expect(facts.serverFunctionComponents).toEqual([]);
  });

  test('the compiled entry admits exactly the discovered functions', () => {
    const result = compile(`
      export const Icon = (props: { name: string }) => <i>{props.name}</i>;
      export function Card(props: { name: string }) {
        return <article>{props.name}</article>;
      }
      export function helper(props: { name: string }) { return props.name; }
    `);
    expect(result!.components).toEqual(['Card', 'Icon']);
  });
});

describe('admission: the shared walk is the one semantic authority', () => {
  test('multi-statement bodies are outside the server grammar (single return)', () => {
    let thrown: unknown;
    try {
      compile(`
        export function Card(props: { name: string }) {
          const loud = props.name.toUpperCase();
          return <p>{loud}</p>;
        }
      `);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
  });

  test('raw-text tags are rejected by the same shared sink rule', () => {
    let thrown: unknown;
    try {
      compile(`
        export function Card(props: { name: string }) {
          return <div><script>{props.name}</script></div>;
        }
      `);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
  });

  test('the reserved helper names cannot be shadowed by module bindings', () => {
    let thrown: unknown;
    try {
      compile(`
        const __h = (x: string) => x;
        export function Card(props: { name: string }) {
          return <article>{props.name}</article>;
        }
      `);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
  });
});
