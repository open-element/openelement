import { compiledStyle } from '../site-ui/compiled-style.ts';
import { mastheadStyles } from './page-styles.ts';

export const pageContributingStyles = [compiledStyle(`
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
  p,
  ol,
  ul {
    margin: 0;
  }

  /* ── masthead: mono "BUILD IT" + serif "with us." ── */
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
    line-height: 0.92;
  }

  h1 .mono-line {
    display: block;
    font-family: var(--font-mono);
    font-weight: 800;
    font-size: clamp(3rem, 8vw, 7rem);
    letter-spacing: -0.05em;
    color: var(--text-primary);
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

  .lede {
    max-width: 38rem;
    margin-block-start: clamp(1.25rem, 3vh, 2rem);
    color: var(--text-secondary);
    font-size: clamp(1rem, 1.2vw, 1.1rem);
    line-height: 1.75;
  }

  .section-label {
    color: var(--brand);
    font-family: var(--font-mono);
    font-size: var(--font-size-00);
    font-weight: var(--font-weight-8);
    letter-spacing: 0.24em;
    text-transform: uppercase;
  }

  /* ── setup: terminal card + release line | PR checklist ── */
  .setup {
    display: grid;
    grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
    gap: clamp(2rem, 6vw, 6rem);
    padding: clamp(2.5rem, 6vh, 4.5rem) clamp(1.5rem, 5vw, 4.5rem);
    border-block-start: 1px solid var(--border);
  }

  .setup-col {
    display: grid;
    gap: var(--size-4);
    align-content: start;
  }

  .setup-copy {
    color: var(--text-secondary);
    font-size: var(--font-size-0);
    line-height: 1.75;
  }

  .setup-copy .inline-code {
    font-family: var(--font-mono);
    font-size: var(--font-size-00);
    background: var(--bg-surface);
    border: 0.5px solid var(--border);
    border-radius: var(--radius-1);
    padding: 0.125rem 0.375rem;
  }

  .release {
    display: grid;
    gap: var(--size-2);
    padding: 0;
    list-style: none;
    counter-reset: release;
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: var(--font-size-00);
    line-height: 1.7;
  }

  .release li {
    counter-increment: release;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--size-3);
    align-items: baseline;
  }

  .release li::before {
    content: counter(release, decimal-leading-zero);
    color: var(--violet-8);
    font-weight: var(--font-weight-8);
  }

  .release .inline-code {
    font-size: var(--font-size-micro);
    background: var(--bg-surface);
    border: 0.5px solid var(--border);
    border-radius: var(--radius-1);
    padding: 0.125rem 0.375rem;
  }

  .checklist {
    display: grid;
    gap: var(--size-4);
    padding: 0;
    list-style: none;
  }

  .checklist li {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--size-3);
    align-items: center;
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: var(--font-size-0);
    line-height: 1.6;
  }

  .checkbox {
    display: inline-grid;
    place-items: center;
    width: var(--size-5);
    height: var(--size-5);
    border-radius: var(--radius-1);
    background: var(--brand);
    color: var(--on-brand);
    font-size: var(--font-size-00);
    font-weight: var(--font-weight-8);
  }

  .checkbox.open {
    background: transparent;
    border: 1.5px solid color-mix(in srgb, var(--violet-5) 55%, transparent);
  }

  /* ── where to help: outlined number rows ── */
  .help {
    display: grid;
    border-block-start: 1px solid var(--border);
  }

  .help-header {
    padding: clamp(2rem, 5vh, 3.5rem) clamp(1.5rem, 5vw, 4.5rem) var(--size-4);
  }

  .help-row {
    display: grid;
    grid-template-columns: minmax(4rem, 0.14fr) minmax(0, 0.9fr) minmax(0, 1.1fr);
    gap: clamp(1rem, 4vw, 4rem);
    align-items: center;
    padding: clamp(1.25rem, 3vh, 2rem) clamp(1.5rem, 5vw, 4.5rem);
    border-block-start: 1px solid var(--border);
  }

  .help-index {
    font-family: var(--font-mono);
    font-size: clamp(2.2rem, 4.5vw, 3.4rem);
    font-weight: 800;
    line-height: 1;
    color: transparent;
    -webkit-text-stroke: 1.5px color-mix(in srgb, var(--violet-5) 55%, transparent);
  }

  .help-title {
    font-family: var(--font-mono);
    font-size: var(--font-size-2);
    font-weight: 800;
    letter-spacing: -0.01em;
    color: var(--text-primary);
  }

  .help-copy {
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: var(--font-size-00);
    line-height: 1.7;
  }

  /* ── questions-first callout: violet edge bar ── */
  .callout {
    margin: clamp(2.5rem, 6vh, 4.5rem) clamp(1.5rem, 5vw, 4.5rem);
    padding: var(--size-5) var(--size-6);
    border: 1px solid color-mix(in srgb, var(--violet-5) 40%, transparent);
    border-inline-start: var(--size-1) solid var(--brand);
    border-radius: var(--radius-2);
    background: color-mix(in srgb, var(--violet-1) 30%, var(--bg-elevated));
  }

  .callout-label {
    color: var(--violet-8);
    font-family: var(--font-mono);
    font-size: var(--font-size-00);
    font-weight: var(--font-weight-8);
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }

  .callout p {
    margin-block-start: var(--size-3);
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: var(--font-size-0);
    line-height: 1.75;
  }

  .callout a {
    color: var(--brand);
    text-decoration: none;
  }

  .callout a:hover {
    text-decoration: underline;
  }

  .nav-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--size-3);
    padding: 0 clamp(1.5rem, 5vw, 4.5rem) clamp(3rem, 8vh, 6rem);
  }

  @media (max-width: 900px) {
    .setup {
      grid-template-columns: 1fr;
    }

    .help-row {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--size-2);
    }
  }
`)];
