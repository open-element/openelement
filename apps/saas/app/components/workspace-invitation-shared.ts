import { ACTION_FETCH_HEADER } from '@openelement/element/authoring';

export const WORKSPACE_INVITATION_HEADER = 'x-workspace-invitation';
export const WORKSPACE_INVITATION_CODE = /^[0-9a-f]{32}$/;

export async function requestInvitation(event: Event) {
  const button = event.currentTarget as HTMLButtonElement;
  const workspaceId = button.dataset.workspaceId;
  if (!workspaceId) return;
  const output = (button.getRootNode() as ShadowRoot).querySelector('output');
  if (!output) return;
  button.disabled = true;
  output.textContent = '';
  try {
    const response = await fetch('/workspaces?/invite', {
      method: 'POST',
      headers: { [ACTION_FETCH_HEADER]: 'true' },
      body: new URLSearchParams({ workspace: workspaceId }),
      credentials: 'same-origin',
      redirect: 'error',
      cache: 'no-store',
    });
    const result = await response.json();
    const code = response.headers.get(WORKSPACE_INVITATION_HEADER);
    output.textContent =
      response.ok && result?.type === 'redirect' && code && WORKSPACE_INVITATION_CODE.test(code)
        ? `Invitation code: ${code}. It expires in 24 hours and can be used once.`
        : 'Could not generate an invitation code. Check your session and workspace role.';
  } catch {
    output.textContent = 'Could not generate an invitation code. Try again.';
  } finally {
    button.disabled = false;
  }
}
