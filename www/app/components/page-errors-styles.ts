import { compiledStyle } from '../site-ui/compiled-style.ts';

export const pageErrorsStyles = [compiledStyle(`
  :host { display: block; color: var(--text-primary); }
  * { box-sizing: border-box; }
  p { margin: 0; }

  /* code table: mono identifiers, hairline rows */
  .codes { border-block-start: var(--border-size-1) solid var(--border); }
  .codes-head, .code-row {
    display: grid;
    grid-template-columns: minmax(0, .35fr) minmax(0, 1.4fr) minmax(0, 1.25fr);
    gap: clamp(1rem, 4vw, 3rem);
    align-items: start;
  }
  .codes-head {
    padding-block: var(--size-3);
    border-block-end: var(--border-size-1) solid var(--border);
    color: var(--text-muted);
    font-size: var(--font-size-micro);
    font-weight: var(--font-weight-7);
    letter-spacing: .18em;
    text-transform: uppercase;
  }
  .code-row { padding-block: var(--size-4); border-block-end: var(--border-size-1) solid var(--border); }
  .code-row[data-runtime='true'] { background: color-mix(in srgb, var(--violet-2) 45%, transparent); }
  .code-id {
    display: inline;
    color: var(--violet-8);
    font-family: var(--font-mono);
    font-size: var(--font-size-1);
    font-weight: var(--font-weight-7);
  }
  .code-family { display: block; margin-block-start: var(--size-1); color: var(--text-muted); font-size: var(--font-size-00); }
  .code-gloss { color: var(--text-secondary); font-size: var(--font-size-0); line-height: var(--font-lineheight-3); }
  /* Messages and source paths carry no break opportunity, so they set the
     min-content floor of whichever track holds them. */
  .code-gloss, .code-variants, .code-id, .code-family, .code-sites { overflow-wrap: anywhere; }
  .code-variants { color: var(--text-muted); font-size: var(--font-size-00); line-height: var(--font-lineheight-3); }
  .code-sites { color: var(--text-muted); font-family: var(--font-mono); font-size: var(--font-size-00); line-height: var(--font-lineheight-3); }
  .footnote { padding-block-start: var(--size-6); color: var(--text-muted); font-size: var(--font-size-00); line-height: var(--font-lineheight-3); }
  .footnote p + p { margin-block-start: var(--size-3); }
  .footnote code { color: var(--violet-8); }

  /* Three tracks cannot hold a source path, an identifier and a message once
     the reading column drops below ~1100px, so the rows stack there. */
  @media (max-width: 1100px) {
    .codes-head { display: none; }
    .code-row { grid-template-columns: minmax(0, 1fr); gap: var(--size-2); }
  }
`)];
