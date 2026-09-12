import { h } from 'preact';
import { useState } from 'preact/hooks';
import { definePreactIsland } from '@openelement/app/preact';

interface SyncStatusProps {
  'source-id'?: string;
}

function SyncStatusIsland(props: SyncStatusProps) {
  const [state, setState] = useState<'idle' | 'syncing' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const sourceId = props['source-id'] ?? 'fixtures';

  return h('span', { class: 'sync-island' }, [
    h(
      'style',
      null,
      `
        .sync-btn {
          background: var(--bg-inset, #fafaf8);
          border: 1px solid var(--border, #ececea);
          border-radius: var(--radius-md, 8px);
          color: var(--text-secondary, #4a4a48);
          cursor: pointer;
          font-family: inherit;
          font-size: 12px;
          font-weight: 500;
          padding: 6px 12px;
          transition: border-color 0.12s ease, color 0.12s ease, background 0.12s ease;
        }
        .sync-btn:hover:not(:disabled) {
          border-color: var(--brand, #07c160);
          color: var(--brand, #07c160);
        }
        .sync-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .sync-msg {
          color: var(--text-muted, #888884);
          font-size: 12px;
          margin-left: 8px;
        }
        .sync-msg.error { color: var(--error-fg, #c8392a); }
        .sync-msg.success { color: var(--success-fg, #04984c); }
      `,
    ),
    h(
      'button',
      {
        class: 'sync-btn',
        type: 'button',
        disabled: state === 'syncing',
        onClick: async () => {
          setState('syncing');
          setMessage('同步中……');
          try {
            const res = await fetch(
              `/api/sources/${encodeURIComponent(sourceId)}/sync`,
              { method: 'POST' },
            );
            if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
            setState('done');
            setMessage('已同步，刷新中');
            setTimeout(() => location.reload(), 400);
          } catch (err) {
            setState('error');
            setMessage(err instanceof Error ? err.message : String(err));
          }
        },
      },
      state === 'syncing' ? '同步中' : '同步',
    ),
    h(
      'span',
      { class: `sync-msg ${state === 'error' ? 'error' : state === 'done' ? 'success' : ''}` },
      message,
    ),
  ]);
}

definePreactIsland('sync-status-island', SyncStatusIsland, { ssr: false });
