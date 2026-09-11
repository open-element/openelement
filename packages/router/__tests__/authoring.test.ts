/**
 * @openelement/router — authoring API tests for the compiled contract (v0.44,
 * ADR-0143).
 *
 * definePage() no longer creates page classes around a render function: it
 * attaches the page descriptor (head, route, renderIntent, props/error
 * projectors) to the compiled element class the route module default-exports.
 * The render coverage of the legacy suite (VNode rendering, render-scope data
 * hooks) is replaced by the compiled serializer path — the hand-built
 * compiled class below renders through the public renderDsd(), and the
 * request-time fixture (packages/adapter-vite/__fixtures__/request-time)
 * covers loader/action data reaching rendered HTML end-to-end.
 */

import { assertEquals, assertExists, assertInstanceOf, assertThrows } from '@std/assert';
import { OpenElement, OpenElementError, renderDsd } from '@openelement/element';
import {
  classifyActionResult,
  defineApp,
  defineIslandConfig,
  definePage,
  fail,
  isOpenElementNotFound,
  isOpenElementRedirect,
  notFound,
  projectPageProps,
  redirect,
} from '../src/index.ts';
import * as appSurface from '../src/index.ts';

/** A minimal valid compiled statics set for a static <main> page program. */
function makeCompiledPageClass(tag: string, text: string): CustomElementConstructor {
  const program = {
    version: 1,
    tag,
    root: { id: 'root', kind: 'light', nodes: ['e0'] },
    template: [
      {
        k: 'el',
        id: 'e0',
        tag: 'main',
        attrs: [],
        children: [{ k: 'text', value: text }],
      },
    ],
    parts: [],
    regions: [],
    dependencies: [],
    locations: [{ id: 'e0', kind: 'element', tag: 'main', path: [0] }],
    sourceMap: {
      version: 1,
      file: 'test.tsx',
      records: [
        {
          id: 'root',
          kind: 'root',
          source: {
            file: 'test.tsx',
            start: { offset: 0, line: 1, column: 1 },
            end: { offset: 8, line: 1, column: 9 },
          },
        },
        {
          id: 'e0',
          kind: 'element',
          source: {
            file: 'test.tsx',
            start: { offset: 16, line: 2, column: 1 },
            end: { offset: 24, line: 2, column: 9 },
          },
        },
      ],
    },
    metadata: {
      tag,
      className: 'TestPage',
      sourceFile: 'test.tsx',
      properties: [],
      observedAttributes: [],
      cem: {
        tagName: tag,
        className: 'TestPage',
        declaration: { name: 'TestPage', module: 'test.tsx' },
        attributes: [],
        members: [],
      },
    },
  };
  class TestPage extends OpenElement {
    static __partProgram = program;
    static __compiledProperties: unknown[] = [];
    static __elementMetadata = program.metadata;
    static observedAttributes: string[] = [];
  }
  return TestPage as unknown as CustomElementConstructor;
}

Deno.test('@openelement/router root export includes defineApp', () => {
  assertEquals(typeof defineApp, 'function');
});

Deno.test('definePage() attaches the descriptor to the compiled class and returns it', () => {
  const Page = makeCompiledPageClass('test-page', 'Hello OpenElement');
  const props = () => ({});
  const error = () => ({});
  const result = definePage(Page, {
    route: { id: 'home' },
    head: {
      title: 'Home',
      description: 'Application API',
      meta: [{ name: 'robots', content: 'index' }],
      dangerouslyHeadFragments: ['<link rel="canonical" href="https://example.test/">'],
    },
    renderIntent: { mode: 'static' },
    props,
    error,
  });

  assertEquals(result, Page);
  const descriptor = (Page as unknown as { openElementPage: Record<string, unknown> })
    .openElementPage;
  assertEquals(descriptor.kind, 'page');
  assertEquals(descriptor.route, { id: 'home' });
  assertEquals(descriptor.head, {
    title: 'Home',
    description: 'Application API',
    meta: [{ name: 'robots', content: 'index' }],
    dangerouslyHeadFragments: ['<link rel="canonical" href="https://example.test/">'],
  });
  assertEquals(descriptor.renderIntent, { mode: 'static' });
  assertEquals(descriptor.props, props);
  assertEquals(descriptor.error, error);
});

