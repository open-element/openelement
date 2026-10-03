/**
 * The router's structured error catalog (src/internal/error-codes.ts).
 *
 * Mirrors the element package's error-dialect checks: every table carries
 * stable, unique, `OE_`-namespaced values; the factories raise
 * `OpenElementError` with the phase their surface implies; and one raiser per
 * converged surface is proven to report its catalogue code through the real
 * public/internal entry a consumer would drive.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
import { assertRejectsIncludes, assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import { join } from '@std/path';
import { OpenElementError } from '@openelement/element';
import { resolvePageDocument } from '../src/document.ts';
import type { PagePropsContext } from '../src/index.ts';
import {
  authoringError,
  buildError,
  ClientAssetErrorCode,
  DeliveryErrorCode,
  DescriptorErrorCode,
  DispatchErrorCode,
  DocumentErrorCode,
  IslandEntryErrorCode,
  IslandErrorCode,
  MdxErrorCode,
  PackageIslandErrorCode,
  PageErrorCode,
  RendererErrorCode,
  RouteScanErrorCode,
  serveError,
  ServeErrorCode,
  SsgDynamicErrorCode,
  SsgRenderErrorCode,
  StreamErrorCode,
} from '../src/internal/error-codes.ts';
import { validateIslandMediaQuery } from '../src/vite/internal/ssg/delivery.ts';
import { validateIslandModuleSpecifier } from '../src/vite/internal/ssg/entry-generators.ts';
import { buildEntryDescriptor } from '../src/vite/internal/ssg/entry-descriptor.ts';
import { ssgRender } from '../src/vite/internal/ssg/ssg-render.ts';
import { buildPackageIslandDecls } from '../src/vite/internal/ssg/island-scanner.ts';
import { scanRoutes } from '../src/vite/internal/ssg/index.ts';
import { resolveDynamicRoutePath } from '../src/vite/internal/ssg/ssg-helpers.ts';
import { mdxToCompiledPageSource } from '../src/vite/plugin-mdx-lower.ts';
import { assertLitStreamRoute } from '../src/vite/internal/server-runtime/route-dispatch.ts';
import {
  createDeferredPageShell,
  streamFields,
} from '../src/vite/internal/server-runtime/stream-runtime.ts';
import { createNativePageRenderer } from '../src/vite/internal/server-runtime/renderer-runtime.ts';
import {
  buildClientAssetManifest,
  findClientEntryFile,
  readViteClientManifest,
} from '../src/vite/client-asset-manifest.ts';
import { islandChunkMapFromAssetManifest } from '../src/vite/internal/ssg/build-postprocess.ts';
import type { ClientIslandDeliveryEntry } from '../src/vite/internal/ssg/delivery.ts';
import type {
  SsgRenderOptions,
  SsrBundle,
  StreamRouteManifest,
} from '../src/vite/internal/protocol/ssg.ts';

const TABLES = {
  PageErrorCode,
  IslandErrorCode,
  ServeErrorCode,
  DeliveryErrorCode,
  IslandEntryErrorCode,
  DescriptorErrorCode,
  ClientAssetErrorCode,
  SsgRenderErrorCode,
  DocumentErrorCode,
  StreamErrorCode,
  DispatchErrorCode,
  RendererErrorCode,
  MdxErrorCode,
  PackageIslandErrorCode,
  RouteScanErrorCode,
  SsgDynamicErrorCode,
};

test('error codes: every table value is a stable, unique, namespaced string', () => {
  const seen = new Map<string, string>();
  for (const [table, codes] of Object.entries(TABLES)) {
    expect(Object.keys(codes).length > 0, `${table} must declare at least one code`).toBeTruthy();
    for (const [name, value] of Object.entries(codes)) {
      expect(
        typeof value === 'string' && value.startsWith('OE_'),
        `${table}.${name} must use the OE_ namespace`,
      ).toBeTruthy();
      expect(
        !seen.has(value),
        `${table}.${name} reuses code ${value}, already declared by ${seen.get(value)}`,
      ).toBeTruthy();
      seen.set(value, `${table}.${name}`);
    }
  }
  expect(seen.get('OE_DOCUMENT_HEAD_INVALID')).toEqual('DocumentErrorCode.HEAD_INVALID');
});

test('error codes: the factories carry the phase their surface implies', () => {
  const validation = authoringError(PageErrorCode.PROJECTOR, 'boom');
  assertThrowsIncludes(() => {
    throw validation;
  }, OpenElementError);
  expect([validation.phase, validation.severity, validation.recoverable]).toEqual([
    'validation',
    'error',
    false,
  ]);
  const build = buildError(DescriptorErrorCode.CORS, 'boom');
  expect([build.phase, build.severity, build.recoverable]).toEqual(['build', 'error', false]);
  // buildError preserves the wrapped cause for diagnostics.
  const cause = new Error('inner');
  expect(buildError(DeliveryErrorCode.TAGS, 'boom', { cause }).cause).toEqual(cause);
  const serve = serveError(StreamErrorCode.DEFERRED_TIMEOUT, 'boom');
  expect([serve.phase, serve.severity, serve.recoverable]).toEqual(['ssr', 'error', false]);
});

function ctx(): PagePropsContext {
  return {
    data: undefined,
    actionData: undefined,
    params: {},
    route: { path: '/notes' },
    meta: {},
  };
}

test('error codes: the Document seam reports HEAD_INVALID as a validation failure', () => {
  const error = assertThrowsIncludes(
    () => resolvePageDocument('not-an-object' as never, ctx()),
    OpenElementError,
    '[openElement] resolvePageDocument:',
  );
  expect(error.code).toEqual(DocumentErrorCode.HEAD_INVALID);
  expect(error.phase).toEqual('validation');
});

test('error codes: island delivery and entry admission report build-phase codes', () => {
  const media = assertThrowsIncludes(
    () => validateIslandMediaQuery(42, 'island'),
    OpenElementError,
    'Invalid island media query',
  );
  expect(media.code).toEqual(DeliveryErrorCode.MEDIA_QUERY);
  expect(media.phase).toEqual('build');

  const modulePath = assertThrowsIncludes(
    () => validateIslandModuleSpecifier('https://evil.example/island.js'),
    OpenElementError,
    'Invalid island modulePath',
  );
  expect(modulePath.code).toEqual(IslandEntryErrorCode.MODULE_PATH);
  expect(modulePath.phase).toEqual('build');

  const cors = assertThrowsIncludes(
    () =>
      buildEntryDescriptor([], {
        middleware: { corsOrigin: (() => 'https://x') as never },
      }),
    OpenElementError,
    'middleware.corsOrigin',
  );
  expect(cors.code).toEqual(DescriptorErrorCode.CORS);
});

test('error codes: the SSG render pipeline reports build-phase codes', async () => {
  const error = await assertRejectsIncludes(
    () => ssgRender({} as unknown as SsrBundle, {} as SsgRenderOptions),
    OpenElementError,
    'does not export routeInfo',
  );
  expect(error.code).toEqual(SsgRenderErrorCode.ROUTE_INFO_MISSING);
  expect(error.phase).toEqual('build');
});

test('error codes: the client asset manifest reports build-phase codes', async () => {
  const error = await assertRejectsIncludes(
    () => readViteClientManifest('/nonexistent/dist/client/.vite/manifest.json'),
    OpenElementError,
    '/nonexistent/dist/client/.vite/manifest.json',
  );
  expect(error.code).toEqual(ClientAssetErrorCode.MANIFEST_READ);
  expect(error.phase).toEqual('build');
});

test('error codes: manifest entry cardinality and tag ownership report build-phase codes', () => {
  // Two manifest records claiming the client entry fail regardless of the
  // order their keys iterate in (OE_CLIENT_ASSET_ENTRY_AMBIGUOUS).
  const ambiguous = assertThrowsIncludes(
    () =>
      findClientEntryFile({
        'virtual:open-client-entry': { file: 'islands/client.js' },
        'app/_client/open-client-entry.ts': { file: 'islands/client-2.js' },
      }),
    OpenElementError,
  );
  expect(ambiguous.code).toEqual(ClientAssetErrorCode.ENTRY_AMBIGUOUS);
  expect(ambiguous.phase).toEqual('build');

  // A delivery tag claimed by two island entries fails even when both would
  // resolve identically (OE_CLIENT_ASSET_ISLAND_TAG_DUPLICATE).
  const duplicate = assertThrowsIncludes(
    () =>
      buildClientAssetManifest({
        root: '/proj',
        base: '/',
        islands: [
          { entry: islandEntry(), sourceFile: '/proj/app/islands/counter.ts' },
          { entry: islandEntry(), sourceFile: '/proj/app/islands/counter.ts' },
        ],
        viteManifest: {
          'virtual:open-client-entry': { file: 'islands/client.js', isEntry: true },
        },
        chunks: [],
        manifestPath: '/proj/dist/client/.vite/manifest.json',
      }),
    OpenElementError,
  );
  expect(duplicate.code).toEqual(ClientAssetErrorCode.ISLAND_TAG_DUPLICATE);
  expect(duplicate.phase).toEqual('build');

  // The SSG post-processor's manifest join fails closed for an admitted
  // island with no manifest record (OE_CLIENT_ASSET_ISLAND_UNMAPPED).
  const unmapped = assertThrowsIncludes(
    () => islandChunkMapFromAssetManifest(null, ['open-ghost']),
    OpenElementError,
  );
  expect(unmapped.code).toEqual(ClientAssetErrorCode.ISLAND_UNMAPPED);
  expect(unmapped.phase).toEqual('build');
});

/** The minimal delivery entry the raiser proofs above need. */
function islandEntry(): ClientIslandDeliveryEntry {
  return { tagName: 'open-counter', modulePath: '/app/islands/counter.ts', strategy: 'idle' };
}

