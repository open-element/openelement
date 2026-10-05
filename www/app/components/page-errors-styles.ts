import { compiledStyle } from '../site-ui/compiled-style.ts';

export const pageErrorsStyles = [
  compiledStyle(`
  :host { display: block; color: var(--color-foreground); }
  * { box-sizing: border-box; }
  p { margin: 0; }

  /* code table: mono identifiers, hairline rows */
  .codes { border-block-start: calc(var(--spacing) * 0.25) solid var(--color-border); }
  .codes-head, .code-row {
    display: grid;
    grid-template-columns: minmax(0, .35fr) minmax(0, 1.4fr) minmax(0, 1.25fr);
    gap: clamp(1rem, 4vw, 3rem);
    align-items: start;
  }
  .codes-head {
    padding-block: calc(var(--spacing) * 3);
    border-block-end: calc(var(--spacing) * 0.25) solid var(--color-border);
    color: var(--color-muted-foreground);
    font-size: var(--font-size-micro);
    font-weight: var(--font-weight-bold);
    letter-spacing: .18em;
    text-transform: uppercase;
  }
  .code-row { padding-block: calc(var(--spacing) * 4); border-block-end: calc(var(--spacing) * 0.25) solid var(--color-border); }
  .code-row[data-runtime='true'] { background: color-mix(in srgb, var(--color-border) 45%, transparent); }
  .code-id {
    display: inline;
    color: var(--color-primary);
    font-family: var(--font-mono);
    font-size: var(--text-base);
    font-weight: var(--font-weight-bold);
  }
  .code-family { display: block; margin-block-start: calc(var(--spacing) * 1); color: var(--color-muted-foreground); font-size: var(--text-xs); }
  .code-gloss { color: var(--color-muted-foreground); font-size: var(--text-sm); line-height: var(--leading-normal); }
  /* Messages and source paths carry no break opportunity, so they set the
     min-content floor of whichever track holds them. */
  .code-gloss, .code-variants, .code-id, .code-family, .code-sites { overflow-wrap: anywhere; }
  .code-variants { color: var(--color-muted-foreground); font-size: var(--text-xs); line-height: var(--leading-normal); }
  .code-sites { color: var(--color-muted-foreground); font-family: var(--font-mono); font-size: var(--text-xs); line-height: var(--leading-normal); }
  .footnote { padding-block-start: calc(var(--spacing) * 6); color: var(--color-muted-foreground); font-size: var(--text-xs); line-height: var(--leading-normal); }
  .footnote p + p { margin-block-start: calc(var(--spacing) * 3); }
  .footnote code { color: var(--color-primary); }

  /* Three tracks cannot hold a source path, an identifier and a message once
     the reading column drops below ~1100px, so the rows stack there. */
  @media (max-width: 1100px) {
    .codes-head { display: none; }
    .code-row { grid-template-columns: minmax(0, 1fr); gap: calc(var(--spacing) * 2); }
  }
`),
];