Deno.test('definePage(Class) without a descriptor defaults renderIntent to static', () => {
  const Page = makeCompiledPageClass('plain-page', 'plain');
  definePage(Page);
  const descriptor = (Page as unknown as { openElementPage: Record<string, unknown> })
    .openElementPage;
  assertEquals(descriptor.kind, 'page');
  assertEquals(descriptor.renderIntent, { mode: 'static' });
  assertEquals(descriptor.props, undefined);
  assertEquals(descriptor.error, undefined);
});

Deno.test('definePage() descriptor renders through the compiled serializer', () => {
  const Page = makeCompiledPageClass('rendered-page', 'Hello from definePage');
  definePage(Page, { head: { title: 'Rendered' } });

  const out = renderDsd('rendered-page', { componentClass: Page });

  assertEquals(out.errors.length, 0);
  assertEquals(out.html.includes('Hello from definePage'), true);
});

Deno.test('definePage() requires the compiled class as its first argument', () => {
  assertThrows(
    () => {
      definePage((() => null) as never);
    },
    Error,
    'requires the compiled page element class',
  );
});

Deno.test('definePage() rejects legacy top-level descriptor fields', () => {
  const Page = makeCompiledPageClass('legacy-page', 'legacy');
  for (const field of ['render', 'title', 'layout', 'styles']) {
    assertThrows(
      () => {
        definePage(Page, { [field]: () => null } as never);
      },
      Error,
      `top-level "${field}"`,
    );
  }
});

Deno.test('definePage() rejects non-function projectors', () => {
  const Page = makeCompiledPageClass('bad-projector-page', 'nope');
  assertThrows(
    () => {
      definePage(Page, { props: {} } as never);
    },
    Error,
    'props must be a projector function',
  );
  assertThrows(
    () => {
      definePage(Page, { error: true } as never);
    },
    Error,
    'error must be an error projector function',
  );
});

Deno.test("definePage() rejects the collapsed 'auto' mode and invalid modes (#609)", () => {
  for (const mode of ['auto', 'dynmaic']) {
    assertThrows(
      () => {
        definePage(makeCompiledPageClass('mode-page', 'nope'), {
          renderIntent: { mode: mode as never },
        });
      },
      Error,
      "renderIntent.mode must be 'static' or 'dynamic'",
    );
  }
});

Deno.test('projectPageProps() defaults to params + loader-data record entries', () => {
  assertEquals(
    projectPageProps({ params: { id: '42' }, data: { title: 'Hello', n: 1 } }),
    { id: '42', title: 'Hello', n: 1 },
  );
  // Non-record loader data contributes nothing (arrays are positional, not named).
  assertEquals(projectPageProps({ params: { id: '7' }, data: ['a'] }), { id: '7' });
  assertEquals(projectPageProps({}), {});
});

Deno.test('classifyActionResult() is the shared success, validation, and invalid-Response authority', () => {
  assertEquals(classifyActionResult({ saved: true }), {
    kind: 'success',
    data: { saved: true },
  });
  assertEquals(classifyActionResult(fail(422, { field: 'required' })), {
    kind: 'failure',
    status: 422,
    data: { field: 'required' },
  });
  assertThrows(
    () => classifyActionResult(new Response('not allowed')),
    OpenElementError,
    'Actions must not return a Response object',
  );
});

Deno.test('redirect() and notFound() expose typed lifecycle control errors', () => {
  let redirectError: unknown;
  try {
    redirect('/login', 307);
  } catch (error) {
    redirectError = error;
  }

  assertEquals(isOpenElementRedirect(redirectError), true);
  assertEquals((redirectError as { location: string }).location, '/login');
  assertEquals((redirectError as { status: number }).status, 307);
  assertInstanceOf(redirectError, OpenElementError);

  let notFoundError: unknown;
  try {
    notFound('missing article');
  } catch (error) {
    notFoundError = error;
  }

  assertEquals(isOpenElementNotFound(notFoundError), true);
  assertEquals((notFoundError as { status: number }).status, 404);
  assertInstanceOf(notFoundError, OpenElementError);
});

