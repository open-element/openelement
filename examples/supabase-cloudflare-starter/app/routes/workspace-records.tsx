/**
 * /workspace-records — request-time qualification-fixture route (thin
 * wrapper). The compiled page element lives in
 * app/components/page-workspace-records.tsx, the loader logic in
 * app/route-logic/workspace-records.ts.
 */
import { definePage } from '@openelement/app';
import WorkspaceRecordsPage from '../components/page-workspace-records.tsx';
import {
  createWorkspaceRecordsLoader,
  workspaceRecordsPageProps,
} from '../route-logic/workspace-records.ts';

export const loader = createWorkspaceRecordsLoader();

export default definePage(WorkspaceRecordsPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'Workspace records — qualification fixture' },
  props: workspaceRecordsPageProps,
});
