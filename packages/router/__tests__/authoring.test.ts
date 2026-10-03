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
 * request-time fixture (tests/fixtures/router-request-time)
 * covers loader/action data reaching rendered HTML end-to-end.
 */

import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import { OpenElement, OpenElementError, renderDsd } from '@openelement/element';
import { IslandErrorCode, PageErrorCode } from '../src/internal/error-codes.ts';
import {
  classifyActionResult,
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

test('definePage() attaches the descriptor to the compiled class and returns it', () => {
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

  expect(result).toEqual(Page);
  const descriptor = (Page as unknown as { openElementPage: Record<string, unknown> })
    .openElementPage;
  expect(descriptor.kind).toEqual('page');
  expect(descriptor.route).toEqual({ id: 'home' });
  expect(descriptor.head).toEqual({
    title: 'Home',
    description: 'Application API',
    meta: [{ name: 'robots', content: 'index' }],
    dangerouslyHeadFragments: ['<link rel="canonical" href="https://example.test/">'],
  });
  expect(descriptor.renderIntent).toEqual({ mode: 'static' });
  expect(descriptor.props).toEqual(props);
  expect(descriptor.error).toEqual(error);
});

test('definePage(Class) without a descriptor defaults renderIntent to static', () => {
  const Page = makeCompiledPageClass('plain-page', 'plain');
  definePage(Page);
  const descriptor = (Page as unknown as { openElementPage: Record<string, unknown> })
    .openElementPage;
  expect(descriptor.kind).toEqual('page');
  expect(descriptor.renderIntent).toEqual({ mode: 'static' });
  expect(descriptor.props).toEqual(undefined);
  expect(descriptor.error).toEqual(undefined);
});

test('definePage() validates the opt-in stream.defer authoring shape', () => {
  const Page = makeCompiledPageClass('stream-authoring-page', 'Hello');
  definePage(Page, {
    renderIntent: { mode: 'dynamic', stream: { defer: ['first', 'second'] } },
  });
  expect(
    (Page as unknown as { openElementPage: { renderIntent: unknown } }).openElementPage
      .renderIntent,
  ).toEqual({ mode: 'dynamic', stream: { defer: ['first', 'second'] } });
  const invalid = [
    { mode: 'static', stream: { defer: ['first'] } },
    { mode: 'dynamic', stream: { defer: [] } },
    { mode: 'dynamic', stream: { defer: ['first', 'first'] } },
    { mode: 'dynamic', stream: { defer: ['__proto__'] } },
    { mode: 'dynamic', stream: { defer: ['bad-key'] } },
    { mode: 'dynamic', stream: { defer: 'first' } },
    { mode: 'dynamic', stream: { defer: ['first'], unexpected: true } },
  ];
  for (const renderIntent of invalid) {
    assertThrowsIncludes(
      () => definePage(Page, { renderIntent } as never),
      OpenElementError,
      'renderIntent.stream requires mode',
    );
  }
});

test('definePage() descriptor renders through the compiled serializer', () => {
  const Page = makeCompiledPageClass('rendered-page', 'Hello from definePage');
  definePage(Page, { head: { title: 'Rendered' } });

  const out = renderDsd('rendered-page', { componentClass: Page });

  expect(out.errors.length).toEqual(0);
  expect(out.html.includes('Hello from definePage')).toEqual(true);
});

test('definePage() requires the compiled class as its first argument', () => {
  assertThrowsIncludes(
    () => {
      definePage((() => null) as never);
    },
    Error,
    'requires the compiled page element class',
  );
});

test('definePage() rejects legacy top-level descriptor fields', () => {
  const Page = makeCompiledPageClass('legacy-page', 'legacy');
  for (const field of ['render', 'title', 'layout', 'styles']) {
    assertThrowsIncludes(
      () => {
        definePage(Page, { [field]: () => null } as never);
      },
      Error,
      `top-level "${field}"`,
    );
  }
});

test('definePage() rejects non-function projectors', () => {
  const Page = makeCompiledPageClass('bad-projector-page', 'nope');
  assertThrowsIncludes(
    () => {
      definePage(Page, { props: {} } as never);
    },
    Error,
    'props must be a projector function',
  );
  assertThrowsIncludes(
    () => {
      definePage(Page, { error: true } as never);
    },
    Error,
    'error must be an error projector function',
  );
});

test("definePage() rejects the collapsed 'auto' mode and invalid modes (#609)", () => {
  for (const mode of ['auto', 'dynmaic']) {
    assertThrowsIncludes(
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

test('definePage() admits route.layout (string | false) and rejects other types', () => {
  const Page = makeCompiledPageClass('layout-page', 'ok');
  definePage(Page, { route: { layout: 'post' } });
  definePage(Page, { route: { layout: false } });
  for (const layout of [true, 0, {}, ['post']]) {
    assertThrowsIncludes(
      () => {
        definePage(Page, { route: { layout: layout as never } });
      },
      Error,
      'route.layout must be a layout name string or false',
    );
  }
});

test('projectPageProps() defaults to params + loader-data record entries', () => {
  expect(projectPageProps({ params: { id: '42' }, data: { title: 'Hello', n: 1 } })).toEqual({
    id: '42',
    title: 'Hello',
    n: 1,
  });
  // Non-record loader data contributes nothing (arrays are positional, not named).
  expect(projectPageProps({ params: { id: '7' }, data: ['a'] })).toEqual({ id: '7' });
  expect(projectPageProps({})).toEqual({});
});

test('classifyActionResult() is the shared success, validation, and invalid-Response authority', () => {
  expect(classifyActionResult({ saved: true })).toEqual({
    kind: 'success',
    data: { saved: true },
  });
  expect(classifyActionResult(fail(422, { field: 'required' }))).toEqual({
    kind: 'failure',
    status: 422,
    data: { field: 'required' },
  });
  assertThrowsIncludes(
    () => classifyActionResult(new Response('not allowed')),
    OpenElementError,
    'Actions must not return a Response object',
  );
});

test('redirect() and notFound() expose typed lifecycle control errors', () => {
  let redirectError: unknown;
  try {
    redirect('/login', 307);
  } catch (error) {
    redirectError = error;
  }

  expect(isOpenElementRedirect(redirectError)).toEqual(true);
  expect((redirectError as { location: string }).location).toEqual('/login');
  expect((redirectError as { status: number }).status).toEqual(307);
  expect(redirectError).toBeInstanceOf(OpenElementError);

  let notFoundError: unknown;
  try {
    notFound('missing article');
  } catch (error) {
    notFoundError = error;
  }

  expect(isOpenElementNotFound(notFoundError)).toEqual(true);
  expect((notFoundError as { status: number }).status).toEqual(404);
  expect(notFoundError).toBeInstanceOf(OpenElementError);
});

test('framework error boundary catches redirect/notFound via OpenElementError (ADR-0053)', () => {
  // #898: one `catch (e: OpenElementError)` must be the single boundary for
  // the exception-channel error classes.
  let caught: OpenElementError | null = null;
  try {
    redirect('/teapot', 302);
  } catch (error) {
    if (error instanceof OpenElementError) caught = error;
  }
  expect(caught !== null).toEqual(true);
  expect(caught?.code).toEqual('REDIRECT');

  let caughtNotFound: OpenElementError | null = null;
  try {
    notFound('missing');
  } catch (error) {
    if (error instanceof OpenElementError) caughtNotFound = error;
  }
  expect(caughtNotFound !== null).toEqual(true);
  expect(caughtNotFound?.code).toEqual('NOT_FOUND');
});

test('redirect() validates the 3xx whitelist at construction (ADR-0121 §3)', () => {
  // Valid statuses construct fine.
  for (const status of [301, 302, 303, 307, 308]) {
    let err: unknown;
    try {
      redirect('/target', status);
    } catch (error) {
      err = error;
    }
    expect(isOpenElementRedirect(err), `status ${status} must be accepted`).toEqual(true);
  }
  // A non-3xx "redirect" is a response the browser never follows — reject it.
  for (const status of [200, 201, 204, 400, 404, 418, 500]) {
    assertThrowsIncludes(
      () => redirect('/target', status as never),
      Error,
      'redirect() status must be one of 301/302/303/307/308',
    );
  }
  // The duck-typed guard honors the same whitelist (#583): a shaped object
  // with an arbitrary status must not take the redirect channel.
  expect(
    isOpenElementRedirect({
      name: 'OpenElementRedirect',
      location: 'https://evil.example',
      status: 200,
    }),
  ).toEqual(false);
  expect(
    isOpenElementRedirect({ name: 'OpenElementRedirect', location: '/ok', status: 303 }),
  ).toEqual(true);
});

test('@openelement/router root exports the compiled authoring helpers', () => {
  expect(definePage).toEqual(expect.anything());
  expect(defineIslandConfig).toEqual(expect.anything());
  expect(projectPageProps).toEqual(expect.anything());
  // Removed legacy authoring surface (v0.44): defineElement/defineIsland and
  // the render-scope data hooks are gone.
  expect('defineElement' in appSurface).toEqual(false);
  expect('defineIsland' in appSurface).toEqual(false);
  expect('useLoaderData' in appSurface).toEqual(false);
  expect('useActionData' in appSurface).toEqual(false);
});

test('public App surface does not expose data-context mutation hooks', () => {
  expect('__enterDataContext' in appSurface).toEqual(false);
  expect('__exitDataContext' in appSurface).toEqual(false);
  expect('__activeDataContext' in appSurface).toEqual(false);
});

test('defineIslandConfig() returns canonical island metadata shape', () => {
  const config = defineIslandConfig({ hydrate: 'visible', dsd: false, ssr: false });

  expect(config.hydrate).toEqual('visible');
  expect(config.dsd).toEqual(false);
  expect(config.ssr).toEqual(false);
});

test('defineIslandConfig() bounds media delivery queries', () => {
  assertThrowsIncludes(
    () => {
      defineIslandConfig({ hydrate: 'media', media: 'x'.repeat(513) });
    },
    Error,
    'unsafe or oversized query',
  );
});

test('defineIslandConfig() rejects non-canonical island metadata', () => {
  assertThrowsIncludes(
    () => {
      defineIslandConfig({ mode: 'legacy' } as never);
    },
    Error,
    'does not accept "mode"',
  );
  assertThrowsIncludes(
    () => {
      defineIslandConfig({ hydrate: 'lazy' } as never);
    },
    Error,
    'Invalid island hydrate strategy "lazy"',
  );
  assertThrowsIncludes(
    () => {
      defineIslandConfig({ ssr: 'yes' } as never);
    },
    Error,
    'ssr must be a boolean',
  );
});

/**
 * #1413 W3: every authoring failure is classified — a stable code plus the
 * `validation` phase and `error` severity — so a host can branch on the kind
 * of failure instead of matching message text, and `/errors` can enumerate
 * the code table. The remediation sentence (what to write instead) is part of
 * the contract too: it is what makes the message actionable.
 */
test('#1413 authoring errors: definePage() failure modes carry codes and remediation', () => {
  const Page = makeCompiledPageClass('classified-page', 'classified');
  const cases: Array<[() => unknown, string]> = [
    [() => definePage((() => null) as never), PageErrorCode.NOT_COMPILED_CLASS],
    [() => definePage(Page, [] as never), PageErrorCode.DESCRIPTOR_SHAPE],
    [() => definePage(Page, { render: () => null } as never), PageErrorCode.DESCRIPTOR_SHAPE],
    [() => definePage(Page, { route: { path: '/x' } } as never), PageErrorCode.ROUTE_INTENT],
    [() => definePage(Page, { route: { layout: true } } as never), PageErrorCode.ROUTE_INTENT],
    [() => definePage(Page, { props: {} } as never), PageErrorCode.PROJECTOR],
    [() => definePage(Page, { error: true } as never), PageErrorCode.PROJECTOR],
    [
      () => definePage(Page, { renderIntent: { mode: 'dynmaic' } } as never),
      PageErrorCode.RENDER_MODE,
    ],
  ];
  for (const [run, code] of cases) {
    let thrown: unknown;
    try {
      run();
    } catch (error) {
      thrown = error;
    }
    expect(thrown, `${code} must be an OpenElementError`).toBeInstanceOf(OpenElementError);
    expect(thrown.code).toEqual(code);
    expect(thrown.phase).toEqual('validation');
    expect(thrown.severity).toEqual('error');
    // Remediation: the message states what to write, not only what failed.
    expect(
      /write|use |remove|pass |drop |omit|either|never /i.test(thrown.message),
      `${code} must carry remediation guidance, got: ${thrown.message}`,
    ).toBeTruthy();
  }
});

test('#1413 authoring errors: defineIslandConfig() failure modes carry codes', () => {
  const cases: Array<[unknown, string]> = [
    [{ mode: 'legacy' }, IslandErrorCode.DESCRIPTOR_SHAPE],
    [{ ssr: 'yes' }, IslandErrorCode.DESCRIPTOR_SHAPE],
    [{ dsd: 'yes' }, IslandErrorCode.DESCRIPTOR_SHAPE],
    [{ hydrate: 'lazy' }, IslandErrorCode.HYDRATE],
    [{ hydrate: 'media' }, IslandErrorCode.HYDRATE],
    [{ media: '(min-width: 1px)' }, IslandErrorCode.HYDRATE],
    [{ tags: [] }, IslandErrorCode.TAGS],
    [{ tags: ['Bad-Tag'] }, IslandErrorCode.TAGS],
    [{ tags: ['a-b'], tagNames: ['c-d'] }, IslandErrorCode.TAGS],
    [{ exportNames: [] }, IslandErrorCode.EXPORT_NAMES],
    [{ tags: ['a-b'], exportNames: { 'c-d': 'X' } }, IslandErrorCode.EXPORT_NAMES],
  ];
  for (const [config, code] of cases) {
    let thrown: unknown;
    try {
      defineIslandConfig(config as never);
    } catch (error) {
      thrown = error;
    }
    expect(thrown, `${JSON.stringify(config)} must classify`).toBeInstanceOf(OpenElementError);
    expect(thrown.code).toEqual(code);
    expect(thrown.phase).toEqual('validation');
    expect(thrown.severity).toEqual('error');
    // The remediation sentence: what to change, not only what failed.
    expect(
      /write |add |use one of|use only|remove |either |e\.g\.|make them identical|declare only one/i.test(
        thrown.message,
      ),
      `${code} must carry remediation guidance, got: ${thrown.message}`,
    ).toBeTruthy();
  }
});
