/** @jsxImportSource @openelement/element */
import { element, OpenElement } from '@openelement/element';
import type { MastodonStatus } from '../app/types.ts';
import { getTimeline } from '../app/api-client.ts';
import StatusCard, { StatusCardSkeleton } from '../components/StatusCard.tsx';

export interface TimelineData {
  statuses: MastodonStatus[];
  loading?: boolean;
  error?: string;
}

export async function loader(): Promise<TimelineData> {
  const result = await getTimeline({ limit: 20 });
  if (!result.ok) {
    return { statuses: [], error: result.error.message };
  }
  return { statuses: result.data };
}

export const tagName = 'mastodon-timeline';

@element('mastodon-timeline', { root: 'shadow-open' })
export default class TimelinePage extends OpenElement {
  render() {
    const data = (this as unknown) as TimelinePage & TimelineData;
    const statuses = data.statuses ?? [];

    return (
      <main class='mastodon-main'>
        <div class='mastodon-page-header'>
          <h1>Timeline</h1>
          <p>{statuses.length} statuses</p>
        </div>

        {data.error && (
          <div class='mastodon-card mastodon-error'>
            <p class='mastodon-card-title'>Error loading timeline</p>
            <p class='mastodon-card-body'>{data.error}</p>
          </div>
        )}

        {data.loading && statuses.length === 0 && (
          <>
            <StatusCardSkeleton />
            <StatusCardSkeleton />
            <StatusCardSkeleton />
          </>
        )}

        {statuses.length === 0 && !data.error && !data.loading && (
          <div class='mastodon-empty'>
            <p class='mastodon-empty-title'>Timeline is empty</p>
            <p class='mastodon-empty-hint'>
              Add fixtures to <code>fixtures/timeline.json</code> or switch to live mode with{' '}
              <code>MASTODON_LIVE=true</code>.
            </p>
          </div>
        )}

        <div class='mastodon-status-list' role='feed'>
          {statuses.map((status) => (
            <StatusCard key={status.id} status={status} reblog={!!status.reblog} />
          ))}
        </div>
      </main>
    );
  }
}
