/** @jsxImportSource @openelement/element */
import { element, OpenElement } from '@openelement/element';
import type { MastodonAccount, MastodonStatus } from '../app/types.ts';
import { getProfile, getProfileStatuses } from '../app/api-client.ts';
import { formatCount, stripHtml } from '../app/format.ts';
import StatusCard from '../components/StatusCard.tsx';

export interface ProfileData {
  account?: MastodonAccount;
  statuses: MastodonStatus[];
  error?: string;
}

export async function loader(ctx: { params?: Record<string, string> }): Promise<ProfileData> {
  const acct = ctx.params?.acct;
  if (!acct) return { statuses: [], error: 'Missing account handle' };

  const [accountResult, statusesResult] = await Promise.all([
    getProfile(acct),
    getProfileStatuses(acct),
  ]);

  if (!accountResult.ok) {
    return { statuses: [], error: accountResult.error.message };
  }

  return {
    account: accountResult.data,
    statuses: statusesResult.ok ? statusesResult.data : [],
  };
}

export const tagName = 'mastodon-profile';

@element('mastodon-profile', { root: 'shadow-open' })
export default class ProfilePage extends OpenElement {
  render() {
    const data = (this as unknown) as ProfilePage & ProfileData;
    const account = data.account;

    return (
      <main class='mastodon-main'>
        {data.error && (
          <div class='mastodon-card mastodon-error'>
            <p class='mastodon-card-title'>Error loading profile</p>
            <p class='mastodon-card-body'>{data.error}</p>
          </div>
        )}

        {!account && !data.error && (
          <div class='mastodon-empty'>
            <p class='mastodon-empty-title'>Account not found</p>
            <p class='mastodon-empty-hint'>Check the handle and try again.</p>
          </div>
        )}

        {account && (
          <>
            <header class='mastodon-profile-header'>
              <div
                class='mastodon-profile-header-bg'
                style={account.headerStatic || account.header
                  ? { backgroundImage: `url(${account.headerStatic || account.header})` }
                  : undefined}
              />
              <div class='mastodon-profile-identity'>
                <img
                  class='mastodon-profile-avatar'
                  src={account.avatarStatic || account.avatar}
                  alt={account.displayName}
                  width='80'
                  height='80'
                />
                <div class='mastodon-profile-names'>
                  <h1 class='mastodon-profile-displayname'>{account.displayName}</h1>
                  <p class='mastodon-profile-acct'>@{account.acct}</p>
                </div>
              </div>
              <div class='mastodon-profile-note'>{stripHtml(account.note)}</div>
              <div class='mastodon-profile-stats'>
                <span>
                  <strong>{formatCount(account.statusesCount)}</strong> posts
                </span>
                <span>
                  <strong>{formatCount(account.followingCount)}</strong> following
                </span>
                <span>
                  <strong>{formatCount(account.followersCount)}</strong> followers
                </span>
                <span>
                  <strong>{account.bot ? 'Yes' : 'No'}</strong> bot
                </span>
              </div>
            </header>

            <h2 class='mastodon-section-title'>
              Recent posts <span class='mastodon-count'>{data.statuses.length}</span>
            </h2>

            {data.statuses.length === 0 && (
              <div class='mastodon-empty compact'>
                <p class='mastodon-empty-title'>No posts yet</p>
              </div>
            )}

            <div class='mastodon-status-list' role='feed'>
              {data.statuses.map((status) => (
                <StatusCard key={status.id} status={status} reblog={!!status.reblog} compact />
              ))}
            </div>
          </>
        )}
      </main>
    );
  }
}
