import { compiledStyle } from '../site-ui/compiled-style.ts';

export const pageApiListStyles = [compiledStyle(`
  :host { display: block; color: var(--text-primary); }
  * { box-sizing: border-box; }
  p { margin: 0; }

  /* registry table: hairline rows, display-grade package names */
  .registry { border-block-start: var(--border-size-1) solid var(--border); }
  .registry-head, .pkg-row {
    display: grid;
    grid-template-columns: minmax(0, .9fr) minmax(0, 1fr) auto;
    gap: clamp(1rem, 4vw, 3rem);
    align-items: start;
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
  .pkg-row { padding-block: var(--size-6); border-block-end: var(--border-size-1) solid var(--border); }
  .pkg-name {
    display: block;
    color: var(--violet-8);
    font-size: clamp(1.7rem, 2.8vw, 2.5rem);
    font-weight: 800;
    line-height: 1;
    letter-spacing: -.03em;
  }
  .pkg-row[data-kind='optional'] .pkg-name { color: var(--text-secondary); }
  .pkg-path { display: block; margin-block-start: var(--size-2); color: var(--text-muted); font-size: var(--font-size-00); }
  .pkg-copy { margin-block-start: var(--size-3); color: var(--text-secondary); font-size: var(--font-size-0); line-height: var(--font-lineheight-3); }
  .pkg-note { display: block; margin-block-start: var(--size-2); color: var(--text-muted); font-size: var(--font-size-00); line-height: var(--font-lineheight-3); }
  .pkg-note:empty, .chip:empty { display: none; }
  .pkg-chips { display: flex; flex-wrap: wrap; gap: var(--size-2); }
  .chip {
    padding: var(--size-1) var(--size-2);
    border-radius: var(--radius-1);
    background: var(--violet-2);
    color: var(--violet-8);
    font-size: var(--font-size-00);
  }
  .kind {
    padding: var(--size-1) var(--size-3);
    border-radius: var(--radius-1);
    font-size: var(--font-size-00);
    font-weight: var(--font-weight-7);
    letter-spacing: .08em;
    text-transform: uppercase;
  }
  .kind-core { background: var(--brand); color: var(--on-brand); }
  .kind-build {
    background: var(--violet-2);
    color: var(--violet-8);
    box-shadow: inset 0 0 0 var(--border-size-1) color-mix(in srgb, var(--violet-5) 55%, transparent);
  }
  .kind-optional {
    border: var(--border-size-1) dashed color-mix(in srgb, var(--violet-5) 65%, transparent);
    color: var(--text-secondary);
  }
  .footnote { padding-block-start: var(--size-6); color: var(--text-muted); font-size: var(--font-size-00); line-height: var(--font-lineheight-3); }
  .footnote p + p { margin-block-start: var(--size-3); }
  .footnote code { color: var(--violet-8); }

  /* generated reference: hairline rows, one per export / custom element */
  .ref-row, .ce-row {
    display: grid;
    grid-template-columns: minmax(0, .9fr) minmax(0, 1fr) auto;
    gap: clamp(1rem, 4vw, 3rem);
    align-items: start;
    padding-block: var(--size-4);
    border-block-end: var(--border-size-1) solid var(--border);
  }
  .ce-row { grid-template-columns: minmax(0, .9fr) minmax(0, 1fr); }
  .ref-name {
    display: inline;
    color: var(--violet-8);
    font-family: var(--font-mono);
    font-size: var(--font-size-1);
    font-weight: var(--font-weight-7);
  }
  .ref-container { display: block; margin-block-start: var(--size-1); color: var(--text-muted); font-size: var(--font-size-00); }
  .ref-row .chip, .ce-row .chip { margin-inline-end: var(--size-1); }
  .chip-stability { background: transparent; box-shadow: inset 0 0 0 var(--border-size-1) color-mix(in srgb, var(--violet-5) 55%, transparent); }
  .ref-summary { color: var(--text-secondary); font-size: var(--font-size-0); line-height: var(--font-lineheight-3); }
  .ref-source, .ce-module { color: var(--text-muted); font-family: var(--font-mono); font-size: var(--font-size-00); }
  .ce-tag {
    display: inline;
    color: var(--violet-8);
    font-family: var(--font-mono);
    font-size: var(--font-size-1);
    font-weight: var(--font-weight-7);
  }
  .ce-class { display: block; margin-block-start: var(--size-1); color: var(--text-muted); font-size: var(--font-size-00); }
  .ce-description { color: var(--text-secondary); font-size: var(--font-size-0); line-height: var(--font-lineheight-3); }
  .ce-details { grid-column: 1 / -1; display: grid; gap: var(--size-2); }
  .ce-detail { display: block; color: var(--text-muted); font-size: var(--font-size-00); line-height: var(--font-lineheight-3); }
  .ce-detail b {
    margin-inline-end: var(--size-2);
    color: var(--text-secondary);
    font-weight: var(--font-weight-7);
    letter-spacing: .08em;
    text-transform: uppercase;
  }

  @media (max-width: 860px) {
    .registry-head { display: none; }
    .pkg-row { grid-template-columns: 1fr; gap: var(--size-3); }
    .kind { justify-self: start; }
    .ref-row, .ce-row { grid-template-columns: 1fr; gap: var(--size-2); }
  }
`)];
