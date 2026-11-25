/** Request-time workspace records page with filtered keyset pagination. */
import { defineIslandConfig, definePage } from '@openelement/router';
import {
  createWorkspaceRecordsLoader,
  workspaceRecordsPageProps,
} from '../route-logic/workspace-records.ts';

export const openElement = defineIslandConfig({
  tag: 'workspace-records-page',
  root: 'shadow',
  properties: {
    recordRows: { attribute: false, default: [] },
    invalid: { default: 0 },
    errorText: { default: '' },
    nextCursor: { default: '' },
    noNextPage: { attribute: false, default: true },
    filterWorkspaceId: { default: '' },
    filterStatus: { default: '' },
    filterTitlePrefix: { default: '' },
  },
});

export function WorkspaceRecordsPage(props: {
  invalid: number;
  errorText: string;
  nextCursor: string;
  noNextPage: boolean;
  filterWorkspaceId: string;
  filterStatus: string;
  filterTitlePrefix: string;
  recordRows: Array<{ id: string; line: string }>;
}) {
  return (
    <main>
      <h1>Workspace records</h1>
      <p id='error'>{props.errorText}</p>
      <form method='get' action='/workspace-records' hidden={props.noNextPage}>
        <input type='hidden' name='workspace' value={props.filterWorkspaceId} />
        <input type='hidden' name='status' value={props.filterStatus} />
        <input type='hidden' name='q' value={props.filterTitlePrefix} />
        <input type='hidden' name='cursor' value={props.nextCursor} />
        <button id='next-page' type='submit' disabled={props.noNextPage}>
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
