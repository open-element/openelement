import { compiledStyle } from '../site-ui/compiled-style.ts';
import { mastheadStyles } from './page-styles.ts';

export const pageBlogIndexStyles = [compiledStyle(`
  :host {
    display: block;
    color: var(--text-primary);
    background: var(--bg-base);
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

  .eyebrow {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    color: var(--violet-8);
    font-family: var(--font-mono);
    font-size: var(--font-size-00);
    font-weight: var(--font-weight-8);
    letter-spacing: 0.29em;
    text-transform: uppercase;
  }

  .eyebrow::before {
    content: "";
    width: 2rem;
    height: 2px;
    background: var(--brand);
  }

  h1 {
    margin-block-start: clamp(1.5rem, 4vh, 3rem);
    font-family: var(--font-serif);
    font-style: italic;
    font-weight: 400;
    font-size: clamp(4.2rem, 13vw, 11rem);
    line-height: 0.92;
    letter-spacing: -0.02em;
    color: var(--violet-8);
  }

  .lede {
    max-width: 38rem;
    margin-block-start: clamp(1.25rem, 3vh, 2rem);
    color: var(--text-secondary);
    font-size: clamp(1rem, 1.2vw, 1.1rem);
    line-height: 1.75;
  }

  .origin-note {
    max-width: 38rem;
    margin-block-start: var(--size-3);
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--font-size-00);
    line-height: 1.75;
  }

  .origin-note:empty {
    display: none;
  }

  /* ── featured dispatch band ── */
  .featured {
    display: block;
    padding: clamp(2.5rem, 6vh, 4.5rem) clamp(1.5rem, 5vw, 4.5rem);
    border-block: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg-elevated) 55%, var(--bg-base));
    color: inherit;
    text-decoration: none;
  }

  .featured-kicker {
    display: flex;
    flex-wrap: wrap;
    gap: var(--size-3);
    align-items: baseline;
    color: var(--brand);
    font-family: var(--font-mono);
    font-size: var(--font-size-00);
    font-weight: var(--font-weight-8);
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }

  .featured-kicker .read-time {
    margin-inline-start: auto;
    color: var(--text-muted);
    font-weight: var(--font-weight-5);
    letter-spacing: 0.08em;
  }

  .featured h2 {
    max-width: 20ch;
    margin-block-start: var(--size-5);
    font-family: var(--font-serif);
    font-weight: 400;
    font-size: clamp(2.4rem, 5.5vw, 4.6rem);
    line-height: 1;
    letter-spacing: -0.01em;
    color: var(--text-primary);
    transition: color 0.15s ease;
  }

  .featured:hover h2 {
    color: var(--violet-8);
  }

  .featured-excerpt {
    max-width: 44rem;
    margin-block-start: var(--size-4);
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: var(--font-size-0);
    line-height: 1.75;
  }

  .featured-excerpt:empty,
  .row-excerpt:empty {
    display: none;
  }

  .read-more {
    display: inline-block;
    margin-block-start: var(--size-5);
    color: var(--violet-8);
    font-family: var(--font-mono);
    font-size: var(--font-size-0);
    font-weight: var(--font-weight-7);
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
    border-block-end: 1px solid var(--border);
    color: inherit;
    text-decoration: none;
    transition: background 0.15s ease;
  }

  .row:hover {
    background: linear-gradient(90deg, color-mix(in srgb, var(--brand) 8%, transparent), transparent);
  }

  .row-index {
    font-family: var(--font-mono);
    font-size: clamp(2.4rem, 5vw, 4rem);
    font-weight: 800;
    line-height: 1;
    color: transparent;
    -webkit-text-stroke: 1.5px color-mix(in srgb, var(--violet-5) 55%, transparent);
  }

  .row-title {
    display: block;
    font-family: var(--font-serif);
    font-weight: 400;
    font-size: clamp(1.6rem, 3vw, 2.6rem);
    line-height: 1.05;
    color: var(--text-primary);
    transition: color 0.15s ease;
  }

  .row:hover .row-title {
    color: var(--violet-8);
  }

  .row-excerpt {
    margin-block-start: var(--size-2);
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: var(--font-size-00);
    line-height: 1.6;
  }

  .row-lang {
    display: inline-block;
    margin-block-start: var(--size-2);
    padding: 0 var(--size-2);
    border: var(--border-size-1) solid color-mix(in srgb, var(--violet-5) 45%, transparent);
    border-radius: var(--radius-1);
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--font-size-00);
    letter-spacing: 0.08em;
  }

  .row-lang:empty {
    display: none;
  }

  .row-date {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--font-size-00);
    white-space: nowrap;
  }

  @media (max-width: 720px) {
    .row {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--size-2);
    }

    .row-date {
      justify-self: start;
    }
  }
`)];
