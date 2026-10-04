import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
import { assertRejectsIncludes, assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { createDeferredDsdExecutor } from '@openelement/element';
import { compileElementProgram } from '@openelement/element/compiler';
import { buildEntryDescriptor } from '../src/vite/internal/ssg/entry-descriptor.ts';
import { renderEntry } from '../src/vite/internal/ssg/entry-orchestrator.ts';
import { assertCompiledStreamRoute as __assertStreamRoute } from '../src/vite/internal/server-runtime/route-dispatch.ts';
import { scanRoutes } from '../src/vite/internal/ssg/route-scanner.ts';

const page = `
import { element, OpenElement, property } from '@openelement/element';
@element('stream-page', { root: 'light' })
export default class StreamPage extends OpenElement {
  @property({ type: String, attribute: false, reflect: false }) first = '';
  @property({ type: String, attribute: false, reflect: false }) second = '';
  render() { return <main><h1>{this.first}</h1><p>{this.second}</p></main>; }
}`;

const route = `
import { definePage } from '@openelement/router';
import Page from '../components/page.tsx';
export const loader = () => ({ first: Promise.resolve('a'), second: Promise.resolve('b') });
export default definePage(Page, {
  renderIntent: { mode: 'dynamic', stream: { defer: ['first', 'second'] } },
});`;

async function fixture(
  check: (routesDir: string) => Promise<void>,
  pageSource = page,
  routeSource = route,
  file = 'index.tsx',
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'oe-stream-manifest-'));
  try {
    const routesDir = join(root, 'routes');
    await mkdir(routesDir);
    await mkdir(join(root, 'components'));
    await writeFile(join(root, 'components/page.tsx'), pageSource);
    await writeFile(join(routesDir, file), routeSource);
    await check(routesDir);
  } finally {
    await rm(root, { recursive: true });
  }
}

test('stream manifest binds two loader fields to independent compiled Part owners and program identity', async () => {
  await fixture(async (dir) => {
    const routes = await scanRoutes(dir, '', { root: dirname(dir) });
    const manifest = routes[0].streamManifest!;
    expect(manifest.program.version).toEqual(1);
    expect(manifest.program.tag).toEqual('stream-page');
    expect(manifest.program.sha256.length).toEqual(64);
    expect(manifest.fields.map((entry) => entry.field)).toEqual(['first', 'second']);
    expect(manifest.fields.map((entry) => entry.signal)).toEqual(['first', 'second']);
    expect(manifest.fields.map((entry) => entry.owners.map((owner) => owner.index))).toEqual([
      [0],
      [1],
    ]);
    expect(manifest.fields.map((entry) => entry.owners[0].location)).toEqual(['p0', 'p1']);
    expect(manifest.fields.map((entry) => entry.owners[0].kind)).toEqual(['part', 'part']);
    expect(
      manifest.fields.every(
        (entry) =>
          entry.owners[0].source.file.endsWith('components/page.tsx') &&
          entry.owners[0].source.start.line > 0,
      ),
    ).toEqual(true);
    expect((await scanRoutes(dir, '', { root: dirname(dir) }))[0].streamManifest).toEqual(manifest);
    const emittedTs = compileElementProgram(page, 'components/page.tsx').code.replaceAll(
      "'@openelement/element'",
      JSON.stringify(new URL('../../element/src/index.ts', import.meta.url).href),
    );
    const emitted = ts.transpileModule(emittedTs, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const compiledModule = (await import(
      `data:text/javascript;charset=utf-8,${encodeURIComponent(emitted)}`
    )) as {
      default: {
        __partProgram: ReturnType<typeof compileElementProgram>['program'];
        __compiledProperties: unknown;
      };
    };
    const runtimeClass = compiledModule.default;
    const runtimeProgram = runtimeClass.__partProgram;
    const { sourceMap: _sourceMap, ...wireProgram } = runtimeProgram;
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(wireProgram)),
    );
    expect(manifest.program.sha256).toEqual(
      [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
    );
    const changedProgram = structuredClone(runtimeProgram);
    expect(changedProgram.version).toEqual(manifest.program.version);
    expect(changedProgram.tag).toEqual(manifest.program.tag);
    const changedRoot = changedProgram.template[0];
    if (changedRoot.k !== 'el') throw new Error('expected a root element');
    changedRoot.tag = 'section';
    class ChangedPage {}
    Object.assign(ChangedPage, {
      __partProgram: changedProgram,
      __compiledProperties: runtimeClass.__compiledProperties,
    });
    await assertRejectsIncludes(
      () =>
        createDeferredDsdExecutor({
          componentClass: ChangedPage as unknown as CustomElementConstructor,
          manifest,
          instanceId: 'changed-runtime-program',
        }),
      Error,
      'does not match compiled program',
    );
    expect(manifest.fields[0].owners[0].source.file).toEqual('components/page.tsx');
    const desc = buildEntryDescriptor(routes, { ssg: true });
    expect(desc.pageRoutes[0].streamManifest).toEqual(manifest);
    const code = renderEntry(desc);
    expect(code).toContain('streamManifest:');
    expect(code).toContain('export const __streamManifests =');
    expect(code).toContain(manifest.program.sha256);
    // ADR-0160 Amendment 1: the deferred-shell gate is the typed runtime
    // module — the entry imports the factory, binds it to the serialized
    // manifests + createDeferredDsdExecutor import, and keeps the call site;
    // the gate's fail-closed contract is pinned by the behavior tests in
    // server-runtime-stream-runtime.test.ts instead of emitted text.
    expect(code).toContain(
      "import { createDeferredPageShell as __createDeferredPageShellGate } from '@openelement/router/server-runtime'",
    );
    expect(code).toContain(
      'const __createDeferredPageShell = __createDeferredPageShellGate({ streamManifests: __streamManifests, createDeferredDsdExecutor });',
    );
    expect(code).toContain('await __createDeferredPageShell(');
    expect(code).toContain('"location":"p1"');
    expect(renderEntry(buildEntryDescriptor(routes))).toContain('export const __streamManifests =');
  });
});

