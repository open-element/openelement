/** @jsxImportSource @openelement/element */
import { absoluteTime, relativeTime } from '../app/format.ts';

export interface RelativeTimeProps {
  iso: string;
}

export default function RelativeTime({ iso }: RelativeTimeProps) {
  return (
    <time
      class='mastodon-relative-time'
      dateTime={iso}
      title={absoluteTime(iso)}
    >
      {relativeTime(iso)}
    </time>
  );
}
