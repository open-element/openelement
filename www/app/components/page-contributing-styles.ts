import { compiledStyle } from '../site-ui/compiled-style.ts';
import { eyebrowStyles, mastheadStyles } from './page-styles.ts';

export const pageContributingStyles = [
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
  p,
  ol,
  ul {
    margin: 0;
  }

  /* ── masthead: mono "BUILD IT" + serif "with us." ── */
  ${mastheadStyles}
  ${eyebrowStyles}

  h1 {
    margin-block-start: clamp(1.5rem, 4vh, 3rem);
    line-height: 0.92;
  }

  h1 .mono-line {
    display: block;
    font-family: var(--font-mono);
    font-weight: 800;
    font-size: clamp(3rem, 8vw, 7rem);
    letter-spacing: -0.05em;
    color: var(--color-foreground);
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

  .lede {
    max-width: 38rem;
    margin-block-start: clamp(1.25rem, 3vh, 2rem);
    color: var(--color-muted-foreground);
    font-size: clamp(1rem, 1.2vw, 1.1rem);
    line-height: 1.75;
  }

  .section-label {
    color: var(--color-primary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: var(--font-weight-extrabold);
    letter-spacing: 0.24em;
    text-transform: uppercase;
  }

  /* ── setup: terminal card + release line | PR checklist ── */
  .setup {
    display: grid;
    grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
    gap: clamp(2rem, 6vw, 6rem);
    padding: clamp(2.5rem, 6vh, 4.5rem) clamp(1.5rem, 5vw, 4.5rem);
    border-block-start: 1px solid var(--color-border);
  }

  .setup-col {
    display: grid;
    gap: calc(var(--spacing) * 4);
    align-content: start;
  }

  .setup-copy {
    color: var(--color-muted-foreground);
    font-size: var(--text-sm);
    line-height: 1.75;
  }

  .setup-copy .inline-code {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    background: var(--color-muted);
    border: 0.5px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: 0.125rem 0.375rem;
  }

  .release {
    display: grid;
    gap: calc(var(--spacing) * 2);
    padding: 0;
    list-style: none;
    counter-reset: release;
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.7;
  }

  .release li {
    counter-increment: release;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: calc(var(--spacing) * 3);
    align-items: baseline;
  }

  .release li::before {
    content: counter(release, decimal-leading-zero);
    color: var(--color-primary);
    font-weight: var(--font-weight-extrabold);
  }

  .release .inline-code {
    font-size: var(--font-size-micro);
    background: var(--color-muted);
    border: 0.5px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: 0.125rem 0.375rem;
  }

  .release .inline-code:empty {
    display: none;
  }

  .checklist {
    display: grid;
    gap: calc(var(--spacing) * 4);
    padding: 0;
    list-style: none;
  }

  .checklist li {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: calc(var(--spacing) * 3);
    align-items: center;
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: 1.6;
  }

  .checkbox {
    display: inline-grid;
    place-items: center;
    width: calc(var(--spacing) * 5);
    height: calc(var(--spacing) * 5);
    border-radius: var(--radius-md);
    background: var(--color-primary);
    color: var(--color-primary-foreground);
    font-size: var(--text-xs);
    font-weight: var(--font-weight-extrabold);
  }

  .checkbox.open {
    background: transparent;
    border: 1.5px solid color-mix(in srgb, var(--color-ring) 55%, transparent);
  }

  /* ── where to help: outlined number rows ── */
  .help {
    display: grid;
    border-block-start: 1px solid var(--color-border);
  }

  .help-header {
    padding: clamp(2rem, 5vh, 3.5rem) clamp(1.5rem, 5vw, 4.5rem) calc(var(--spacing) * 4);
  }

  .help-row {
    display: grid;
    grid-template-columns: minmax(4rem, 0.14fr) minmax(0, 0.9fr) minmax(0, 1.1fr);
    gap: clamp(1rem, 4vw, 4rem);
    align-items: center;
    padding: clamp(1.25rem, 3vh, 2rem) clamp(1.5rem, 5vw, 4.5rem);
    border-block-start: 1px solid var(--color-border);
  }

  .help-index {
    font-family: var(--font-mono);
    font-size: clamp(2.2rem, 4.5vw, 3.4rem);
    font-weight: 800;
    line-height: 1;
    color: transparent;
    -webkit-text-stroke: 1.5px color-mix(in srgb, var(--color-ring) 55%, transparent);
  }

  .help-title {
    font-family: var(--font-mono);
    font-size: var(--text-xl);
    font-weight: 800;
    letter-spacing: -0.01em;
    color: var(--color-foreground);
  }

  .help-copy {
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.7;
  }

  /* ── questions-first callout: violet edge bar ── */
  .callout {
    margin: clamp(2.5rem, 6vh, 4.5rem) clamp(1.5rem, 5vw, 4.5rem);
    padding: calc(var(--spacing) * 5) calc(var(--spacing) * 6);
    border: 1px solid color-mix(in srgb, var(--color-ring) 40%, transparent);
    border-inline-start: calc(var(--spacing) * 1) solid var(--color-primary);
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--color-secondary) 30%, var(--color-popover));
  }

  .callout-label {
    color: var(--color-primary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: var(--font-weight-extrabold);
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }

  .callout p {
    margin-block-start: calc(var(--spacing) * 3);
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: 1.75;
  }

  .callout a {
    color: var(--color-primary);
    text-decoration: none;
  }

  .callout a:hover {
    text-decoration: underline;
  }

  .nav-row {
    display: flex;
    flex-wrap: wrap;
    gap: calc(var(--spacing) * 3);
    padding: 0 clamp(1.5rem, 5vw, 4.5rem) clamp(3rem, 8vh, 6rem);
  }

  @media (max-width: 900px) {
    .setup {
      grid-template-columns: 1fr;
    }

    .help-row {
      grid-template-columns: minmax(0, 1fr);
      gap: calc(var(--spacing) * 2);
    }
  }
`),
];
