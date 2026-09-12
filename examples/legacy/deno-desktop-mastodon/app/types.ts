/**
 * Mastodon Desktop — domain types.
 *
 * These types are intentionally shallow: the dogfood only needs the public
 * read-only surface of a Mastodon instance. OAuth, notifications, DMs and
 * mutations are out of scope for alpha.7.
 */

export interface MastodonAccount {
  id: string;
  username: string;
  acct: string;
  displayName: string;
  avatar: string;
  avatarStatic: string;
  header: string;
  headerStatic: string;
  note: string;
  createdAt: string;
  followersCount: number;
  followingCount: number;
  statusesCount: number;
  locked: boolean;
  bot: boolean;
  discoverable?: boolean;
  moved?: MastodonAccount;
}

export interface MastodonStatus {
  id: string;
  uri: string;
  url?: string;
  account: MastodonAccount;
  content: string;
  createdAt: string;
  editedAt?: string;
  reblog?: MastodonStatus;
  replyCount: number;
  reblogsCount: number;
  favouritesCount: number;
  bookmarked: boolean;
  favourited: boolean;
  reblogged: boolean;
  muted: boolean;
  sensitive: boolean;
  spoilerText: string;
  visibility: 'public' | 'unlisted' | 'private' | 'direct';
  mediaAttachments: MastodonMedia[];
  mentions: MastodonMention[];
  tags: MastodonTag[];
  emojis: MastodonEmoji[];
  card?: MastodonPreviewCard;
  inReplyToId?: string;
  inReplyToAccountId?: string;
  language?: string;
  pinned?: boolean;
}

export interface MastodonMedia {
  id: string;
  type: 'image' | 'video' | 'gifv' | 'audio' | 'unknown';
  url: string;
  previewUrl: string;
  remoteUrl?: string;
  previewRemoteUrl?: string;
  textUrl?: string;
  meta?: Record<string, unknown>;
  description?: string;
  blurhash?: string;
}

export interface MastodonMention {
  id: string;
  username: string;
  url: string;
  acct: string;
}

export interface MastodonTag {
  name: string;
  url: string;
}

export interface MastodonEmoji {
  shortcode: string;
  url: string;
  staticUrl: string;
  visibleInPicker: boolean;
}

export interface MastodonPreviewCard {
  url: string;
  title: string;
  description: string;
  type: 'link' | 'photo' | 'video' | 'rich';
  authorName?: string;
  authorUrl?: string;
  providerName?: string;
  providerUrl?: string;
  html?: string;
  width?: number;
  height?: number;
  image?: string;
  embedUrl?: string;
  blurhash?: string;
}

export interface TimelineRequest {
  instance: string;
  timeline: 'public' | 'local';
  maxId?: string;
  sinceId?: string;
  limit?: number;
}

export interface ProfileRequest {
  instance: string;
  acct: string;
}

export interface StatusRequest {
  instance: string;
  id: string;
}

export interface ApiError {
  type: 'network' | 'http' | 'parse' | 'configuration';
  status?: number;
  message: string;
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

export interface AppSettings {
  instanceUrl: string;
  theme: 'light' | 'dark' | 'system';
  timelineDensity: 'compact' | 'comfortable';
}
