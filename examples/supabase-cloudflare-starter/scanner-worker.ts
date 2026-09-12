import { ATTACHMENT_BUCKET } from './lib/cloudflare-queues.ts';
import { createMetaDefenderProvider, type MalwareScannerProvider } from './lib/malware-scanner.ts';
import { serviceRoleRpc, UUID_PATTERN } from './lib/service-role.ts';

interface ScannerEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  METADEFENDER_CORE_URL: string;
  METADEFENDER_API_KEY: string;
}

interface ScanRequest {
  type: 'attachment.scan';
  reservationId: string;
  objectKey: string;
}

interface AuthorizedAttachment {
  object_key: string;
  byte_size: number;
  content_type: string;
}

const MAX_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

function configuration(env: ScannerEnv): { supabase: URL } {
  const supabase = new URL(env.SUPABASE_URL);
  if (supabase.protocol !== 'https:' || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('scanner configuration unavailable');
  }
  return { supabase };
}

async function boundedBytes(response: Response, expected: number): Promise<Uint8Array> {
  if (!response.body || expected < 1 || expected > MAX_BYTES) {
    throw new Error('invalid object size');
  }
  const declared = Number(response.headers.get('content-length') ?? expected);
  if (!Number.isSafeInteger(declared) || declared !== expected || declared > MAX_BYTES) {
    throw new Error('object size mismatch');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > expected || total > MAX_BYTES) {
      await reader.cancel('attachment exceeds authorized size');
      throw new Error('object exceeds authorized size');
    }
    chunks.push(value);
  }
  if (total !== expected) throw new Error('object size mismatch');
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function storagePath(origin: URL, objectKey: string): string {
  const encoded = objectKey.split('/').map(encodeURIComponent).join('/');
  return new URL(`/storage/v1/object/authenticated/${ATTACHMENT_BUCKET}/${encoded}`, origin).href;
}

async function scanWithTimeout(
  provider: MalwareScannerProvider,
  input: Parameters<MalwareScannerProvider['scan']>[0],
  timeoutMs: number,
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const reason = new Error('scan provider timed out');
      controller.abort(reason);
      reject(reason);
    }, timeoutMs);
  });
  try {
    return await Promise.race([provider.scan(input, controller.signal), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function createScannerWorker(
  fetchImpl: typeof fetch = fetch,
  options: {
    timeoutMs?: number;
    provider?: MalwareScannerProvider;
    providerFactory?: (env: ScannerEnv) => MalwareScannerProvider;
  } = {},
) {
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  return {
    async fetch(request: Request, env: ScannerEnv): Promise<Response> {
      const correlationId = crypto.randomUUID();
      try {
        if (request.method !== 'POST' || new URL(request.url).pathname !== '/scan') {
          return new Response('Not Found', { status: 404 });
        }
        const config = configuration(env);
        const provider = options.provider ?? options.providerFactory?.(env) ??
          createMetaDefenderProvider(env, fetchImpl, timeoutMs);
        const body = await request.json() as Partial<ScanRequest>;
        if (
          body.type !== 'attachment.scan' || !UUID_PATTERN.test(body.reservationId ?? '') ||
          typeof body.objectKey !== 'string' || body.objectKey.length > 512
        ) return Response.json({ error: 'invalid scan request' }, { status: 400 });

        const attachment = await serviceRoleRpc<AuthorizedAttachment>(
          env,
          'authorize_attachment_scan',
          {
            target_reservation_id: body.reservationId,
            target_object_key: body.objectKey,
          },
          // Same per-request timeout the inline fetch had.
          (input, init) => fetchImpl(input, { ...init, signal: AbortSignal.timeout(timeoutMs) }),
        );
        if (attachment.object_key !== body.objectKey) {
          throw new Error('object substitution rejected');
        }

        const object = await fetchImpl(storagePath(config.supabase, attachment.object_key), {
          headers: {
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!object.ok) throw new Error(`object download failed (${object.status})`);
        const bytes = await boundedBytes(object, Number(attachment.byte_size));

        const verdict = await scanWithTimeout(provider, {
          bytes,
          contentType: attachment.content_type,
          filename: 'attachment',
        }, timeoutMs);
        if (verdict !== 'clean' && verdict !== 'quarantined') {
          throw new Error('provider returned an invalid verdict');
        }
        return Response.json({ verdict });
      } catch (error) {
        console.error(JSON.stringify({
          event: 'attachment_scan_failed',
          correlationId,
          reason: error instanceof Error ? error.message : 'unknown failure',
        }));
        return Response.json({ error: 'scan unavailable', correlationId }, { status: 503 });
      }
    },
  };
}

export default createScannerWorker();