test('ordinary routes do not gain stream metadata', async () => {
  await fixture(
    async (dir) => {
      const routes = await scanRoutes(dir);
      expect(routes[0].streamManifest).toEqual(undefined);
      const code = renderEntry(buildEntryDescriptor(routes, { ssg: true }));
      expect(code.includes('streamManifest:')).toEqual(false);
    },
    page,
    route.replace("stream: { defer: ['first', 'second'] }", ''),
  );
});

test('bounded when/each Regions own their deferred field independently', async () => {
  const whenPage = page.replace(
    '<h1>{this.first}</h1>',
    '{this.first ? <h1>on</h1> : <h1>off</h1>}',
  );
  await fixture(async (dir) => {
    const fields = (await scanRoutes(dir))[0].streamManifest!.fields;
    expect(fields.map((field) => field.owners[0].kind)).toEqual(['region', 'part']);
    expect(fields.map((field) => field.owners[0].index)).toEqual([0, 1]);
  }, whenPage);
  const eachPage = page
    .replace(
      "type: String, attribute: false, reflect: false }) first = ''",
      'type: Array, attribute: false, reflect: false }) first = []',
    )
    .replace(
      '<h1>{this.first}</h1>',
      '<ul>{this.first.map(item => <li key={item.id}>{item.title}</li>)}</ul>',
    );
  await fixture(async (dir) => {
    const fields = (await scanRoutes(dir))[0].streamManifest!.fields;
    expect(fields.map((field) => field.owners[0].kind)).toEqual(['region', 'part']);
  }, eachPage);
  await fixture(
    async (dir) => {
      const error = (await assertRejectsIncludes(() => scanRoutes(dir))) as Error;
      expect(error.message).toContain(
        'each p0 has an opaque host, unsafe frame tag/attribute, or item attribute',
      );
    },
    eachPage.replace('key={item.id}', 'key={item.id} title={item.title}'),
  );
  await fixture(
    async (dir) => {
      const error = (await assertRejectsIncludes(() => scanRoutes(dir))) as Error;
      expect(error.message).toContain('unsafe frame tag/attribute');
      expect(error.message).toContain('first');
    },
    whenPage.replace('<h1>on</h1>', '<template><b>on</b></template>'),
  );
  await fixture(
    async (dir) => {
      const error = (await assertRejectsIncludes(() => scanRoutes(dir))) as Error;
      expect(error.message).toContain('unsafe frame tag/attribute');
      expect(error.message).toContain('first');
    },
    eachPage.replace('<li key={item.id}>', '<iframe key={item.id}>').replace('</li>', '</iframe>'),
  );
  await fixture(
    async (dir) => {
      const error = (await assertRejectsIncludes(() => scanRoutes(dir))) as Error;
      expect(error.message).toContain('unsafe frame tag/attribute');
    },
    whenPage.replace('<h1>on</h1>', '<a href="javascript:alert(1)">on</a>'),
  );
  await fixture(
    async (dir) => {
      const error = (await assertRejectsIncludes(() => scanRoutes(dir))) as Error;
      expect(error.message).toContain('unsafe frame tag/attribute');
    },
    whenPage.replace('<h1>on</h1>', '<a href="java\tscript:alert(1)">on</a>'),
  );
  await fixture(
    async (dir) => {
      const error = (await assertRejectsIncludes(() => scanRoutes(dir))) as Error;
      expect(error.message).toContain('unsafe frame tag/attribute');
    },
    whenPage.replace('<h1>on</h1>', '<span data-oe-frame="spoof">on</span>'),
  );
});

