/**
 * /workspace-records — request-time qualification-fixture route (thin
 * wrapper). The compiled page element lives in
 * app/components/page-workspace-records.tsx, the loader logic in
 * app/route-logic/workspace-records.ts.
 */
import { definePage } from '@openelement/router';
import { defineIslandConfig } from '@openelement/router';
import {
  createWorkspaceRecordsLoader,
  workspaceRecordsPageProps,
} from '../route-logic/workspace-records.ts';

/**
 * The page component is declared IN THIS MODULE (execution-plan §19.9): the
 * server function page lane records `pageComponentName` only for an exported
 * component function the route module declares itself, so an imported class
 * could not be admitted. Was `app/components/page-workspace-records.tsx`.
 */

export const openElement = defineIslandConfig({
  tag: 'workspace-records-page',
  root: 'shadow',
  properties: {
    invalid: { default: 0 },
    errorText: { default: '' },
    nextCursor: { default: '' },
    filterWorkspaceId: { default: '' },
    filterStatus: { default: '' },
    filterTitlePrefix: { default: '' },
  },
});

function WorkspaceRecordsPage(props: {
  invalid: number;
  errorText: string;
  nextCursor: string;
  filterWorkspaceId: string;
  filterStatus: string;
  filterTitlePrefix: string;
}) {
  return (
    <main>
      <h1>Workspace records</h1>
      <p id='error'>{props.errorText}</p>
      <form method='get' action='/workspace-records'>
        <input type='hidden' name='workspace' value={props.filterWorkspaceId} />
        <input type='hidden' name='status' value={props.filterStatus} />
        <input type='hidden' name='q' value={props.filterTitlePrefix} />
        <input type='hidden' name='cursor' value={props.nextCursor} />
        <button id='next-page' type='submit'>
          {'Next page'}
        </button>
      </form>
      {props.invalid > 0 ? <p id='invalid'>Valid workspace required.</p> : <span></span>}
      <ul id='workspace-records'>
        {props.recordRows.map((record) => (
          <li key={record.id}>{record.line}</li>
        ))}
      </ul>
    </main>
  );
}

export const loader = createWorkspaceRecordsLoader();

export default definePage(WorkspaceRecordsPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'Workspace records — qualification fixture' },
  props: workspaceRecordsPageProps,
});
