/**
 * /upload route logic (v0.44) — Supabase Storage upload with authorization
 * (reference starter, #983). Plain module so Deno tests never evaluate the
 * compiled page class.
 *
 * A no-JS-capable multipart form posts to the named action `upload`. The
 * action reads the session from the request cookies (same @supabase/ssr
 * channel as /notes) and uploads into the private `notes-attachments`
 * bucket under the owner's folder ("<auth.uid()>/<filename>"), so the
 * storage RLS policies (supabase/migrations/20260816000001) scope every
 * object to its owner. Anonymous posts get a 401; anonymous GETs redirect to
 * /login (0.43 rendered a denied branch — see route-logic/notes.ts for why).
 */
import {
  type ActionContext,
  fail,
  type LoaderContext,
  type OpenElementActionFailure,
  type PagePropsContext,
  redirect,
} from '@openelement/app';
import { createServerSupabase } from '../../lib/supabase-server.ts';
import { ATTACHMENT_BUCKET } from '../../lib/cloudflare-queues.ts';

export const BUCKET = ATTACHMENT_BUCKET;
/** Reference cap (1 MiB) — a starter guardrail, not a Supabase limit. */
export const MAX_FILE_BYTES = 1024 * 1024;
export const ALLOWED_CONTENT_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'text/plain',
]);

export interface UploadLoaderData {
  denied: boolean;
  email?: string;
  files?: { name: string; key: string; downloadUrl: string }[];
  error?: string;
}

export interface UploadActionData {
  error?: string;
}

/** Minimal structural surface the route needs from the Supabase client. */
export interface UploadSupabaseClient {
  auth: {
    getUser(): Promise<
      { data: { user: { id: string; email?: string } | null } }
    >;
  };
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        file: File,
        options?: { contentType?: string; upsert?: boolean },
      ): Promise<{ error: { message: string } | null }>;
      createSignedUrl(
        path: string,
        expiresIn: number,
      ): Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>;
      remove(paths: string[]): Promise<{ error: { message: string } | null }>;
    };
  };
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data?: unknown; error: { message: string } | null }>;
}

export type UploadClientFactory = (
  env: Record<string, unknown>,
  request: Request,
  responseHeaders: Headers,
) => UploadSupabaseClient;

/** Basename-only, storage-safe file name segment (no path traversal). */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  return base.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128);
}

/** Objects live under the owner's folder so storage RLS can scope by prefix. */
export function objectKeyFor(userId: string, filename: string): string {
  return `${userId}/${crypto.randomUUID()}-${sanitizeFilename(filename)}`;
}

export function ownsObjectKey(userId: string, key: string): boolean {
  return key.startsWith(`${userId}/`) && !key.slice(userId.length + 1).includes('/');
}

export function createUploadLoader(
  createClient: UploadClientFactory = createServerSupabase,
) {
  return async function loader(
    ctx: LoaderContext<Record<string, unknown>>,
  ): Promise<UploadLoaderData> {
    const supabase = createClient(ctx.env, ctx.request, ctx.responseHeaders);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw redirect('/login');
    const { data, error } = await supabase.rpc('list_downloadable_attachments', {});
    if (error) {
      return { denied: false, email: user.email, error: error.message };
    }
    const rows = (data ?? []) as { object_key: string; display_name: string }[];
    const files = await Promise.all(rows.map(async (file) => {
      const signed = await supabase.storage.from(BUCKET).createSignedUrl(file.object_key, 60);
      return {
        key: file.object_key,
        name: file.display_name,
        downloadUrl: signed.error ? '' : signed.data?.signedUrl ?? '',
      };
    }));
    return {
      denied: false,
      email: user.email,
      files,
    };
  };
}