/** The minimal stream manifest the front-gate raiser proof needs. */
function streamManifest(): StreamRouteManifest {
  return {
    program: { version: 1, tag: 'oe-unit', sha256: 'a'.repeat(64) },
    fields: [],
  };
}

test('error codes: the streaming pump reports ssr-phase codes', async () => {
  // The front gate rejects non-object loader data (LOADER_NOT_OBJECT)…
  const loader = assertThrowsIncludes(
    () => streamFields('nope', streamManifest()),
    OpenElementError,
    'stream loader must return one object',
  );
  expect(loader.code).toEqual(StreamErrorCode.LOADER_NOT_OBJECT);
  expect(loader.phase).toEqual('ssr');
  // …and the message text is unchanged — clients may match on it.
  expect(loader.message).toEqual('stream loader must return one object');

  // The deferred-shell gate fails closed on a route/manifest/program mismatch.
  const gate = createDeferredPageShell({
    streamManifests: {},
    createDeferredDsdExecutor: () => Promise.reject(new Error('unreached')),
  });
  const mismatch = await assertRejectsIncludes(
    () => gate('/', { default: {} }, {}, 'i', 't'),
    OpenElementError,
    'no matching compiled route manifest/program',
  );
  expect(mismatch.code).toEqual(StreamErrorCode.ROUTE_PROGRAM_MISMATCH);
  expect(mismatch.phase).toEqual('ssr');
});