test('stream admission rejects unsupported authoring and sinks with route, field and source', async () => {
  const cases: Array<[string, string, string, string, string]> = [
    [
      'attribute sink',
      page.replace('<h1>{this.first}</h1>', '<h1 title={this.first}>{this.first}</h1>'),
      route,
      'first',
      'attr sink',
    ],
    [
      'host property',
      page.replace(
        '<h1>{this.first}</h1>',
        '<x-card value={this.first}></x-card><h1>{this.first}</h1>',
      ),
      route,
      'first',
      'prop sink',
    ],
    [
      'boolean sink',
      page.replace(
        '<h1>{this.first}</h1>',
        '<button hidden={this.first}></button><h1>{this.first}</h1>',
      ),
      route,
      'first',
      'bool sink',
    ],
    [
      'HTML sink',
      page
        .replace('property }', 'property, trustedHtml, type TrustedHtml }')
        .replace(
          "type: String, attribute: false, reflect: false }) first = ''",
          "type: Object, attribute: false, reflect: false }) first: TrustedHtml = trustedHtml('')",
        )
        .replace('<h1>{this.first}</h1>', '<div innerHTML={this.first} trustedHtml></div>'),
      route,
      'first',
      'html sink',
    ],
    [
      'slot routing',
      page.replace('<h1>{this.first}</h1>', '<h1 slot="title">{this.first}</h1>'),
      route,
      'first',
      'slot',
    ],
    [
      'computed consumer',
      page
        .replace(
          'render()',
          '@property({ type: String, attribute: false, reflect: false }) total = computed(() => this.first);\n  render()',
        )
        .replace('property }', 'property, computed }')
        .replace('{this.first}</h1>', '{this.total}</h1>'),
      route,
      'first',
      'computed total',
    ],
    [
      'computed chain',
      page
        .replace(
          'render()',
          '@property({ type: String, attribute: false, reflect: false }) total = computed(() => this.first);\n  @property({ type: String, attribute: false, reflect: false }) doubled = computed(() => this.total);\n  render()',
        )
        .replace('property }', 'property, computed }')
        .replace('{this.first}</h1>', '{this.doubled}</h1>'),
      route,
      '',
      'computed field may not read computed field',
    ],
    [
      'reflecting property',
      page.replace(
        'attribute: false, reflect: false }) first',
        'attribute: "first", reflect: true }) first',
      ),
      route,
      'first',
      'property must be writable',
    ],
    [
      'attribute property',
      page.replace(
        'attribute: false, reflect: false }) first',
        'attribute: "first", reflect: false }) first',
      ),
      route,
      'first',
      'property must be writable',
    ],
    [
      'missing page field',
      page,
      route
        .replace("'first', 'second'", "'absent', 'second'")
        .replace("first: Promise.resolve('a')", "absent: Promise.resolve('a')"),
      'absent',
      'no declared compiled page property',
    ],
    [
      'injected locale',
      page.replaceAll('first', 'locale'),
      route.replaceAll('first', 'locale'),
      'locale',
      'collides with an injected locale property',
    ],
    [
      'missing loader field',
      page,
      route.replace("second: Promise.resolve('b')", "other: Promise.resolve('b')"),
      'second',
      'missing from literal loader object',
    ],
    [
      'loader spread',
      page,
      route.replace("first: Promise.resolve('a')", '...getFields()'),
      'first',
      'loader object spread',
    ],
    [
      'computed loader key',
      page,
      route.replace("first: Promise.resolve('a')", "[fieldName]: Promise.resolve('a')"),
      'first',
      'computed loader key',
    ],
    [
      'no loader',
      page,
      route.replace(
        "export const loader = () => ({ first: Promise.resolve('a'), second: Promise.resolve('b') });",
        '',
      ),
      'defer',
      'requires a route loader',
    ],
    [
      'custom props',
      page,
      route.replace(
        '  renderIntent:',
        '  props: ({ data }) => ({ first: data.first }),\n  renderIntent:',
      ),
      'defer',
      'custom props',
    ],
    [
      'head resolver',
      page,
      route.replace(
        '  renderIntent:',
        '  head: ({ data }) => ({ title: data.first }),\n  renderIntent:',
      ),
      'defer',
      'head',
    ],
    [
      'head method resolver',
      page,
      route.replace(
        '  renderIntent:',
        '  head({ data }) { return { title: data.first }; },\n  renderIntent:',
      ),
      'defer',
      'head',
    ],
    [
      'nonliteral list',
      page,
      route.replace("['first', 'second']", "['first', fieldName]"),
      'defer',
      'literal safe property names',
    ],
    [
      'duplicate list',
      page,
      route.replace("['first', 'second']", "['first', 'first']"),
      'defer',
      'duplicate',
    ],
    [
      'unsafe name',
      page,
      route.replace("['first', 'second']", "['__proto__', 'second']"),
      'defer',
      'literal safe property names',
    ],
    [
      'static mode',
      page,
      route.replace("mode: 'dynamic'", "mode: 'static'"),
      'defer',
      "mode: 'dynamic'",
    ],
    [
      'render intent spread',
      page,
      route.replace("mode: 'dynamic', stream:", "mode: 'dynamic', ...otherIntent, stream:"),
      'defer',
      'renderIntent must contain only',
    ],
    [
      'closed shadow',
      page.replace("root: 'light'", "root: 'shadow-closed'"),
      route,
      'defer',
      'closed shadow',
    ],
  ];
  for (const [name, pageSource, routeSource, field, reason] of cases) {
    await fixture(
      async (dir) => {
        const error = (await assertRejectsIncludes(() => scanRoutes(dir))) as Error;
        expect(error.message, name).toContain(reason);
        if (field) expect(error.message, name).toContain(`field ${field}`);
      },
      pageSource,
      routeSource,
    );
  }
});

