import { compiledStyle } from '../site-ui/compiled-style.ts';

export const pageErrorsStyles = [compiledStyle(`
  :host { display: block; color: var(--text-primary); }
  * { box-sizing: border-box; }
  p { margin: 0; }

  /* code table: hairline rows, monospace code ids, severity as the one accent */
  .registry { border-block-start: var(--border-size-1) solid var(--border); }
  .count {
    display: block;
    padding-block: var(--size-3) 0;
    color: var(--text-muted);
    font-size: var(--font-size-micro);
    font-weight: var(--font-weight-7);
    letter-spacing: .18em;
    text-transform: uppercase;
  }
  .registry-head, .code-row {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(0, .7fr) minmax(0, .6fr) minmax(0, 2fr);
    gap: clamp(1rem, 3vw, 2.5rem);
    align-items: baseline;
  }
  .registry-head {
    padding-block: var(--size-3);
    border-block-end: var(--border-size-1) solid var(--border);
    color: var(--text-muted);
    font-size: var(--font-size-micro);
    font-weight: var(--font-weight-7);
    letter-spacing: .18em;
    text-transform: uppercase;
  }
  .code-row {
    padding-block: var(--size-4);
    border-block-end: var(--border-size-1) solid var(--border);
  }
  .code-line { display: flex; flex-wrap: wrap; align-items: center; gap: var(--size-2); }
  .code-id {
    color: var(--violet-8);
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: var(--font-size-0);
    font-weight: var(--font-weight-7);
    letter-spacing: .02em;
  }
  .code-row[data-severity='warning'] .code-id { color: var(--text-secondary); }
  .severity {
    padding: var(--size-1) var(--size-2);
    border-radius: var(--radius-1);
    font-size: var(--font-size-micro);
    font-weight: var(--font-weight-7);
    letter-spacing: .08em;
    text-transform: uppercase;
  }
  .severity-error { background: var(--violet-2); color: var(--violet-8); }
  .severity-warning { background: var(--surface-2, var(--violet-1)); color: var(--text-secondary); }
  .family {
    padding: var(--size-1) var(--size-2);
    border-radius: var(--radius-1);
    background: var(--violet-2);
    color: var(--violet-8);
    font-size: var(--font-size-00);
  }
  .phase {
    color: var(--text-secondary);
    font-size: var(--font-size-00);
    letter-spacing: .04em;
  }
  .detail { display: flex; flex-direction: column; gap: var(--size-2); }
  .message { color: var(--text-secondary); font-size: var(--font-size-0); line-height: var(--font-lineheight-3); }
  .source {
    color: var(--text-muted);
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: var(--font-size-00);
    word-break: break-all;
  }
  .notes { margin: 0; padding-inline-start: var(--size-5); color: var(--text-secondary); font-size: var(--font-size-0); line-height: var(--font-lineheight-3); }
  .notes li { margin-block-end: var(--size-2); }

  @media (max-width: 48rem) {
    .registry-head { display: none; }
    .code-row { grid-template-columns: 1fr; gap: var(--size-2); }
  }
`)];