test('error codes: the dispatch guards and the renderer seam report ssr-phase codes', () => {
  const litStream = assertThrowsIncludes(
    () =>
      assertLitStreamRoute(
        { default: { openElementPage: { renderIntent: { stream: {} } } } },
        '/',
        '/app/routes/streamed.tsx',
      ),
    OpenElementError,
    'Lit renderer does not support stream route',
  );
  expect(litStream.code).toEqual(DispatchErrorCode.LIT_STREAM_UNSUPPORTED);
  expect(litStream.phase).toEqual('ssr');

  const renderer = createNativePageRenderer({
    renderDsd: () => ({ html: '' }),
    customElements: { get: () => undefined },
    ssrRenderableTags: [],
  });
  const tagInvalid = assertThrowsIncludes(
    () => renderer('nohyphen'),
    OpenElementError,
    'Invalid custom element tag',
  );
  expect(tagInvalid.code).toEqual(RendererErrorCode.TAG_INVALID);
  expect(tagInvalid.phase).toEqual('ssr');
  const tagUnregistered = assertThrowsIncludes(
    () => renderer('oe-ghost'),
    OpenElementError,
    'is not registered in the SSR registry',
  );
  expect(tagUnregistered.code).toEqual(RendererErrorCode.TAG_UNREGISTERED);
  expect(tagUnregistered.phase).toEqual('ssr');
});

