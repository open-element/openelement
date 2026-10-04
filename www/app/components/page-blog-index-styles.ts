import { compiledStyle } from '../site-ui/compiled-style.ts';
import { eyebrowStyles, mastheadStyles } from './page-styles.ts';

export const pageBlogIndexStyles = [
  compiledStyle(`
  :host {
    display: block;
    color: var(--color-foreground);
    background: var(--color-background);
  }

  * {
    box-sizing: border-box;
  }

  h1,
  h2,
  h3,
  p {
    margin: 0;
  }

  /* ── masthead: one serif italic accent ── */
  ${mastheadStyles}
  ${eyebrowStyles}

  h1 {
    margin-block-start: clamp(1.5rem, 4vh, 3rem);
    font-family: var(--font-serif);
    font-style: italic;
    font-weight: 400;
    font-size: clamp(4.2rem, 13vw, 11rem);
    line-height: 0.92;
    letter-spacing: -0.02em;
    color: var(--color-primary);
  }

  .lede {
    max-width: 38rem;
    margin-block-start: clamp(1.25rem, 3vh, 2rem);
    color: var(--color-muted-foreground);
    font-size: clamp(1rem, 1.2vw, 1.1rem);
    line-height: 1.75;
  }

  .origin-note {
    max-width: 38rem;
    margin-block-start: calc(var(--spacing) * 3);
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.75;
  }

  .origin-note:empty {
    display: none;
  }

  /* ── featured dispatch band ── */
  .featured {
    display: block;
    padding: clamp(2.5rem, 6vh, 4.5rem) clamp(1.5rem, 5vw, 4.5rem);
    border-block: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-popover) 55%, var(--color-background));
    color: inherit;
    text-decoration: none;
  }

  .featured-kicker {
    display: flex;
    flex-wrap: wrap;
    gap: calc(var(--spacing) * 3);
    align-items: baseline;
    color: var(--color-primary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: var(--font-weight-extrabold);
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }

  .featured-kicker .read-time {
    margin-inline-start: auto;
    color: var(--color-muted-foreground);
    font-weight: var(--font-weight-medium);
    letter-spacing: 0.08em;
  }

  .featured h2 {
    max-width: 20ch;
    margin-block-start: calc(var(--spacing) * 5);
    font-family: var(--font-serif);
    font-weight: 400;
    font-size: clamp(2.4rem, 5.5vw, 4.6rem);
    line-height: 1;
    letter-spacing: -0.01em;
    color: var(--color-foreground);
    transition: color 0.15s ease;
  }

  .featured:hover h2 {
    color: var(--color-primary);
  }

  .featured-excerpt {
    max-width: 44rem;
    margin-block-start: calc(var(--spacing) * 4);
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: 1.75;
  }

  .featured-excerpt:empty,
  .row-excerpt:empty {
    display: none;
  }

  .read-more {
    display: inline-block;
    margin-block-start: calc(var(--spacing) * 5);
    color: var(--color-primary);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-weight: var(--font-weight-bold);
  }

  /* ── numbered article rows ── */
  .stream {
    display: grid;
    padding-block-end: clamp(3rem, 8vh, 6rem);
  }

  .row {
    display: grid;
    grid-template-columns: minmax(4rem, 0.14fr) minmax(0, 1fr) auto;
    gap: clamp(1rem, 4vw, 4rem);
    align-items: center;
    padding: clamp(1.5rem, 4vh, 2.75rem) clamp(1.5rem, 5vw, 4.5rem);
    border-block-end: 1px solid var(--color-border);
    color: inherit;
    text-decoration: none;
    transition: background 0.15s ease;
  }

  .row:hover {
    background: linear-gradient(90deg, color-mix(in srgb, var(--color-primary) 8%, transparent), transparent);
  }

  .row-index {
    font-family: var(--font-mono);
    font-size: clamp(2.4rem, 5vw, 4rem);
    font-weight: 800;
    line-height: 1;
    color: transparent;
    -webkit-text-stroke: 1.5px color-mix(in srgb, var(--color-ring) 55%, transparent);
  }

  .row-title {
    display: block;
    font-family: var(--font-serif);
    font-weight: 400;
    font-size: clamp(1.6rem, 3vw, 2.6rem);
    line-height: 1.05;
    color: var(--color-foreground);
    transition: color 0.15s ease;
  }

  .row:hover .row-title {
    color: var(--color-primary);
  }

  .row-excerpt {
    margin-block-start: calc(var(--spacing) * 2);
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.6;
  }

  .row-lang {
    display: inline-block;
    margin-block-start: calc(var(--spacing) * 2);
    padding: 0 calc(var(--spacing) * 2);
    border: calc(var(--spacing) * 0.25) solid color-mix(in srgb, var(--color-ring) 45%, transparent);
    border-radius: var(--radius-md);
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.08em;
  }

  .row-lang:empty {
    display: none;
  }

  .row-date {
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    white-space: nowrap;
  }

  @media (max-width: 720px) {
    .row {
      grid-template-columns: minmax(0, 1fr);
      gap: calc(var(--spacing) * 2);
    }

    .row-date {
      justify-self: start;
    }
  }
`),
];
