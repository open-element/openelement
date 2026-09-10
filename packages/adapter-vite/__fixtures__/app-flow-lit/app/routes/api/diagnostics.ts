/**
 * /api/diagnostics — e2e observability: the action-invocation counter and
 * note count as JSON, so the enhanced-form test can prove action execution
 * without scraping page markup.
 */
import { actionInvocationCount, notesStore } from '../../store.ts';

export default function diagnostics(): Response {
  return Response.json({
    actionCount: actionInvocationCount(),
    noteCount: notesStore.count(),
  });
}
