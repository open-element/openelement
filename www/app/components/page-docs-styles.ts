import { compiledStyle } from '../site-ui/compiled-style.ts';
import { eyebrowStyles, mastheadStyles } from './page-styles.ts';

export const pageDocsStyles = [
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
  p {
    margin: 0;
  }

  /* ── masthead: serif "Read the" + mono "MANUAL." ── */
  ${mastheadStyles}
  ${eyebrowStyles}

  .masthead-top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: calc(var(--spacing) * 4);
  }

  .stamp {
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
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
    color: var(--color-primary);
  }

  h1 .mono-line {
    display: block;
    font-family: var(--font-mono);
    font-weight: 800;
    font-size: clamp(3rem, 8vw, 7rem);
    letter-spacing: -0.05em;
    color: var(--color-foreground);
  }

  .lede {
    max-width: 34rem;
    margin-block-start: clamp(1.25rem, 3vh, 2rem);
    color: var(--color-muted-foreground);
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
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--font-size-micro);
    letter-spacing: 0.2em;
    text-transform: uppercase;
    user-select: none;
  }

  /* ── entrance rows: outlined numbers, hairlines, hover ── */
  .entrances {
    display: grid;
    border-block-start: 1px solid var(--color-border);
  }

  .entrance {
    display: grid;
    grid-template-columns: minmax(5rem, 0.16fr) minmax(0, 1fr) auto;
    gap: clamp(1rem, 4vw, 4rem);
    align-items: center;
    padding: clamp(1.25rem, 3.5vh, 2.5rem) clamp(1.5rem, 5vw, 4.5rem);
    border-block-end: 1px solid var(--color-border);
    color: inherit;
    text-decoration: none;
    transition: background 0.15s ease;
  }

  .entrance:hover {
    background: linear-gradient(90deg, color-mix(in srgb, var(--color-primary) 8%, transparent), transparent);
  }

  .entrance-index {
    font-family: var(--font-mono);
    font-size: clamp(3rem, 7vw, 6rem);
    font-weight: 800;
    line-height: 1;
    color: transparent;
    -webkit-text-stroke: 1.5px color-mix(in srgb, var(--color-ring) 55%, transparent);
    transition: -webkit-text-stroke-color 0.15s ease;
  }

  .entrance:hover .entrance-index {
    -webkit-text-stroke-color: var(--color-primary);
  }

  .entrance-title {
    display: block;
    font-family: var(--font-mono);
    font-size: clamp(1.5rem, 2.8vw, 2.4rem);
    font-weight: 800;
    letter-spacing: -0.02em;
    line-height: 1.05;
    color: var(--color-foreground);
    transition: color 0.15s ease;
  }

  .entrance:hover .entrance-title {
    color: var(--color-primary);
  }

  .entrance-copy {
    margin-block-start: calc(var(--spacing) * 2);
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.6;
  }

  .entrance-arrow {
    font-family: var(--font-mono);
    font-size: var(--text-5xl);
    color: var(--color-ring);
    transition: transform 0.15s ease, color 0.15s ease;
  }

  .entrance:hover .entrance-arrow {
    color: var(--color-primary);
    transform: translateX(calc(var(--spacing) * 2));
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
`),
];
