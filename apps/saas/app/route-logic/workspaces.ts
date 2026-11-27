import { ACTION_FETCH_HEADER } from '@openelement/element/authoring';
import {
  type ActionContext,
  fail,
  type LoaderContext,
  type PagePropsContext,
  redirect,
} from '@openelement/router';
import {
  WORKSPACE_INVITATION_CODE,
  WORKSPACE_INVITATION_HEADER,
} from '../components/workspace-invitation-shared.ts';
import { createServerSupabase } from '../../lib/supabase-server.ts';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

interface Membership {
  role: 'admin' | 'member';
  workspaces: { id: string; name: string };
}

interface WorkspacesData {
  memberships?: Membership[];
  error?: string;
}

type SessionContext = Pick<LoaderContext, 'env' | 'request' | 'responseHeaders'>;

async function authenticatedClient(ctx: SessionContext) {
  ctx.responseHeaders.set('cache-control', 'no-store');
  const client = createServerSupabase(ctx.env, ctx.request, ctx.responseHeaders);
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) throw redirect('/login');
  return { client, user };
}

export async function workspacesLoader(ctx: LoaderContext): Promise<WorkspacesData> {
  const { client, user } = await authenticatedClient(ctx);
  const { data, error } = await client
    .from('workspace_members')
    .select('role, workspaces!inner(id, name)')
    .eq('user_id', user.id)
    .order('workspace_id')
    .overrideTypes<Membership[], { merge: false }>();
  return error ? { error: 'Could not load workspaces.' } : { memberships: data ?? [] };
}

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

export async function createWorkspaceAction(ctx: ActionContext) {
  const { client } = await authenticatedClient(ctx);
  const name = field(ctx.formData, 'name');
  if (!name || Array.from(name).length > 120) {
    return fail(422, { error: 'Enter a workspace name of 1 to 120 characters.' });
  }
  const { data, error } = await client.rpc('create_workspace', { workspace_name: name });
  if (error || typeof data !== 'string' || !UUID.test(data)) {
    return fail(422, { error: 'Could not create the workspace.' });
  }
  throw redirect('/workspaces');
}

export async function joinWorkspaceAction(ctx: ActionContext) {
  const { client } = await authenticatedClient(ctx);
  const code = field(ctx.formData, 'code').toLowerCase();
  const invalidCode =
    'Code is invalid, expired, already used, or you already belong to this workspace.';
  if (!WORKSPACE_INVITATION_CODE.test(code)) return fail(422, { error: invalidCode });
  const { data, error } = await client.rpc('join_workspace', { invitation_code: code });
  if (error) return fail(422, { error: 'Could not join the workspace.' });
  if (typeof data !== 'string' || !UUID.test(data)) return fail(422, { error: invalidCode });
  throw redirect('/workspaces');
}

export async function inviteToWorkspaceAction(ctx: ActionContext) {
  const { client } = await authenticatedClient(ctx);
  // The router redirects successful native actions. Require the fetch channel
  // so the requesting UI can display the response header before any navigation.
  if (ctx.request.headers.get(ACTION_FETCH_HEADER) !== 'true') {
    return fail(400, { error: 'Enable JavaScript to generate an invitation code.' });
  }
  const workspaceId = field(ctx.formData, 'workspace');
  if (!UUID.test(workspaceId)) return fail(422, { error: 'Choose a workspace.' });
  const { data, error } = await client.rpc('issue_workspace_invitation', {
    target_workspace: workspaceId,
  });
  if (error?.code === '42501') {
    return fail(403, { error: 'Only workspace admins may generate invitation codes.' });
  }
  if (error || typeof data !== 'string' || !WORKSPACE_INVITATION_CODE.test(data)) {
    return fail(422, { error: 'Could not generate an invitation code.' });
  }
  ctx.responseHeaders.set(WORKSPACE_INVITATION_HEADER, data);
}

export function workspacesPageProps(context: PagePropsContext<WorkspacesData>) {
  const action = context.actionData as { error?: string } | undefined;
  const memberships = context.data?.memberships ?? [];
  const adminRows = memberships
    .filter(({ role }) => role === 'admin')
    .map(({ workspaces }) => workspaces);
  return {
    errorText: action?.error ?? context.data?.error ?? '',
    noAdminWorkspaces: adminRows.length === 0,
    membershipRows: memberships.map(({ role, workspaces }) => ({
      id: workspaces.id,
      label: `${workspaces.name} (${role})`,
      recordsHref: `/workspace-records?workspace=${workspaces.id}`,
    })),
    adminRows,
  };
}
