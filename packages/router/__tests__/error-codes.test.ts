/**
 * The router's structured error catalog (src/internal/error-codes.ts).
 *
 * Mirrors the element package's error-dialect checks: every table carries
 * stable, unique, `OE_`-namespaced values; the factories raise
 * `OpenElementError` with the phase their surface implies; and one raiser per
 * converged surface is proven to report its catalogue code through the real
 * public/internal entry a consumer would drive.
 */

import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert';
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

Deno.test('error codes: every table value is a stable, unique, namespaced string', () => {
  const seen = new Map<string, string>();
  for (const [table, codes] of Object.entries(TABLES)) {
    assert(Object.keys(codes).length > 0, `${table} must declare at least one code`);
    for (const [name, value] of Object.entries(codes)) {
      assert(
        typeof value === 'string' && value.startsWith('OE_'),
        `${table}.${name} must use the OE_ namespace`,
      );
      assert(
        !seen.has(value),
        `${table}.${name} reuses code ${value}, already declared by ${seen.get(value)}`,
      );
      seen.set(value, `${table}.${name}`);
    }
  }
  assertEquals(seen.get('OE_DOCUMENT_HEAD_INVALID'), 'DocumentErrorCode.HEAD_INVALID');
});

Deno.test('error codes: the factories carry the phase their surface implies', () => {
  const validation = authoringError(PageErrorCode.PROJECTOR, 'boom');
  assertThrows(() => {
    throw validation;
  }, OpenElementError);
  assertEquals(
    [validation.phase, validation.severity, validation.recoverable],
    ['validation', 'error', false],
  );
  const build = buildError(DescriptorErrorCode.CORS, 'boom');
  assertEquals([build.phase, build.severity, build.recoverable], ['build', 'error', false]);
  // buildError preserves the wrapped cause for diagnostics.
  const cause = new Error('inner');
  assertEquals(buildError(DeliveryErrorCode.TAGS, 'boom', { cause }).cause, cause);
  const serve = serveError(StreamErrorCode.DEFERRED_TIMEOUT, 'boom');
  assertEquals([serve.phase, serve.severity, serve.recoverable], ['ssr', 'error', false]);
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

Deno.test('error codes: the Document seam reports HEAD_INVALID as a validation failure', () => {
  const error = assertThrows(
    () => resolvePageDocument('not-an-object' as never, ctx()),
    OpenElementError,
    '[openElement] resolvePageDocument:',
  );
  assertEquals(error.code, DocumentErrorCode.HEAD_INVALID);
  assertEquals(error.phase, 'validation');
});

Deno.test('error codes: island delivery and entry admission report build-phase codes', () => {
  const media = assertThrows(
    () => validateIslandMediaQuery(42, 'island'),
    OpenElementError,
    'Invalid island media query',
  );
  assertEquals(media.code, DeliveryErrorCode.MEDIA_QUERY);
  assertEquals(media.phase, 'build');

  const modulePath = assertThrows(
    () => validateIslandModuleSpecifier('https://evil.example/island.js'),
    OpenElementError,
    'Invalid island modulePath',
  );
  assertEquals(modulePath.code, IslandEntryErrorCode.MODULE_PATH);
  assertEquals(modulePath.phase, 'build');

  const cors = assertThrows(
    () =>
      buildEntryDescriptor([], {
        middleware: { corsOrigin: (() => 'https://x') as never },
      }),
    OpenElementError,
    'middleware.corsOrigin',
  );
  assertEquals(cors.code, DescriptorErrorCode.CORS);
});

Deno.test('error codes: the SSG render pipeline reports build-phase codes', async () => {
  const error = await assertRejects(
    () => ssgRender({} as unknown as SsrBundle, {} as SsgRenderOptions),
    OpenElementError,
    'does not export routeInfo',
  );
  assertEquals(error.code, SsgRenderErrorCode.ROUTE_INFO_MISSING);
  assertEquals(error.phase, 'build');
});

Deno.test('error codes: the client asset manifest reports build-phase codes', async () => {
  const error = await assertRejects(
    () => readViteClientManifest('/nonexistent/dist/client/.vite/manifest.json'),
    OpenElementError,
    '/nonexistent/dist/client/.vite/manifest.json',
  );
  assertEquals(error.code, ClientAssetErrorCode.MANIFEST_READ);
  assertEquals(error.phase, 'build');
});

Deno.test('error codes: manifest entry cardinality and tag ownership report build-phase codes', () => {
  // Two manifest records claiming the client entry fail regardless of the
  // order their keys iterate in (OE_CLIENT_ASSET_ENTRY_AMBIGUOUS).
  const ambiguous = assertThrows(
    () =>
      findClientEntryFile({
        'virtual:open-client-entry': { file: 'islands/client.js' },
        'app/_client/open-client-entry.ts': { file: 'islands/client-2.js' },
      }),
    OpenElementError,
  );
  assertEquals(ambiguous.code, ClientAssetErrorCode.ENTRY_AMBIGUOUS);
  assertEquals(ambiguous.phase, 'build');

  // A delivery tag claimed by two island entries fails even when both would
  // resolve identically (OE_CLIENT_ASSET_ISLAND_TAG_DUPLICATE).
  const duplicate = assertThrows(
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
  assertEquals(duplicate.code, ClientAssetErrorCode.ISLAND_TAG_DUPLICATE);
  assertEquals(duplicate.phase, 'build');

  // The SSG post-processor's manifest join fails closed for an admitted
  // island with no manifest record (OE_CLIENT_ASSET_ISLAND_UNMAPPED).
  const unmapped = assertThrows(
    () => islandChunkMapFromAssetManifest(null, ['open-ghost']),
    OpenElementError,
  );
  assertEquals(unmapped.code, ClientAssetErrorCode.ISLAND_UNMAPPED);
  assertEquals(unmapped.phase, 'build');
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

Deno.test('error codes: the streaming pump reports ssr-phase codes', async () => {
  // The front gate rejects non-object loader data (LOADER_NOT_OBJECT)…
  const loader = assertThrows(
    () => streamFields('nope', streamManifest()),
    OpenElementError,
    'stream loader must return one object',
  );
  assertEquals(loader.code, StreamErrorCode.LOADER_NOT_OBJECT);
  assertEquals(loader.phase, 'ssr');
  // …and the message text is unchanged — clients may match on it.
  assertEquals(loader.message, 'stream loader must return one object');

  // The deferred-shell gate fails closed on a route/manifest/program mismatch.
  const gate = createDeferredPageShell({
    streamManifests: {},
    createDeferredDsdExecutor: () => Promise.reject(new Error('unreached')),
  });
  const mismatch = await assertRejects(
    () => gate('/', { default: {} }, {}, 'i', 't'),
    OpenElementError,
    'no matching compiled route manifest/program',
  );
  assertEquals(mismatch.code, StreamErrorCode.ROUTE_PROGRAM_MISMATCH);
  assertEquals(mismatch.phase, 'ssr');
});

Deno.test('error codes: the dispatch guards and the renderer seam report ssr-phase codes', () => {
  const litStream = assertThrows(
    () =>
      assertLitStreamRoute(
        { default: { openElementPage: { renderIntent: { stream: {} } } } },
        '/',
        '/app/routes/streamed.tsx',
      ),
    OpenElementError,
    'Lit renderer does not support stream route',
  );
  assertEquals(litStream.code, DispatchErrorCode.LIT_STREAM_UNSUPPORTED);
  assertEquals(litStream.phase, 'ssr');

  const renderer = createNativePageRenderer({
    renderDsd: () => ({ html: '' }),
    customElements: { get: () => undefined },
    ssrRenderableTags: [],
  });
  const tagInvalid = assertThrows(
    () => renderer('nohyphen'),
    OpenElementError,
    'Invalid custom element tag',
  );
  assertEquals(tagInvalid.code, RendererErrorCode.TAG_INVALID);
  assertEquals(tagInvalid.phase, 'ssr');
  const tagUnregistered = assertThrows(
    () => renderer('oe-ghost'),
    OpenElementError,
    'is not registered in the SSR registry',
  );
  assertEquals(tagUnregistered.code, RendererErrorCode.TAG_UNREGISTERED);
  assertEquals(tagUnregistered.phase, 'ssr');
});

Deno.test('error codes: the mdx pipeline, the island scan, and the route scan report build-phase codes', async () => {
  const mdx = assertThrows(
    () => mdxToCompiledPageSource('import x from "y";\n', '/proj/app/routes/hero.mdx'),
    OpenElementError,
    'static Markdown subset',
  );
  assertEquals(mdx.code, MdxErrorCode.STATIC_CONTRACT);
  assertEquals(mdx.phase, 'build');

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
  const mediaWithoutDelivery = assertThrows(
    () => buildPackageIslandDecls([manifest('media') as never]),
    OpenElementError,
    'uses media delivery without media',
  );
  assertEquals(mediaWithoutDelivery.code, PackageIslandErrorCode.MEDIA_WITHOUT_DELIVERY);
  assertEquals(mediaWithoutDelivery.phase, 'build');
  const deliveryWithoutMedia = assertThrows(
    () => buildPackageIslandDecls([manifest('idle', '(max-width: 400px)') as never]),
    OpenElementError,
    'declares media without media delivery',
  );
  assertEquals(deliveryWithoutMedia.code, PackageIslandErrorCode.DELIVERY_WITHOUT_MEDIA);
  assertEquals(deliveryWithoutMedia.phase, 'build');

  const dir = await Deno.makeTempDir({ prefix: 'oe-error-codes-scan-' });
  try {
    const routesDir = join(dir, 'routes');
    await Deno.mkdir(routesDir, { recursive: true });
    // `a-b` and `a_b` fold to the same generated identifier (#1029).
    await Deno.writeTextFile(join(routesDir, 'a-b.tsx'), 'export default function Page() {}');
    await Deno.writeTextFile(join(routesDir, 'a_b.tsx'), 'export default function Page() {}');
    const collision = await assertRejects(
      () => scanRoutes(routesDir),
      OpenElementError,
      'Route variable name collision',
    );
    assertEquals(collision.code, RouteScanErrorCode.VAR_NAME_COLLISION);
    assertEquals(collision.phase, 'build');
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});

Deno.test('error codes: the dynamic prerender admission reports build-phase codes', () => {
  const missing = assertThrows(
    () => resolveDynamicRoutePath('/posts/:id', ['id'], {}),
    OpenElementError,
    'Missing value for route parameter',
  );
  assertEquals(missing.code, SsgDynamicErrorCode.PARAM_MISSING);
  assertEquals(missing.phase, 'build');
  const unsafe = assertThrows(
    () => resolveDynamicRoutePath('/posts/:id', ['id'], { id: '../escape' }),
    OpenElementError,
    'Unsafe value for route parameter',
  );
  assertEquals(unsafe.code, SsgDynamicErrorCode.PARAM_UNSAFE);
  assertEquals(unsafe.phase, 'build');
});
