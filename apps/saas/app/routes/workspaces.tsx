import { definePage } from '@openelement/router';
import {
  createWorkspaceAction,
  inviteToWorkspaceAction,
  joinWorkspaceAction,
  workspacesLoader,
  workspacesPageProps,
} from '../route-logic/workspaces.ts';

export const loader = workspacesLoader;
export const actions = {
  create: createWorkspaceAction,
  invite: inviteToWorkspaceAction,
  join: joinWorkspaceAction,
};

export function WorkspacesPage(props: {
  errorText: string;
  noAdminWorkspaces: boolean;
  membershipRows: Array<{ id: string; label: string; recordsHref: string }>;
  adminRows: Array<{ id: string; name: string }>;
}) {
  return (
    <main>
      <h1>Workspaces</h1>
      <p role='alert'>{props.errorText}</p>
      <h2>Create a workspace</h2>
      <form method='post' action='/workspaces?/create'>
        <label>
          Workspace name <input name='name' maxlength={120} required />
        </label>
        <button type='submit'>Create workspace</button>
      </form>
      <h2>Join a workspace</h2>
      <form method='post' action='/workspaces?/join' autocomplete='off'>
        <label>
          Invitation code <input name='code' maxlength={32} required />
        </label>
        <button type='submit'>Join workspace</button>
      </form>
      <h2>Your workspaces</h2>
      <ul>
        {props.membershipRows.map((workspace) => (
          <li key={workspace.id}>
            <a href={workspace.recordsHref}>{workspace.label}</a>
          </li>
        ))}
      </ul>
      <section aria-labelledby='workspace-invitations-heading' hidden={props.noAdminWorkspaces}>
        <h2 id='workspace-invitations-heading'>Workspace invitations</h2>
        <noscript>Enable JavaScript to generate invitation codes.</noscript>
        <ul>
          {props.adminRows.map((workspace) => (
            <li key={workspace.id}>
              {workspace.name}
              <workspace-invitation workspaceid={workspace.id}></workspace-invitation>
            </li>
          ))}
        </ul>
      </section>
      <p>
        <a href='/notes'>Notes</a>
      </p>
    </main>
  );
}

export default definePage(WorkspacesPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'Workspaces — reference starter' },
  props: workspacesPageProps,
});
