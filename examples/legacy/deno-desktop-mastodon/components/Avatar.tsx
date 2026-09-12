/** @jsxImportSource @openelement/element */
import type { MastodonAccount } from '../app/types.ts';

export interface AvatarProps {
  account: MastodonAccount;
  size?: number;
  onClick?: (e: Event) => void;
}

export default function Avatar({ account, size = 40, onClick }: AvatarProps) {
  const fallback = `https://ui-avatars.com/api/?name=${
    encodeURIComponent(account.username)
  }&background=6364ff&color=fff`;
  return (
    <img
      class='mastodon-avatar'
      src={account.avatarStatic || account.avatar || fallback}
      alt={account.displayName}
      width={size}
      height={size}
      loading='lazy'
      onError={(e: Event) => {
        const img = e.currentTarget as HTMLImageElement;
        // Already showing the fallback: stop here instead of retrying forever
        // (e.g. offline, where the fallback host is unreachable too).
        if (img.src === fallback) return;
        img.src = fallback;
      }}
      onClick={onClick}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        cursor: onClick ? 'pointer' : 'default',
      }}
    />
  );
}
