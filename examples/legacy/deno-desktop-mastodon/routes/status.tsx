/** @jsxImportSource @openelement/element */
import { element, OpenElement } from '@openelement/element';
import type { MastodonStatus } from '../app/types.ts';
import { getStatus, getStatusContext } from '../app/api-client.ts';
import StatusCard from '../components/StatusCard.tsx';

export interface StatusData {
  status?: MastodonStatus;
  ancestors: MastodonStatus[];
  descendants: MastodonStatus[];
  error?: string;
}

export async function loader(ctx: { params?: Record<string, string> }): Promise<StatusData> {
  const id = ctx.params?.id;
  if (!id) return { ancestors: [], descendants: [], error: 'Missing status id' };

  const [statusResult, contextResult] = await Promise.all([
    getStatus(id),
    getStatusContext(id),
  ]);

  if (!statusResult.ok) {
    return {
      ancestors: [],
      descendants: [],
      error: statusResult.error.message,
    };
  }

  return {
    status: statusResult.data,
    ancestors: contextResult.ok ? contextResult.data.ancestors : [],
    descendants: contextResult.ok ? contextResult.data.descendants : [],
  };
}

export const tagName = 'mastodon-status-detail';

@element('mastodon-status-detail', { root: 'shadow-open' })
export default class StatusPage extends OpenElement {
  render() {
    const data = (this as unknown) as StatusPage & StatusData;
    const status = data.status;

    return (
      <main class='mastodon-main'>
        <div class='mastodon-page-header'>
          <h1>Status</h1>
        </div>

        {data.error && (
          <div class='mastodon-card mastodon-error'>
            <p class='mastodon-card-title'>Error loading status</p>
            <p class='mastodon-card-body'>{data.error}</p>
          </div>
        )}

        {!status && !data.error && (
          <div class='mastodon-empty'>
            <p class='mastodon-empty-title'>Status not found</p>
          </div>
        )}

        {data.ancestors.length > 0 && (
          <section class='mastodon-conversation' aria-label='Ancestors'>
            {data.ancestors.map((s) => <StatusCard key={s.id} status={s} compact />)}
          </section>
        )}

        {status && (
          <section class='mastodon-conversation' aria-label='Focused status'>
            <StatusCard status={status} />
          </section>
        )}

        {data.descendants.length > 0 && (
          <section class='mastodon-conversation' aria-label='Replies'>
            <h2 class='mastodon-section-title'>
              Replies <span class='mastodon-count'>{data.descendants.length}</span>
            </h2>
            {data.descendants.map((s) => <StatusCard key={s.id} status={s} compact />)}
          </section>
        )}
      </main>
    );
  }
}