test('error codes: the mdx pipeline, the island scan, and the route scan report build-phase codes', async () => {
  const mdx = assertThrowsIncludes(
    () => mdxToCompiledPageSource('import x from "y";\n', '/proj/app/routes/hero.mdx'),
    OpenElementError,
    'static Markdown subset',
  );
  expect(mdx.code).toEqual(MdxErrorCode.STATIC_CONTRACT);
  expect(mdx.phase).toEqual('build');

  const manifest = (hydrate: string, media?: string) => ({
    schemaVersion: '1',
    packageName: 'pkg',
    version: '1.0.0',
    declarations: [
      {
        tagName: 'pkg-el',
        openElement: { module: './el.ts', hydrate, ...(media === undefined ? {} : { media }) },
      },
    ],
  });
  const mediaWithoutDelivery = assertThrowsIncludes(
    () => buildPackageIslandDecls([manifest('media') as never]),
    OpenElementError,
    'uses media delivery without media',
  );
  expect(mediaWithoutDelivery.code).toEqual(PackageIslandErrorCode.MEDIA_WITHOUT_DELIVERY);
  expect(mediaWithoutDelivery.phase).toEqual('build');
  const deliveryWithoutMedia = assertThrowsIncludes(
    () => buildPackageIslandDecls([manifest('idle', '(max-width: 400px)') as never]),
    OpenElementError,
    'declares media without media delivery',
  );
  expect(deliveryWithoutMedia.code).toEqual(PackageIslandErrorCode.DELIVERY_WITHOUT_MEDIA);
  expect(deliveryWithoutMedia.phase).toEqual('build');

  const dir = await mkdtemp(join(tmpdir(), 'oe-error-codes-scan-'));
  try {
    const routesDir = join(dir, 'routes');
    await mkdir(routesDir, { recursive: true });
    // `a-b` and `a_b` fold to the same generated identifier (#1029).
    await writeFile(join(routesDir, 'a-b.tsx'), 'export default function Page() {}');
    await writeFile(join(routesDir, 'a_b.tsx'), 'export default function Page() {}');
    const collision = await assertRejectsIncludes(
      () => scanRoutes(routesDir),
      OpenElementError,
      'Route variable name collision',
    );
    expect(collision.code).toEqual(RouteScanErrorCode.VAR_NAME_COLLISION);
    expect(collision.phase).toEqual('build');
  } finally {
    await rm(dir, { recursive: true }).catch(() => {});
  }
});

test('error codes: the dynamic prerender admission reports build-phase codes', () => {
  const missing = assertThrowsIncludes(
    () => resolveDynamicRoutePath('/posts/:id', ['id'], {}),
    OpenElementError,
    'Missing value for route parameter',
  );
  expect(missing.code).toEqual(SsgDynamicErrorCode.PARAM_MISSING);
  expect(missing.phase).toEqual('build');
  const unsafe = assertThrowsIncludes(
    () => resolveDynamicRoutePath('/posts/:id', ['id'], { id: '../escape' }),
    OpenElementError,
    'Unsafe value for route parameter',
  );
  expect(unsafe.code).toEqual(SsgDynamicErrorCode.PARAM_UNSAFE);
  expect(unsafe.phase).toEqual('build');
});