test('a static head object and an aliased definePage import keep the default projection', async () => {
  const source = route
    .replace('import { definePage }', 'import { definePage as pageDefinition }')
    .replace('definePage(Page, {', "pageDefinition(Page, {\n  head: { title: 'Known' },");
  await fixture(
    async (dir) => {
      expect((await scanRoutes(dir))[0].streamManifest?.fields.length).toEqual(2);
    },
    page,
    source,
  );
});

test('stream admission requires the loader named export used by the generated entry', async () => {
  for (const unexported of [
    route.replace('export const loader', 'const loader'),
    route.replace(
      "export const loader = () => ({ first: Promise.resolve('a'), second: Promise.resolve('b') });",
      "function loader() { return { first: Promise.resolve('a'), second: Promise.resolve('b') }; }",
    ),
    route.replace(
      "export const loader = () => ({ first: Promise.resolve('a'), second: Promise.resolve('b') });",
      "export default function loader() { return { first: Promise.resolve('a'), second: Promise.resolve('b') }; }",
    ),
    route.replace('export const loader', 'const loader') + '\nexport type { loader };',
    route.replace('export const loader', 'const loader') + '\nexport { type loader };',
  ]) {
    await fixture(
      async (dir) => {
        const error = (await assertRejectsIncludes(() => scanRoutes(dir))) as Error;
        expect(error.message).toContain('stream route /, field defer');
        expect(error.message).toContain('loader must be a named export');
      },
      page,
      unexported,
    );
  }
  await fixture(
    async (dir) => {
      expect((await scanRoutes(dir))[0].streamManifest?.fields.length).toEqual(2);
    },
    page,
    route.replace('export const loader', 'const loader') + '\nexport { loader };',
  );
});

