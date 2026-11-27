import {
  createOpenElementNitroHandler,
  type NitroRequestEvent,
} from '../../../../../packages/router/src/nitro-mount.ts';
// @ts-expect-error The Router build emits the Nitro entry as JavaScript without a declaration file.
import requestTimeServer from '../../../router-request-time/dist/server/index.js';

const transportProof = createOpenElementNitroHandler({
  handler: (request) => {
    if (new URL(request.url).pathname === '/stream') return streamTransportProof(request);
    return new Response('<main data-route="cached">Host-cached route</main>', {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'x-open-element-cache-intent': 'host-cache; max-age=60',
      },
    });
  },
});

function streamTransportProof(request: Request): Response {
  const encoder = new TextEncoder();
  let sentShell = false;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!sentShell && !request.signal.aborted) {
        controller.enqueue(
          encoder.encode('<main data-route="stream"><!--oe:p0--><!--oe:/p0--></main>'),
        );
        sentShell = true;
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (!request.signal.aborted) {
        controller.enqueue(
          encoder.encode(
            '<template data-oe-transport-proof>Loaded</template><noscript>Loaded</noscript>',
          ),
        );
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'private, no-cache',
      'set-cookie': 'stream-proof=1; HttpOnly; SameSite=Lax',
    },
  });
}

export default function openElementNitroProofRoute(event: NitroRequestEvent): Promise<Response> {
  const { pathname } = new URL(event.req.url);
  if (pathname === '/stream' || pathname === '/cached') return transportProof(event);
  // The proof injects a public sentinel with the Node event. Nitro supplies
  // Workers bindings on the request itself and the generated handler prefers them.
  return requestTimeServer({
    req: event.req,
    context: event.context,
    env: { REQUEST_TIME_PROOF_TOKEN: 'fixture-node-token' },
  });
}
