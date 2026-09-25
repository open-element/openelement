import { assertEquals, assertRejects, assertStringIncludes, assertThrows } from '@std/assert';
import { dirname, join } from 'jsr:@std/path@^1.0.0';
import ts from 'typescript';
import { createDeferredDsdExecutor } from '@openelement/element';
import { compileElementProgram } from '@openelement/element/compiler';
import { buildEntryDescriptor } from '../src/vite/internal/ssg/entry-descriptor.ts';
import { renderEntry } from '../src/vite/internal/ssg/entry-orchestrator.ts';
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
  const root = await Deno.makeTempDir({ prefix: 'oe-stream-manifest-' });
  try {
    const routesDir = join(root, 'routes');
    await Deno.mkdir(routesDir);
    await Deno.mkdir(join(root, 'components'));
    await Deno.writeTextFile(join(root, 'components/page.tsx'), pageSource);
    await Deno.writeTextFile(join(routesDir, file), routeSource);
    await check(routesDir);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test('stream manifest binds two loader fields to independent compiled Part owners and program identity', async () => {
  await fixture(async (dir) => {
    const routes = await scanRoutes(dir, '', { root: dirname(dir) });
    const manifest = routes[0].streamManifest!;
    assertEquals(manifest.program.version, 1);
    assertEquals(manifest.program.tag, 'stream-page');
    assertEquals(manifest.program.sha256.length, 64);
    assertEquals(manifest.fields.map((entry) => entry.field), ['first', 'second']);
    assertEquals(manifest.fields.map((entry) => entry.signal), ['first', 'second']);
    assertEquals(manifest.fields.map((entry) => entry.owners.map((owner) => owner.index)), [[0], [
      1,
    ]]);
    assertEquals(manifest.fields.map((entry) => entry.owners[0].location), ['p0', 'p1']);
    assertEquals(manifest.fields.map((entry) => entry.owners[0].kind), ['part', 'part']);
    assertEquals(
      manifest.fields.every((entry) =>
        entry.owners[0].source.file.endsWith('components/page.tsx') &&
        entry.owners[0].source.start.line > 0
      ),
      true,
    );
    assertEquals((await scanRoutes(dir, '', { root: dirname(dir) }))[0].streamManifest, manifest);
    const emittedTs = compileElementProgram(page, 'components/page.tsx').code.replaceAll(
      "'@openelement/element'",
      JSON.stringify(new URL('../../element/src/index.ts', import.meta.url).href),
    );
    const emitted = ts.transpileModule(emittedTs, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const compiledModule = await import(
      `data:text/javascript;charset=utf-8,${encodeURIComponent(emitted)}`
    ) as {
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
    assertEquals(
      manifest.program.sha256,
      [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
    );
    const changedProgram = structuredClone(runtimeProgram);
    assertEquals(changedProgram.version, manifest.program.version);
    assertEquals(changedProgram.tag, manifest.program.tag);
    const changedRoot = changedProgram.template[0];
    if (changedRoot.k !== 'el') throw new Error('expected a root element');
    changedRoot.tag = 'section';
    class ChangedPage {}
    Object.assign(ChangedPage, {
      __partProgram: changedProgram,
      __compiledProperties: runtimeClass.__compiledProperties,
    });
    await assertRejects(
      () =>
        createDeferredDsdExecutor({
          componentClass: ChangedPage as unknown as CustomElementConstructor,
          manifest,
          instanceId: 'changed-runtime-program',
        }),
      Error,
      'does not match compiled program',
    );
    assertEquals(manifest.fields[0].owners[0].source.file, 'components/page.tsx');
    const desc = buildEntryDescriptor(routes, { ssg: true });
    assertEquals(desc.pageRoutes[0].streamManifest, manifest);
    const code = renderEntry(desc);
    assertStringIncludes(code, 'streamManifest:');
    assertStringIncludes(code, 'export const __streamManifests =');
    assertStringIncludes(code, manifest.program.sha256);
    assertStringIncludes(code, 'async function __createDeferredPageShell(');
    assertStringIncludes(
      code,
      'return createDeferredDsdExecutor({ componentClass: Cls, props, manifest, instanceId, documentToken });',
    );
    assertStringIncludes(code, '"location":"p1"');
    assertStringIncludes(
      renderEntry(buildEntryDescriptor(routes)),
      'export const __streamManifests =',
    );
  });
});

Deno.test('ordinary routes do not gain stream metadata', async () => {
  await fixture(
    async (dir) => {
      const routes = await scanRoutes(dir);
      assertEquals(routes[0].streamManifest, undefined);
      const code = renderEntry(buildEntryDescriptor(routes, { ssg: true }));
      assertEquals(code.includes('streamManifest:'), false);
    },
    page,
    route.replace("stream: { defer: ['first', 'second'] }", ''),
  );
});

Deno.test('bounded when/each Regions own their deferred field independently', async () => {
  const whenPage = page.replace(
    '<h1>{this.first}</h1>',
    '{this.first ? <h1>on</h1> : <h1>off</h1>}',
  );
  await fixture(async (dir) => {
    const fields = (await scanRoutes(dir))[0].streamManifest!.fields;
    assertEquals(fields.map((field) => field.owners[0].kind), ['region', 'part']);
    assertEquals(fields.map((field) => field.owners[0].index), [0, 1]);
  }, whenPage);
  const eachPage = page.replace(
    "type: String, attribute: false, reflect: false }) first = ''",
    'type: Array, attribute: false, reflect: false }) first = []',
  ).replace(
    '<h1>{this.first}</h1>',
    '<ul>{this.first.map(item => <li key={item.id}>{item.title}</li>)}</ul>',
  );
  await fixture(async (dir) => {
    const fields = (await scanRoutes(dir))[0].streamManifest!.fields;
    assertEquals(fields.map((field) => field.owners[0].kind), ['region', 'part']);
  }, eachPage);
  await fixture(async (dir) => {
    const error = await assertRejects(() => scanRoutes(dir)) as Error;
    assertStringIncludes(
      error.message,
      'each p0 has an opaque host, unsafe frame tag/attribute, or item attribute',
    );
  }, eachPage.replace('key={item.id}', 'key={item.id} title={item.title}'));
  await fixture(async (dir) => {
    const error = await assertRejects(() => scanRoutes(dir)) as Error;
    assertStringIncludes(error.message, 'unsafe frame tag/attribute');
    assertStringIncludes(error.message, 'first');
  }, whenPage.replace('<h1>on</h1>', '<template><b>on</b></template>'));
  await fixture(
    async (dir) => {
      const error = await assertRejects(() => scanRoutes(dir)) as Error;
      assertStringIncludes(error.message, 'unsafe frame tag/attribute');
      assertStringIncludes(error.message, 'first');
    },
    eachPage.replace('<li key={item.id}>', '<iframe key={item.id}>').replace(
      '</li>',
      '</iframe>',
    ),
  );
  await fixture(async (dir) => {
    const error = await assertRejects(() => scanRoutes(dir)) as Error;
    assertStringIncludes(error.message, 'unsafe frame tag/attribute');
  }, whenPage.replace('<h1>on</h1>', '<a href="javascript:alert(1)">on</a>'));
  await fixture(async (dir) => {
    const error = await assertRejects(() => scanRoutes(dir)) as Error;
    assertStringIncludes(error.message, 'unsafe frame tag/attribute');
  }, whenPage.replace('<h1>on</h1>', '<a href="java\tscript:alert(1)">on</a>'));
  await fixture(async (dir) => {
    const error = await assertRejects(() => scanRoutes(dir)) as Error;
    assertStringIncludes(error.message, 'unsafe frame tag/attribute');
  }, whenPage.replace('<h1>on</h1>', '<span data-oe-frame="spoof">on</span>'));
});

Deno.test('stream admission rejects unsupported authoring and sinks with route, field and source', async () => {
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
      page.replace(
        'property }',
        'property, trustedHtml, type TrustedHtml }',
      ).replace(
        "type: String, attribute: false, reflect: false }) first = ''",
        "type: Object, attribute: false, reflect: false }) first: TrustedHtml = trustedHtml('')",
      ).replace('<h1>{this.first}</h1>', '<div innerHTML={this.first} trustedHtml></div>'),
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
      page.replace(
        'render()',
        '@property({ type: String, attribute: false, reflect: false }) total = computed(() => this.first);\n  render()',
      ).replace('property }', 'property, computed }').replace(
        '{this.first}</h1>',
        '{this.total}</h1>',
      ),
      route,
      'first',
      'computed total',
    ],
    [
      'computed chain',
      page.replace(
        'render()',
        '@property({ type: String, attribute: false, reflect: false }) total = computed(() => this.first);\n  @property({ type: String, attribute: false, reflect: false }) doubled = computed(() => this.total);\n  render()',
      ).replace('property }', 'property, computed }').replace(
        '{this.first}</h1>',
        '{this.doubled}</h1>',
      ),
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
      route.replace("'first', 'second'", "'absent', 'second'").replace(
        "first: Promise.resolve('a')",
        "absent: Promise.resolve('a')",
      ),
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
        const error = await assertRejects(() => scanRoutes(dir)) as Error;
        assertStringIncludes(error.message, reason, name);
        if (field) assertStringIncludes(error.message, `field ${field}`, name);
      },
      pageSource,
      routeSource,
    );
  }
});

Deno.test('a static head object and an aliased definePage import keep the default projection', async () => {
  const source = route.replace(
    'import { definePage }',
    'import { definePage as pageDefinition }',
  ).replace('definePage(Page, {', "pageDefinition(Page, {\n  head: { title: 'Known' },");
  await fixture(
    async (dir) => {
      assertEquals((await scanRoutes(dir))[0].streamManifest?.fields.length, 2);
    },
    page,
    source,
  );
});

Deno.test('stream admission requires the loader named export used by the generated entry', async () => {
  for (
    const unexported of [
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
    ]
  ) {
    await fixture(
      async (dir) => {
        const error = await assertRejects(() => scanRoutes(dir)) as Error;
        assertStringIncludes(error.message, 'stream route /, field defer');
        assertStringIncludes(error.message, 'loader must be a named export');
      },
      page,
      unexported,
    );
  }
  await fixture(
    async (dir) => {
      assertEquals((await scanRoutes(dir))[0].streamManifest?.fields.length, 2);
    },
    page,
    route.replace(
      'export const loader',
      'const loader',
    ) + '\nexport { loader };',
  );
});

Deno.test('stream page program must belong to the one class selected by its import', async () => {
  const secondClass = `
@element('other-page')
export class OtherPage extends OpenElement {
  @property({ type: String, attribute: false, reflect: false }) first = '';
  render() { return <main>{this.first}</main>; }
}
`;
  await fixture(async (dir) => {
    const error = await assertRejects(() => scanRoutes(dir)) as Error;
    assertStringIncludes(error.message, 'stream route /, field first');
    assertStringIncludes(error.message, 'declares 2 classes');
  }, page.replace("@element('stream-page'", secondClass + "\n@element('stream-page'"));
  await fixture(async (dir) => {
    const error = await assertRejects(() => scanRoutes(dir)) as Error;
    assertStringIncludes(error.message, 'imported page class does not own');
  }, page.replace('export default class StreamPage', 'export class StreamPage'));
  await fixture(
    async (dir) => {
      assertEquals((await scanRoutes(dir))[0].streamManifest?.program.tag, 'stream-page');
    },
    page.replace('export default class StreamPage', 'export class StreamPage'),
    route.replace(
      "import Page from '../components/page.tsx';",
      "import { StreamPage as Page } from '../components/page.tsx';",
    ),
  );
});

Deno.test('generated entry rejects opaque stream descriptors before serving GET', async () => {
  const indirectRoutes = [
    route.replace(
      "export default definePage(Page, {\n  renderIntent: { mode: 'dynamic', stream: { defer: ['first', 'second'] } },\n});",
      "const descriptor = { renderIntent: { mode: 'dynamic', stream: { defer: ['first', 'second'] } } };\nexport default definePage(Page, descriptor);",
    ),
    route.replace(
      "renderIntent: { mode: 'dynamic', stream: { defer: ['first', 'second'] } },",
      'renderIntent: intent,',
    ).replace(
      'export default definePage(Page, {',
      "const intent = { mode: 'dynamic', stream: { defer: ['first', 'second'] } };\nexport default definePage(Page, {",
    ),
  ];
  for (const source of indirectRoutes) {
    await fixture(
      async (dir) => {
        const routes = await scanRoutes(dir);
        assertEquals(routes[0].streamManifest, undefined);
        const code = renderEntry(buildEntryDescriptor(routes));
        assertStringIncludes(
          code,
          '__assertStreamRoute($Route_Index, "/", "index.tsx", undefined)',
        );
        const start = code.indexOf('function __assertStreamRoute(');
        const end = code.indexOf('\n}', start) + 2;
        const helper = code.slice(start, end) + '\nexport { __assertStreamRoute };';
        const mod = await import(
          'data:text/javascript;charset=utf-8,' + encodeURIComponent(helper)
        ) as {
          __assertStreamRoute: (
            module: unknown,
            route: string,
            file: string,
            manifest: unknown,
          ) => void;
        };
        const pageModule = {
          default: {
            openElementPage: {
              renderIntent: { mode: 'dynamic', stream: { defer: ['first', 'second'] } },
            },
            __partProgram: { version: 1, tag: 'stream-page' },
          },
        };
        const error = assertThrows(
          () => mod.__assertStreamRoute(pageModule, '/', 'index.tsx', undefined),
          Error,
          'no matching compiled route manifest/program',
        );
        assertStringIncludes(error.message, 'field first at index.tsx');
      },
      page,
      source,
    );
  }
  await fixture(async (dir) => {
    const routes = await scanRoutes(dir);
    const code = renderEntry(buildEntryDescriptor(routes));
    const start = code.indexOf('function __assertStreamRoute(');
    const end = code.indexOf('\n}', start) + 2;
    const helper = code.slice(start, end) + '\nexport { __assertStreamRoute };';
    const mod = await import(
      'data:text/javascript;charset=utf-8,' + encodeURIComponent(helper)
    ) as {
      __assertStreamRoute: (
        module: unknown,
        route: string,
        file: string,
        manifest: unknown,
      ) => void;
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
    assertThrows(
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

Deno.test('stream route params and opaque wrappers fail closed', async () => {
  await fixture(
    async (dir) => {
      const error = await assertRejects(() => scanRoutes(dir)) as Error;
      assertStringIncludes(error.message, 'collides with an injected route param property');
    },
    page,
    route,
    '[first].tsx',
  );
  await fixture(async (dir) => {
    const routes = await scanRoutes(dir);
    const error = assertThrows(() =>
      buildEntryDescriptor([...routes, {
        path: '/_renderer',
        filePath: '_renderer.ts',
        type: 'special',
        varName: 'Renderer',
        special: 'renderer',
      }])
    ) as Error;
    assertStringIncludes(error.message, 'opaque renderer wrapper');
  });
});