test('an export alias may publish the loader the generated entry reads', async () => {
  // The generated entry reads `module.loader`, so the EXPORT name is the
  // contract: `export { statsLoader as loader }` publishes the same
  // `module.loader` as `export const loader = …`.
  const routePreamble = `
import { definePage } from '@openelement/router';
import Page from '../components/page.tsx';
`;
  const descriptor = `
export default definePage(Page, {
  renderIntent: { mode: 'dynamic', stream: { defer: ['first', 'second'] } },
});`;
  const body = "{ first: Promise.resolve('a'), second: Promise.resolve('b') }";
  // Parenthesised so the arrow body is the object literal, not a block: the
  // literal-loader-field check only reads a returned/expression object.
  const aliasedVariable = `${routePreamble}const statsLoader = () => (${body});
export { statsLoader as loader };
${descriptor}`;
  const aliasedFunction = `${routePreamble}function statsLoader() { return ${body}; }
export { statsLoader as loader };
${descriptor}`;
  await fixture(
    async (dir) => {
      const routes = await scanRoutes(dir);
      const manifest = routes[0].streamManifest!;
      expect(manifest.fields.map((entry) => entry.field)).toEqual(['first', 'second']);
      expect(manifest.fields.map((entry) => entry.owners.map((owner) => owner.index))).toEqual([
        [0],
        [1],
      ]);
      expect(manifest.fields.map((entry) => entry.owners[0].kind)).toEqual(['part', 'part']);
      expect(manifest.program.tag).toEqual('stream-page');
      expect(manifest.program.sha256.length).toEqual(64);
      const desc = buildEntryDescriptor(routes, { ssg: true });
      expect(desc.pageRoutes[0].streamManifest).toEqual(manifest);
      expect(renderEntry(desc)).toContain('export const __streamManifests =');
    },
    page,
    aliasedVariable,
  );
  // A function declaration under a different local name is the same contract.
  await fixture(
    async (dir) => {
      const manifest = (await scanRoutes(dir))[0].streamManifest!;
      expect(manifest.fields.map((entry) => entry.field)).toEqual(['first', 'second']);
      expect(manifest.fields.map((entry) => entry.owners.map((owner) => owner.index))).toEqual([
        [0],
        [1],
      ]);
    },
    page,
    aliasedFunction,
  );
  // The alias does not skip the literal-loader-field check: a deferred field
  // the aliased loader never produces still fails the build.
  await fixture(
    async (dir) => {
      const error = (await assertRejectsIncludes(() => scanRoutes(dir))) as Error;
      expect(error.message).toContain('field second');
      expect(error.message).toContain('missing from literal loader object');
    },
    page,
    aliasedVariable.replace("second: Promise.resolve('b')", "other: Promise.resolve('b')"),
  );
  // The alias is admitted only when it names a local binding.
  await fixture(
    async (dir) => {
      const error = (await assertRejectsIncludes(() => scanRoutes(dir))) as Error;
      expect(error.message).toContain('stream route /, field defer');
      expect(error.message).toContain('requires a route loader');
    },
    page,
    `${routePreamble}export { statsLoader as loader };
${descriptor}`,
  );
  // Exporting the local name under a DIFFERENT name leaves module.loader
  // undefined, so admission stays closed.
  await fixture(
    async (dir) => {
      const error = (await assertRejectsIncludes(() => scanRoutes(dir))) as Error;
      expect(error.message).toContain('loader must be a named export');
    },
    page,
    `${routePreamble}const loader = () => (${body});
export { loader as load };
${descriptor}`,
  );
  // The alias inherits the alias-free guard rails: a spread object is still
  // rejected against the aliased loader body, not silently skipped.
  await fixture(
    async (dir) => {
      const error = (await assertRejectsIncludes(() => scanRoutes(dir))) as Error;
      expect(error.message).toContain('loader object spread');
    },
    page,
    aliasedVariable.replace(
      "{ first: Promise.resolve('a'), second: Promise.resolve('b') }",
      "{ ...getFields(), first: Promise.resolve('a'), second: Promise.resolve('b') }",
    ),
  );
});

