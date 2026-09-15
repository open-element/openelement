import { compiledStyle } from '../site-ui/compiled-style.ts';
import { mastheadStyles } from './page-styles.ts';

export const pageDocsStyles = [compiledStyle(`
  :host {
    display: block;
    color: var(--text-primary);
    background: var(--bg-base);
  }

  * {
    box-sizing: border-box;
  }

  h1,
  p {
    margin: 0;
  }

  /* ── masthead: serif "Read the" + mono "MANUAL." ── */
  ${mastheadStyles}

  .masthead-top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--size-4);
  }

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

  .stamp {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--font-size-00);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  h1 {
    margin-block-start: clamp(1.5rem, 4vh, 3rem);
    line-height: 0.92;
  }

  h1 .serif-line {
    display: block;
    font-family: var(--font-serif);
    font-style: italic;
    font-weight: 400;
    font-size: clamp(3.4rem, 9vw, 8rem);
    letter-spacing: -0.02em;
    color: var(--violet-8);
  }

  h1 .mono-line {
    display: block;
    font-family: var(--font-mono);
    font-weight: 800;
    font-size: clamp(3rem, 8vw, 7rem);
    letter-spacing: -0.05em;
    color: var(--text-primary);
  }

  .lede {
    max-width: 34rem;
    margin-block-start: clamp(1.25rem, 3vh, 2rem);
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: clamp(1rem, 1.2vw, 1.1rem);
    line-height: 1.75;
  }

  .sidenote {
    position: absolute;
    /* physical insets: with vertical-rl the element's own writing mode
       rotates logical insets — right/bottom is unambiguous. */
    right: clamp(0.5rem, 1.5vw, 1.5rem);
    bottom: clamp(1rem, 4vh, 2.5rem);
    writing-mode: vertical-rl;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--font-size-micro);
    letter-spacing: 0.2em;
    text-transform: uppercase;
    user-select: none;
  }

  /* ── entrance rows: outlined numbers, hairlines, hover ── */
  .entrances {
    display: grid;
    border-block-start: 1px solid var(--border);
  }

  .entrance {
    display: grid;
    grid-template-columns: minmax(5rem, 0.16fr) minmax(0, 1fr) auto;
    gap: clamp(1rem, 4vw, 4rem);
    align-items: center;
    padding: clamp(1.25rem, 3.5vh, 2.5rem) clamp(1.5rem, 5vw, 4.5rem);
    border-block-end: 1px solid var(--border);
    color: inherit;
    text-decoration: none;
    transition: background 0.15s ease;
  }

  .entrance:hover {
    background: linear-gradient(90deg, color-mix(in srgb, var(--brand) 8%, transparent), transparent);
  }

  .entrance-index {
    font-family: var(--font-mono);
    font-size: clamp(3rem, 7vw, 6rem);
    font-weight: 800;
    line-height: 1;
    color: transparent;
    -webkit-text-stroke: 1.5px color-mix(in srgb, var(--violet-5) 55%, transparent);
    transition: -webkit-text-stroke-color 0.15s ease;
  }

  .entrance:hover .entrance-index {
    -webkit-text-stroke-color: var(--violet-8);
  }

  .entrance-title {
    display: block;
    font-family: var(--font-mono);
    font-size: clamp(1.5rem, 2.8vw, 2.4rem);
    font-weight: 800;
    letter-spacing: -0.02em;
    line-height: 1.05;
    color: var(--text-primary);
    transition: color 0.15s ease;
  }

  .entrance:hover .entrance-title {
    color: var(--violet-8);
  }

  .entrance-copy {
    margin-block-start: var(--size-2);
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: var(--font-size-00);
    line-height: 1.6;
  }

  .entrance-arrow {
    font-family: var(--font-mono);
    font-size: var(--font-size-5);
    color: var(--violet-5);
    transition: transform 0.15s ease, color 0.15s ease;
  }

  .entrance:hover .entrance-arrow {
    color: var(--violet-8);
    transform: translateX(var(--size-2));
  }

  @media (max-width: 720px) {
    .sidenote {
      display: none;
    }

    .entrance {
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .entrance-index {
      display: none;
    }
  }
`)];
