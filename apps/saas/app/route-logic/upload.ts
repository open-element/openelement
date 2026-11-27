import {
  type ActionContext,
  fail,
  type LoaderContext,
  type PagePropsContext,
  redirect,
} from '@openelement/router';
import {
  downloadAttachment,
  removeAttachment,
  uploadAttachment,
} from '../../lib/attachment-storage.ts';
import { serviceRoleRpc, UUID_PATTERN } from '../../lib/service-role.ts';
import { createServerSupabase } from '../../lib/supabase-server.ts';

export const MAX_FILE_BYTES = 1024 * 1024;
export const ALLOWED_CONTENT_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'text/plain',
]);

interface AttachmentRow {
  id: string;
  display_name: string;
  state: string;
}

interface UploadLoaderData {
  email?: string;
  files?: AttachmentRow[];
  error?: string;
}

type UploadClientFactory = typeof createServerSupabase;
const attachmentServices = {
  uploadAttachment,
  removeAttachment,
  downloadAttachment,
  serviceRoleRpc,
};

export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  return base.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128);
}

export function objectKeyFor(userId: string, filename: string): string {
  return `${userId}/${crypto.randomUUID()}-${sanitizeFilename(filename)}`;
}

export function createUploadLoader(createClient: UploadClientFactory = createServerSupabase) {
  return async function loader(ctx: LoaderContext): Promise<UploadLoaderData> {
    const supabase = createClient(ctx.env, ctx.request, ctx.responseHeaders);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw redirect('/login');
    const { data, error } = await supabase
      .from('attachment_reservations')
      .select('id, display_name, state')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100)
      .overrideTypes<AttachmentRow[], { merge: false }>();
    return error
      ? { email: user.email, error: 'Could not load attachments.' }
      : { email: user.email, files: data ?? [] };
  };
}

export function createUploadAction(
  createClient: UploadClientFactory = createServerSupabase,
  services = attachmentServices,
) {
  return async function upload(ctx: ActionContext) {
    const supabase = createClient(ctx.env, ctx.request, ctx.responseHeaders);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return fail(401, { error: 'Sign in to upload attachments.' });
    const file = ctx.formData.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return fail(422, { error: 'A non-empty file is required.' });
    }
    if (file.size > MAX_FILE_BYTES) {
      return fail(422, { error: 'The file exceeds the 1 MiB limit.' });
    }
    if (!ALLOWED_CONTENT_TYPES.has(file.type)) {
      return fail(422, { error: 'This file type is unavailable.' });
    }
    const name = sanitizeFilename(file.name) || 'upload.bin';
    const reservationId = crypto.randomUUID();
    const key = objectKeyFor(user.id, name);
    const reserved = await supabase.rpc('reserve_attachment', {
      reservation_id: reservationId,
      object_key: key,
      display_name: name,
      byte_size: file.size,
      content_type: file.type,
    });
    if (reserved.error) {
      return fail(422, {
        error:
          reserved.error.message === 'attachment quota exceeded'
            ? 'Attachment quota exceeded.'
            : 'Could not reserve space for the attachment.',
      });
    }
    try {
      await services.uploadAttachment(ctx.env, key, file);
      await services.serviceRoleRpc(ctx.env, 'finish_attachment_upload', {
        reservation_id: reservationId,
        target_owner: user.id,
        target_key: key,
      });
    } catch {
      try {
        // A provider response may be lost after committing. Keep the same
        // durable deletion state used by explicit deletes and the reconciler.
        await services.serviceRoleRpc(ctx.env, 'begin_attachment_delete', {
          reservation_id: reservationId,
          target_owner: user.id,
          upload_failed: true,
        });
      } catch {
        // Cron claims a reservation that remains reserved after the upload window.
      }
      return fail(422, { error: 'Could not complete the attachment upload. Cleanup is pending.' });
    }
    const queue = ctx.env.ATTACHMENT_SCAN_QUEUE as
      | { send(message: Record<string, string>): Promise<void> }
      | undefined;
    if (queue) {
      try {
        await queue.send({ type: 'attachment.scan', reservationId, objectKey: key });
      } catch {
        // Scheduled reconciliation re-enqueues the pending scan.
      }
    }
    throw redirect('/upload');
  };
}

export function createDeleteAction(
  createClient: UploadClientFactory = createServerSupabase,
  services = attachmentServices,
) {
  return async function remove(ctx: ActionContext) {
    const supabase = createClient(ctx.env, ctx.request, ctx.responseHeaders);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return fail(401, { error: 'Sign in to delete attachments.' });
    const id = ctx.formData.get('id');
    if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
      return fail(422, { error: 'Choose an attachment.' });
    }
    let key: string | null;
    try {
      key = await services.serviceRoleRpc<string | null>(ctx.env, 'begin_attachment_delete', {
        reservation_id: id,
        target_owner: user.id,
        upload_failed: false,
      });
    } catch {
      return fail(422, { error: 'Could not request attachment deletion.' });
    }
    if (!key) throw redirect('/upload');
    if (!key.startsWith(`${user.id}/`)) {
      return fail(422, { error: 'Could not request attachment deletion.' });
    }
    try {
      await services.removeAttachment(ctx.env, key);
      await services.serviceRoleRpc(ctx.env, 'complete_pending_attachment_delete', {
        reservation_id: id,
      });
    } catch {
      return fail(422, { error: 'Attachment deletion is pending and will be retried.' });
    }
    throw redirect('/upload');
  };
}

export function createAttachmentDownloadHandler(
  createClient: UploadClientFactory = createServerSupabase,
  services = attachmentServices,
) {
  return async function download({
    request,
    env,
  }: {
    request: Request;
    env: Record<string, unknown>;
  }) {
    const headers = new Headers({ 'cache-control': 'private, no-store' });
    const unavailable = () => new Response('Attachment unavailable.', { status: 404, headers });
    if (request.method !== 'GET') {
      headers.set('allow', 'GET');
      return new Response(null, { status: 405, headers });
    }
    const id = new URL(request.url).searchParams.get('id');
    if (!id || !UUID_PATTERN.test(id)) return unavailable();
    const supabase = createClient(env, request, headers);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return unavailable();
    const { data: row, error } = await supabase
      .from('attachment_reservations')
      .select('object_key, display_name')
      .eq('id', id)
      .eq('user_id', user.id)
      .eq('state', 'clean')
      .maybeSingle<{ object_key: string; display_name: string }>();
    if (error || !row || !row.object_key.startsWith(`${user.id}/`)) return unavailable();
    try {
      const response = await services.downloadAttachment(env, row.object_key);
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        return unavailable();
      }
      const name = sanitizeFilename(row.display_name) || 'attachment';
      headers.set('content-type', 'application/octet-stream');
      headers.set('content-disposition', `attachment; filename="${name}"`);
      headers.set('x-content-type-options', 'nosniff');
      return new Response(response.body, { headers });
    } catch {
      return unavailable();
    }
  };
}

export function uploadPageProps(context: PagePropsContext<UploadLoaderData>) {
  const data = context.data;
  const action = context.actionData as { error?: string } | undefined;
  return {
    whoText: data?.email ? `signed-in:${data.email}` : '',
    errorText: data?.error ?? '',
    actionErrorText: action?.error ?? '',
    fileRows: (data?.files ?? []).map((file) => ({
      id: file.id,
      line: file.display_name,
      downloadHref: `/api/attachment-download?id=${file.id}`,
      hideDownload: file.state !== 'clean',
      state: file.state.replaceAll('_', ' '),
      noDelete: file.state === 'reserved' || file.state === 'deleting',
    })),
  };
}
