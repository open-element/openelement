import { createOpenElementNitroHandler } from '../../../../packages/router/src/nitro-mount.ts';

const openElementHandler = createOpenElementNitroHandler({
  env: { OPEN_ELEMENT_PROOF: 'nitro' },
  handler: (request, context) => {
    const url = new URL(request.url);
    const headers = new Headers({
      'x-open-element-env': context?.env?.OPEN_ELEMENT_PROOF ?? '',
      'x-open-element-runtime': 'nitro',
    });

    switch (url.pathname) {
      case '/':
      case '/static':
        return html(
          '<main data-route="static"><h1>Static route</h1><p>No client scripts.</p></main>',
          headers,
        );
      case '/load':
        return html(
          '<main data-route="load"><h1>Load route</h1><p data-load="nitro-data">Loaded from request context.</p></main>',
          headers,
        );
      case '/layout':
        return html(
          '<div data-layout="shell"><main data-route="layout"><h1>Layout route</h1></main></div>',
          headers,
        );
      case '/redirect':
        return new Response(null, {
          status: 302,
          headers: { ...Object.fromEntries(headers), location: '/static' },
        });
      case '/not-found':
        return html('<main data-route="not-found"><h1>Not found</h1></main>', headers, 404);
      case '/error':
        return html('<main data-route="error"><h1>Error boundary</h1></main>', headers, 500);
      case '/api/proof':
        return Response.json({
          ok: true,
          framework: 'openElement',
          runtime: 'nitro',
          path: url.pathname,
          env: context?.env?.OPEN_ELEMENT_PROOF,
        }, { headers });
      case '/island':
        return html(
          [
            '<main data-route="island">',
            '<h1>Explicit island</h1>',
            '<open-proof-island data-hydrate="visible"></open-proof-island>',
            '<script type="module" src="/open-element-island-visible.js"></script>',
            '</main>',
          ].join(''),
          headers,
        );
      case '/client-only':
        return html(
          [
            '<main data-route="client-only">',
            '<h1>Client-only island</h1>',
            '<open-proof-client-only data-hydrate="only"></open-proof-client-only>',
            '<script type="module" src="/open-element-client-only.js"></script>',
            '</main>',
          ].join(''),
          headers,
        );
      case '/cached':
        headers.set('cache-control', 's-maxage=60, stale-while-revalidate=300');
        headers.set('x-open-element-cache-intent', 'host-cache; max-age=60');
        return html('<main data-route="cached"><h1>Host-cached route</h1></main>', headers);
      default:
        return html(
          '<main data-route="fallback-not-found"><h1>Not found</h1></main>',
          headers,
          404,
        );
    }
  },
});

function html(body: string, headers: Headers, status = 200): Response {
  const nextHeaders = new Headers(headers);
  nextHeaders.set('content-type', 'text/html; charset=utf-8');
  return new Response(`<!doctype html><html><body>${body}</body></html>`, {
    status,
    headers: nextHeaders,
  });
}

// Nitro v3 (h3 v2) is fetch-native: the route event's `req` is already a
// standard Request, so the route is a pure pass-through to the mounted
// handler (#857). The per-request env arrives via the handler options above.
export default function openElementNitroProofRoute(event: {
  req: Request;
}): Promise<Response> {
  return openElementHandler(event);
}