test('a duplicate `as loader` export is rejected by the scan itself', async () => {
  // `export { a as loader, b as loader }` is a module SyntaxError at load
  // time; the scan still names the problem so the build fails with the
  // framework's own diagnostic instead of the parser's.
  const routePreamble = `
import { definePage } from '@openelement/router';
import Page from '../components/page.tsx';
`;
  const descriptor = `
export default definePage(Page, {
  renderIntent: { mode: 'dynamic', stream: { defer: ['first', 'second'] } },
});`;
  const body = "{ first: Promise.resolve('a'), second: Promise.resolve('b') }";
  const duplicateAliases = `${routePreamble}const a = () => (${body});
const b = () => (${body});
export { a as loader, b as loader };
${descriptor}`;
  await fixture(
    async (dir) => {
      const error = (await assertRejectsIncludes(() => scanRoutes(dir))) as Error;
      expect(error.message).toContain('exports `loader` more than once');
      expect(error.message).toContain('at most once');
    },
    page,
    duplicateAliases,
  );
});

test('stream page program must belong to the one class selected by its import', async () => {
  const secondClass = `
@element('other-page')
export class OtherPage extends OpenElement {
  @property({ type: String, attribute: false, reflect: false }) first = '';
  render() { return <main>{this.first}</main>; }
}
`;
  await fixture(
    async (dir) => {
      const error = (await assertRejectsIncludes(() => scanRoutes(dir))) as Error;
      expect(error.message).toContain('stream route /, field first');
      expect(error.message).toContain('declares 2 classes');
    },
    page.replace("@element('stream-page'", secondClass + "\n@element('stream-page'"),
  );
  await fixture(
    async (dir) => {
      const error = (await assertRejectsIncludes(() => scanRoutes(dir))) as Error;
      expect(error.message).toContain('imported page class does not own');
    },
    page.replace('export default class StreamPage', 'export class StreamPage'),
  );
  await fixture(
    async (dir) => {
      expect((await scanRoutes(dir))[0].streamManifest?.program.tag).toEqual('stream-page');
    },
    page.replace('export default class StreamPage', 'export class StreamPage'),
    route.replace(
      "import Page from '../components/page.tsx';",
      "import { StreamPage as Page } from '../components/page.tsx';",
    ),
  );
});