export function createUploadAction(
  createClient: UploadClientFactory = createServerSupabase,
) {
  return async function upload(
    ctx: ActionContext<Record<string, unknown>>,
  ): Promise<OpenElementActionFailure<UploadActionData>> {
    const supabase = createClient(ctx.env, ctx.request, ctx.responseHeaders);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return fail(401, { error: 'sign-in required to upload' });
    const file = ctx.formData.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return fail(422, { error: 'a non-empty file is required' });
    }
    if (file.size > MAX_FILE_BYTES) {
      return fail(422, { error: 'file exceeds the 1 MiB reference cap' });
    }
    if (!ALLOWED_CONTENT_TYPES.has(file.type)) {
      return fail(422, { error: 'file type is not allowed' });
    }
    const displayName = sanitizeFilename(file.name || 'upload.bin');
    const reservationId = crypto.randomUUID();
    const key = objectKeyFor(user.id, displayName);
    const reserved = await supabase.rpc('reserve_attachment', {
      reservation_id: reservationId,
      object_key: key,
      display_name: displayName,
      byte_size: file.size,
      content_type: file.type || 'application/octet-stream',
    });
    if (reserved.error) return fail(422, { error: reserved.error.message });
    // Never silently overwrite: different originals can normalize to the same
    // key, and upsert:true would lose the earlier file without a trace.
    const { error } = await supabase.storage.from(BUCKET).upload(key, file, {
      contentType: file.type || undefined,
      upsert: false,
    });
    if (error) {
      await supabase.rpc('release_attachment', { reservation_id: reservationId });
      return fail(422, { error: error.message });
    }
    const finalized = await supabase.rpc('finalize_attachment', {
      reservation_id: reservationId,
    });
    if (finalized.error) {
      // Finalization may have committed even when its response was lost. Move
      // the matching row (reserved or pending_scan) into the existing durable
      // deletion state before touching Storage. The scheduled reconciler can
      // finish either a failed Storage remove or a failed row completion.
      const requested = await supabase.rpc('request_attachment_delete', { target_key: key });
      if (requested.error) {
        throw new Error('upload finalization is uncertain; cleanup is pending');
      }
      const removed = await supabase.storage.from(BUCKET).remove([key]);
      if (removed.error) {
        throw new Error('upload finalization failed; object deletion is queued for retry');
      }
      const completed = await supabase.rpc('complete_attachment_delete', { target_key: key });
      if (completed.error) {
        throw new Error('object deleted; upload quota reconciliation is pending');
      }
      throw new Error('upload could not be finalized');
    }
    const queue = ctx.env.ATTACHMENT_SCAN_QUEUE as
      | { send(message: Record<string, string>): Promise<void> }
      | undefined;
    if (queue) {
      try {
        await queue.send({ type: 'attachment.scan', reservationId, objectKey: key });
      } catch {
        // The row stays pending_scan; scheduled reconciliation re-enqueues it.
      }
    }
    throw redirect('/upload');
  };
}

export function createDeleteAction(
  createClient: UploadClientFactory = createServerSupabase,
) {
  return async function remove(
    ctx: ActionContext<Record<string, unknown>>,
  ): Promise<OpenElementActionFailure<UploadActionData>> {
    const supabase = createClient(ctx.env, ctx.request, ctx.responseHeaders);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return fail(401, { error: 'sign-in required to delete' });
    const key = String(ctx.formData.get('key') ?? '');
    if (!ownsObjectKey(user.id, key)) return fail(403, { error: 'invalid object owner' });
    const requested = await supabase.rpc('request_attachment_delete', { target_key: key });
    if (requested.error) return fail(422, { error: requested.error.message });
    const removed = await supabase.storage.from(BUCKET).remove([key]);
    if (removed.error) {
      return fail(422, { error: `${removed.error.message}; deletion queued for retry` });
    }
    const completed = await supabase.rpc('complete_attachment_delete', { target_key: key });
    if (completed.error) throw new Error('object deleted; quota reconciliation is pending');
    throw redirect('/upload');
  };
}

/**
 * Request scope → compiled page properties (app/components/page-upload.tsx).
 * Grammar v1 list Regions carry one value slot per item and no per-item
 * attributes, so per-row download links and per-row delete forms are outside
 * v1: each row renders its display line (name + object key) and deletion
 * moves to the section-level form posting the object key.
 */
export function uploadPageProps(
  context: PagePropsContext<UploadLoaderData>,
): Record<string, unknown> {
  const data = context.data;
  const actionData = context.actionData as UploadActionData | undefined;
  return {
    whoText: data?.email ? `signed-in:${data.email}` : '',
    errorText: data?.error ?? '',
    actionErrorText: actionData?.error ?? '',
    fileRows: (data?.files ?? []).map((file) => ({
      id: file.key,
      line: `${file.name} (${file.key})`,
    })),
  };
}
