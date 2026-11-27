import { defineIslandConfig } from '@openelement/router';
import { requestInvitation } from '../components/workspace-invitation-shared.ts';

export const openElement = defineIslandConfig({
  root: 'shadow',
  hydrate: 'load',
  properties: {
    workspaceid: { default: '' },
  },
});

function WorkspaceInvitation(props: { workspaceid: string }) {
  return (
    <div>
      <button
        type='button'
        data-workspace-id={props.workspaceid}
        onClick={(event: Event) => {
          void requestInvitation(event);
        }}
      >
        {'Generate invitation code'}
      </button>
      <output></output>
    </div>
  );
}

export default WorkspaceInvitation;