test('generated entry rejects opaque stream descriptors before serving GET', async () => {
  const indirectRoutes = [
    route.replace(
      "export default definePage(Page, {\n  renderIntent: { mode: 'dynamic', stream: { defer: ['first', 'second'] } },\n});",
      "const descriptor = { renderIntent: { mode: 'dynamic', stream: { defer: ['first', 'second'] } } };\nexport default definePage(Page, descriptor);",
    ),
    route
      .replace(
        "renderIntent: { mode: 'dynamic', stream: { defer: ['first', 'second'] } },",
        'renderIntent: intent,',
      )
      .replace(
        'export default definePage(Page, {',
        "const intent = { mode: 'dynamic', stream: { defer: ['first', 'second'] } };\nexport default definePage(Page, {",
      ),
  ];
  for (const source of indirectRoutes) {
    await fixture(
      async (dir) => {
        const routes = await scanRoutes(dir);
        expect(routes[0].streamManifest).toEqual(undefined);
        const code = renderEntry(buildEntryDescriptor(routes));
        expect(code).toContain('__assertStreamRoute($Route_Index, "/", "index.tsx", undefined)');
        // #1470 block e (ADR-0160 rule a): the guard is the shipped typed
        // module — the entry binds it via import, and this harness executes
        // the module directly (the old emitted-helper extraction cannot carry
        // imports). The assertions below are unchanged.
        const mod = {
          __assertStreamRoute,
        };
        const pageModule = {
          default: {
            openElementPage: {
              renderIntent: { mode: 'dynamic', stream: { defer: ['first', 'second'] } },
            },
            __partProgram: { version: 1, tag: 'stream-page' },
          },
        };
        const error = assertThrowsIncludes(
          () => mod.__assertStreamRoute(pageModule, '/', 'index.tsx', undefined),
          Error,
          'no matching compiled route manifest/program',
        );
        expect(error.message).toContain('field first at index.tsx');
      },
      page,
      source,
    );
  }
  await fixture(async (dir) => {
    const routes = await scanRoutes(dir);
    renderEntry(buildEntryDescriptor(routes));
    // #1470 block e: the shipped typed guard, exercised directly (see the
    // note on the harness change in the test above).
    const mod = {
      __assertStreamRoute,
    };
    const pageModule = {
      default: {
        openElementPage: {
          renderIntent: { stream: { defer: ['first', 'second'] } },
        },
        __partProgram: { version: 1, tag: 'stream-page' },
      },
    };
    mod.__assertStreamRoute(pageModule, '/', 'index.tsx', routes[0].streamManifest);
    assertThrowsIncludes(
      () =>
        mod.__assertStreamRoute(
          {
            default: {
              ...pageModule.default,
              openElementPage: { renderIntent: { stream: { defer: ['second', 'first'] } } },
            },
          },
          '/',
          'index.tsx',
          routes[0].streamManifest,
        ),
      Error,
      'no matching compiled route manifest/program',
    );
  });
});

test('streaming requires the project-wide app shell to be off, and the gate says so', async () => {
  const shell = { tagName: 'open-layout', import: '@acme/components/open-layout', props: {} };
  const cases: Array<[string, Parameters<typeof buildEntryDescriptor>[1], string]> = [
    ['default appShell', { ssg: true, appShell: shell }, 'whole project'],
    [
      'named layout with no default shell',
      { ssg: true, appShell: false, layouts: { post: shell } },
      'Streaming routes: / (index.tsx)',
    ],
    ['layouts.default', { ssg: true, layouts: { default: shell, post: false } }, 'whole project'],
  ];
  for (const [name, options, expected] of cases) {
    await fixture(async (dir) => {
      const routes = await scanRoutes(dir);
      expect(routes[0].streamManifest !== undefined, name).toEqual(true);
      const error = assertThrowsIncludes(() => buildEntryDescriptor(routes, options)) as Error;
      // The gate is project-level, so the guidance must name the project-wide
      // action instead of a per-route opt-out the build cannot see.
      expect(error.message, name).toContain(expected);
      expect(error.message, name).toContain('appShell: false');
      expect(error.message, name).toContain('layouts');
      expect(error.message, name).toContain('cannot satisfy this gate');
      expect(error.message, name).toContain('route: { layout: false }');
    });
  }
  // The same configuration without a stream route builds normally: the gate is
  // about streaming, not about shells.
  await fixture(
    async (dir) => {
      const routes = await scanRoutes(dir);
      const desc = buildEntryDescriptor(routes, { ssg: true, appShell: shell });
      expect(desc.pageRoutes[0].streamManifest).toEqual(undefined);
      expect(desc.appShell.default === false).toEqual(false);
    },
    page,
    route.replace("stream: { defer: ['first', 'second'] }", ''),
  );
  // With no shell anywhere, the stream route is admitted (the fixtures'
  // configuration) and the gate stays silent.
  await fixture(async (dir) => {
    const routes = await scanRoutes(dir);
    const desc = buildEntryDescriptor(routes, { ssg: true, appShell: false, layouts: {} });
    expect(desc.pageRoutes[0].streamManifest?.fields.length).toEqual(2);
    expect(desc.appShell.default).toEqual(false);
  });
});

