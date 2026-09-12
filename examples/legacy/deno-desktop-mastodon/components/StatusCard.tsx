/** @jsxImportSource @openelement/element */
import type { MastodonStatus } from '../app/types.ts';
import { formatCount, stripHtml } from '../app/format.ts';
import { navigate } from '../router.ts';
import Avatar from './Avatar.tsx';
import RelativeTime from './RelativeTime.tsx';

export interface StatusCardProps {
  key?: string;
  status: MastodonStatus;
  reblog?: boolean;
  compact?: boolean;
}

function StatusBody({ status, compact }: { status: MastodonStatus; compact?: boolean }) {
  const effective = status.reblog ?? status;
  return (
    <article
      class={`mastodon-status ${compact ? 'compact' : ''}`}
      data-status-id={status.id}
    >
      <header class='mastodon-status-header'>
        <Avatar
          account={effective.account}
          size={compact ? 32 : 44}
          onClick={(e: Event) => {
            e.stopPropagation();
            navigate(`/profile/${encodeURIComponent(effective.account.acct)}`);
          }}
        />
        <div class='mastodon-status-meta'>
          <button
            type='button'
            class='mastodon-status-displayname'
            onClick={(e: Event) => {
              e.stopPropagation();
              navigate(`/profile/${encodeURIComponent(effective.account.acct)}`);
            }}
          >
            {effective.account.displayName}
          </button>
          <span class='mastodon-status-acct'>@{effective.account.acct}</span>
          <span class='mastodon-status-dot'>·</span>
          <button
            type='button'
            class='mastodon-status-timestamp'
            onClick={(e: Event) => {
              e.stopPropagation();
              navigate(`/status/${encodeURIComponent(status.id)}`);
            }}
          >
            <RelativeTime iso={effective.createdAt} />
          </button>
        </div>
      </header>

      <div class='mastodon-status-content'>{stripHtml(effective.content)}</div>

      {effective.mediaAttachments.length > 0 && (
        <div class='mastodon-status-media'>
          {effective.mediaAttachments.map((media) => (
            <a
              key={media.id}
              href={media.url}
              target='_blank'
              rel='noopener noreferrer'
              class='mastodon-media-thumb'
              onClick={(e: Event) => e.stopPropagation()}
            >
              <img
                src={media.previewUrl || media.url}
                alt={media.description || ''}
                loading='lazy'
              />
            </a>
          ))}
        </div>
      )}

      {effective.tags.length > 0 && (
        <div class='mastodon-status-tags'>
          {effective.tags.map((tag) => (
            <a
              key={tag.name}
              href={tag.url}
              target='_blank'
              rel='noopener noreferrer'
              class='mastodon-tag'
              onClick={(e: Event) => e.stopPropagation()}
            >
              #{tag.name}
            </a>
          ))}
        </div>
      )}

      {!compact && (
        <footer class='mastodon-status-actions'>
          <span class='mastodon-action' title='Replies'>
            <svg
              width='18'
              height='18'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <path d='M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' />
            </svg>
            {formatCount(effective.replyCount)}
          </span>
          <span class='mastodon-action' title='Boosts'>
            <svg
              width='18'
              height='18'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <polyline points='17 1 21 5 17 9' />
              <path d='M3 11V9a4 4 0 0 1 4-4h14' />
              <polyline points='7 23 3 19 7 15' />
              <path d='M21 13v2a4 4 0 0 1-4 4H3' />
            </svg>
            {formatCount(effective.reblogsCount)}
          </span>
          <span class='mastodon-action' title='Favourites'>
            <svg
              width='18'
              height='18'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <path d='M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z' />
            </svg>
            {formatCount(effective.favouritesCount)}
          </span>
        </footer>
      )}
    </article>
  );
}

export default function StatusCard({ status, reblog = false, compact = false }: StatusCardProps) {
  const inner = <StatusBody status={status} compact={compact} />;
  const effective = status.reblog ?? status;

  return (
    <div
      class='mastodon-status-card'
      role={reblog ? 'listitem' : 'article'}
      onClick={() => navigate(`/status/${encodeURIComponent(status.id)}`)}
    >
      {status.reblog && (
        <div class='mastodon-reblog-header'>
          <svg
            width='14'
            height='14'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='2'
          >
            <polyline points='17 1 21 5 17 9' />
            <path d='M3 11V9a4 4 0 0 1 4-4h14' />
            <polyline points='7 23 3 19 7 15' />
            <path d='M21 13v2a4 4 0 0 1-4 4H3' />
          </svg>
          <span>Boosted by {status.account.displayName}</span>
        </div>
      )}
      {inner}
      {reblog && (
        <a
          href={effective.url}
          target='_blank'
          rel='noopener noreferrer'
          class='mastodon-status-link'
          onClick={(e: Event) => e.stopPropagation()}
        >
          Open original
        </a>
      )}
    </div>
  );
}

export function StatusCardSkeleton() {
  return (
    <div class='mastodon-status-card skeleton'>
      <div class='mastodon-status-header'>
        <div class='mastodon-skeleton-avatar' />
        <div class='mastodon-status-meta'>
          <div class='mastodon-skeleton-line short' />
          <div class='mastodon-skeleton-line' />
        </div>
      </div>
      <div class='mastodon-skeleton-line' />
      <div class='mastodon-skeleton-line' />
      <div class='mastodon-skeleton-line short' />
    </div>
  );
}