Deno.test('framework error boundary catches redirect/notFound via OpenElementError (ADR-0053)', () => {
  // #898: one `catch (e: OpenElementError)` must be the single boundary for
  // the exception-channel error classes.
  let caught: OpenElementError | null = null;
  try {
    redirect('/teapot', 302);
  } catch (error) {
    if (error instanceof OpenElementError) caught = error;
  }
  assertEquals(caught !== null, true);
  assertEquals(caught?.code, 'REDIRECT');

  let caughtNotFound: OpenElementError | null = null;
  try {
    notFound('missing');
  } catch (error) {
    if (error instanceof OpenElementError) caughtNotFound = error;
  }
  assertEquals(caughtNotFound !== null, true);
  assertEquals(caughtNotFound?.code, 'NOT_FOUND');
});

Deno.test('redirect() validates the 3xx whitelist at construction (ADR-0121 §3)', () => {
  // Valid statuses construct fine.
  for (const status of [301, 302, 303, 307, 308]) {
    let err: unknown;
    try {
      redirect('/target', status);
    } catch (error) {
      err = error;
    }
    assertEquals(isOpenElementRedirect(err), true, `status ${status} must be accepted`);
  }
  // A non-3xx "redirect" is a response the browser never follows — reject it.
  for (const status of [200, 201, 204, 400, 404, 418, 500]) {
    assertThrows(
      () => redirect('/target', status as never),
      Error,
      'redirect() status must be one of 301/302/303/307/308',
    );
  }
  // The duck-typed guard honors the same whitelist (#583): a shaped object
  // with an arbitrary status must not take the redirect channel.
  assertEquals(
    isOpenElementRedirect({
      name: 'OpenElementRedirect',
      location: 'https://evil.example',
      status: 200,
    }),
    false,
  );
  assertEquals(
    isOpenElementRedirect({ name: 'OpenElementRedirect', location: '/ok', status: 303 }),
    true,
  );
});

Deno.test('@openelement/router root exports the compiled authoring helpers', () => {
  assertExists(definePage);
  assertExists(defineIslandConfig);
  assertExists(projectPageProps);
  // Removed legacy authoring surface (v0.44): defineElement/defineIsland and
  // the render-scope data hooks are gone.
  assertEquals('defineElement' in appSurface, false);
  assertEquals('defineIsland' in appSurface, false);
  assertEquals('useLoaderData' in appSurface, false);
  assertEquals('useActionData' in appSurface, false);
});

Deno.test('public App surface does not expose data-context mutation hooks', () => {
  assertEquals('__enterDataContext' in appSurface, false);
  assertEquals('__exitDataContext' in appSurface, false);
  assertEquals('__activeDataContext' in appSurface, false);
});

Deno.test('defineIslandConfig() returns canonical island metadata shape', () => {
  const config = defineIslandConfig({ hydrate: 'visible', dsd: false, ssr: false });

  assertEquals(config.hydrate, 'visible');
  assertEquals(config.dsd, false);
  assertEquals(config.ssr, false);
});

Deno.test('defineIslandConfig() bounds media delivery queries', () => {
  assertThrows(
    () => {
      defineIslandConfig({ hydrate: 'media', media: 'x'.repeat(513) });
    },
    Error,
    'unsafe or oversized query',
  );
});

Deno.test('defineIslandConfig() rejects non-canonical island metadata', () => {
  assertThrows(
    () => {
      defineIslandConfig({ mode: 'legacy' } as never);
    },
    Error,
    'does not accept "mode"',
  );
  assertThrows(
    () => {
      defineIslandConfig({ hydrate: 'lazy' } as never);
    },
    Error,
    'Invalid island hydrate strategy "lazy"',
  );
  assertThrows(
    () => {
      defineIslandConfig({ ssr: 'yes' } as never);
    },
    Error,
    'ssr must be a boolean',
  );
});
