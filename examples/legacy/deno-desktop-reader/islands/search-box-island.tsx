import { h } from 'preact';
import { useState } from 'preact/hooks';
import { definePreactIsland } from '@openelement/app/preact';

interface SearchBoxProps {
  query?: string;
}

function SearchBoxIsland(props: SearchBoxProps) {
  const [query, setQuery] = useState(props.query ?? '');
  return h(
    'form',
    {
      onSubmit: (event: Event) => {
        event.preventDefault();
        const trimmed = query.trim();
        if (!trimmed) return;
        globalThis.dispatchEvent(
          new CustomEvent('reader-navigate', {
            detail: { path: `/search?q=${encodeURIComponent(trimmed)}` },
          }),
        );
      },
    },
    [
      h(
        'style',
        null,
        `
          form {
            display: flex;
            gap: 10px;
            margin: 0;
          }
          input {
            background: var(--bg-card, #fff);
            border: 1px solid var(--border, #ececea);
            border-radius: 999px;
            color: var(--text-primary, #1a1a1a);
            flex: 1;
            font: 15px/1.4 var(--font-sans, system-ui);
            min-width: 0;
            padding: 14px 18px;
            transition: border-color .12s ease, box-shadow .12s ease;
          }
          input:focus {
            border-color: var(--brand, #07c160);
            box-shadow: 0 0 0 3px var(--brand-ring, rgba(7, 193, 96, .18));
            outline: none;
          }
          input::placeholder { color: var(--text-faint, #b0b0ac); }
          button {
            background: var(--brand, #07c160);
            border: 1px solid var(--brand, #07c160);
            border-radius: 999px;
            color: var(--text-on-brand, #fff);
            cursor: pointer;
            font: 600 14px/1 var(--font-sans, system-ui);
            padding: 12px 24px;
            white-space: nowrap;
          }
          button:hover {
            background: var(--brand-hover, #06ad56);
            border-color: var(--brand-hover, #06ad56);
          }
        `,
      ),
      h('input', {
        'aria-label': '搜索',
        value: query,
        placeholder: '输入关键词，按回车搜索',
        onInput: (event: Event) => setQuery((event.currentTarget as HTMLInputElement).value),
      }),
      h('button', { type: 'submit' }, '搜索'),
    ],
  );
}

definePreactIsland('search-box-island', SearchBoxIsland, { ssr: false });