test('stream route params and opaque wrappers fail closed', async () => {
  await fixture(
    async (dir) => {
      const error = (await assertRejectsIncludes(() => scanRoutes(dir))) as Error;
      expect(error.message).toContain('collides with an injected route param property');
    },
    page,
    route,
    '[first].tsx',
  );
  await fixture(async (dir) => {
    const routes = await scanRoutes(dir);
    const error = assertThrowsIncludes(() =>
      buildEntryDescriptor([
        ...routes,
        {
          path: '/_renderer',
          filePath: '_renderer.ts',
          type: 'special',
          varName: 'Renderer',
          special: 'renderer',
        },
      ]),
    ) as Error;
    expect(error.message).toContain('opaque renderer wrapper');
  });
});

/** Generate a stream fixture page/route with `fieldCount` deferred fields, each owning `ownersPerField` text Parts. */
function budgetFixture(
  fieldCount: number,
  ownersPerField: number,
): { pageSource: string; routeSource: string } {
  const names = Array.from({ length: fieldCount }, (_, index) => `f${index}`);
  const props = names
    .map((name) => `  @property({ type: String, attribute: false, reflect: false }) ${name} = '';`)
    .join('\n');
  const sinks = names
    .map((name) => Array.from({ length: ownersPerField }, () => `<p>\${this.${name}}</p>`).join(''))
    .join('');
  const pageSource = `
import { element, OpenElement, property } from '@openelement/element';
@element('stream-page', { root: 'light' })
export default class StreamPage extends OpenElement {
${props}
  render() { return <main>${sinks}</main>; }
}`;
  const routeSource = `
import { definePage } from '@openelement/router';
import Page from '../components/page.tsx';
export const loader = () => ({ ${names
    .map((name) => `${name}: Promise.resolve('x')`)
    .join(', ')} });
export default definePage(Page, {
  renderIntent: { mode: 'dynamic', stream: { defer: [${names
    .map((name) => `'${name}'`)
    .join(', ')}] } },
});`;
  return { pageSource, routeSource };
}

test('stream admission enforces the build-time field/owner budget aligned with the runtime seed contract', async () => {
  // Negative: 33 fields are rejected at build time.
  await fixture(
    async (dir) => {
      const error = (await assertRejectsIncludes(() => scanRoutes(dir))) as Error;
      expect(error.message).toContain('bounded deferred budget');
      expect(error.message).toContain('33 fields (max 32), 33 Part owners');
    },
    budgetFixture(33, 1).pageSource,
    budgetFixture(33, 1).routeSource,
  );
  // Negative: 65 owners on one field are rejected at build time.
  await fixture(
    async (dir) => {
      const error = (await assertRejectsIncludes(() => scanRoutes(dir))) as Error;
      expect(error.message).toContain('bounded deferred budget');
      expect(error.message).toContain('1 fields (max 32), 65 Part owners (max 64)');
    },
    budgetFixture(1, 65).pageSource,
    budgetFixture(1, 65).routeSource,
  );
  // Boundary: exactly 32 fields with 64 total owners still build a manifest.
  await fixture(
    async (dir) => {
      const manifest = (await scanRoutes(dir))[0].streamManifest!;
      expect(manifest.fields.length).toEqual(32);
      expect(manifest.fields.reduce((count, entry) => count + entry.owners.length, 0)).toEqual(64);
    },
    budgetFixture(32, 2).pageSource,
    budgetFixture(32, 2).routeSource,
  );
});
