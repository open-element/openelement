import { compiledStyle } from '../site-ui/compiled-style.ts';

export const pageReferenceStyles = [
  compiledStyle(`
  :host { display: block; color: var(--color-foreground); }
  * { box-sizing: border-box; }
  p { margin: 0; }

  /* registry table: hairline rows, display-grade package names */
  .registry { border-block-start: 1px solid var(--color-border); }
  .registry-head, .pkg-row {
    display: grid;
    grid-template-columns: minmax(0, .9fr) minmax(0, 1fr) auto;
    gap: clamp(1rem, 4vw, 3rem);
    align-items: start;
  }
  .registry-head {
    padding-block: calc(var(--spacing) * 3);
    border-block-end: 1px solid var(--color-border);
    color: var(--color-muted-foreground);
    font-size: var(--font-size-micro);
    font-weight: var(--font-weight-bold);
    letter-spacing: .18em;
    text-transform: uppercase;
  }
  .pkg-row { padding-block: calc(var(--spacing) * 6); border-block-end: 1px solid var(--color-border); }
  .pkg-name {
    display: block;
    color: var(--color-primary);
    font-size: clamp(1.7rem, 2.8vw, 2.5rem);
    font-weight: 800;
    line-height: 1;
    letter-spacing: -.03em;
  }
  .pkg-row[data-kind='optional'] .pkg-name { color: var(--color-muted-foreground); }
  .pkg-path { display: block; margin-block-start: calc(var(--spacing) * 2); color: var(--color-muted-foreground); font-size: var(--text-xs); }
  .pkg-copy { margin-block-start: calc(var(--spacing) * 3); color: var(--color-muted-foreground); font-size: var(--text-sm); line-height: 1.5; }
  .pkg-note { display: block; margin-block-start: calc(var(--spacing) * 2); color: var(--color-muted-foreground); font-size: var(--text-xs); line-height: 1.5; }
  .pkg-note:empty, .chip:empty { display: none; }
  .pkg-chips { display: flex; flex-wrap: wrap; gap: calc(var(--spacing) * 2); }
  .chip {
    padding: calc(var(--spacing) * 1) calc(var(--spacing) * 2);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-primary) 16%, var(--color-background));
    color: var(--color-primary);
    font-size: var(--text-xs);
  }
  .kind {
    padding: calc(var(--spacing) * 1) calc(var(--spacing) * 3);
    border-radius: var(--radius-md);
    font-size: var(--text-xs);
    font-weight: var(--font-weight-bold);
    letter-spacing: .08em;
    text-transform: uppercase;
  }
  .kind-core { background: var(--color-primary); color: var(--color-primary-foreground); }
  .kind-build {
    background: color-mix(in srgb, var(--color-primary) 16%, var(--color-background));
    color: var(--color-primary);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-primary) 55%, transparent);
  }
  .kind-optional {
    border: 1px dashed color-mix(in srgb, var(--color-primary) 65%, transparent);
    color: var(--color-muted-foreground);
  }
  .footnote { padding-block-start: calc(var(--spacing) * 6); color: var(--color-muted-foreground); font-size: var(--text-xs); line-height: 1.5; }
  .footnote p + p { margin-block-start: calc(var(--spacing) * 3); }
  .footnote code { color: var(--color-primary); }

  /* generated reference: hairline rows, one per export / custom element */
  .ref-row, .ce-row {
    display: grid;
    /* Every track is flexible. An auto-width third track sized itself to the
       max-content of the 540px source path and starved the first two tracks
       down to ~80px, so the mono identifier painted over the summary. */
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.45fr) minmax(0, 1.2fr);
    gap: clamp(1rem, 4vw, 3rem);
    align-items: start;
    padding-block: calc(var(--spacing) * 4);
    border-block-end: 1px solid var(--color-border);
  }
  .ce-row { grid-template-columns: minmax(0, .9fr) minmax(0, 1fr); }
  /* Source paths and identifiers carry no break opportunity, so they set the
     min-content floor of whichever track holds them. */
  .ref-name, .ref-container, .ref-source, .ce-tag, .ce-class, .ce-module, .ce-detail { overflow-wrap: anywhere; }
  .ref-name {
    display: inline;
    color: var(--color-primary);
    font-family: var(--font-mono);
    font-size: var(--text-base);
    font-weight: var(--font-weight-bold);
  }
  .ref-container { display: block; margin-block-start: calc(var(--spacing) * 1); color: var(--color-muted-foreground); font-size: var(--text-xs); }
  .ref-row .chip, .ce-row .chip { margin-inline-end: calc(var(--spacing) * 1); }
  .chip-stability { background: transparent; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-primary) 55%, transparent); }
  .ref-summary { color: var(--color-muted-foreground); font-size: var(--text-sm); line-height: 1.5; }
  .ref-source, .ce-module { color: var(--color-muted-foreground); font-family: var(--font-mono); font-size: var(--text-xs); }
  .ce-tag {
    display: inline;
    color: var(--color-primary);
    font-family: var(--font-mono);
    font-size: var(--text-base);
    font-weight: var(--font-weight-bold);
  }
  .ce-class { display: block; margin-block-start: calc(var(--spacing) * 1); color: var(--color-muted-foreground); font-size: var(--text-xs); }
  .ce-description { color: var(--color-muted-foreground); font-size: var(--text-sm); line-height: 1.5; }
  .ce-details { grid-column: 1 / -1; display: grid; gap: calc(var(--spacing) * 2); }
  .ce-detail { display: block; color: var(--color-muted-foreground); font-size: var(--text-xs); line-height: 1.5; }
  .ce-detail b {
    margin-inline-end: calc(var(--spacing) * 2);
    color: var(--color-muted-foreground);
    font-weight: var(--font-weight-bold);
    letter-spacing: .08em;
    text-transform: uppercase;
  }

  /* generated reference: declared signature + option table per export */
  .ref-signature {
    display: block;
    margin-block-start: calc(var(--spacing) * 2);
    color: var(--color-primary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.1;
    overflow-wrap: anywhere;
  }
  .ref-options { margin-block-start: calc(var(--spacing) * 3); }
  .ref-options summary {
    cursor: pointer;
    color: var(--color-muted-foreground);
    font-size: var(--text-xs);
  }
  .option-table { margin-block-start: calc(var(--spacing) * 2); border-block-start: 1px solid var(--color-border); }
  .option-row {
    display: grid;
    grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr) minmax(0, .5fr);
    gap: calc(var(--spacing) * 2) calc(var(--spacing) * 3);
    padding-block: calc(var(--spacing) * 2);
    border-block-end: 1px solid var(--color-border);
  }
  .option-name, .option-type, .option-note, .option-description { overflow-wrap: anywhere; }
  .option-name { color: var(--color-foreground); font-family: var(--font-mono); font-size: var(--text-xs); font-weight: var(--font-weight-bold); }
  .option-type { color: var(--color-primary); font-family: var(--font-mono); font-size: var(--text-xs); }
  .option-note { color: var(--color-muted-foreground); font-size: var(--text-xs); }
  .option-description { grid-column: 1 / -1; color: var(--color-muted-foreground); font-size: var(--text-xs); line-height: 1.1; }

  /* Three columns cannot hold a 540px source path, an identifier and a summary
     once the reading column drops below ~1100px, so the reference rows stack
     there (and the reference header goes with them). */
  @media (max-width: 1100px) {
    #api-reference .registry-head { display: none; }
    #config-options .registry-head { display: none; }
    .ref-row, .ce-row { grid-template-columns: minmax(0, 1fr); gap: calc(var(--spacing) * 2); }
    .option-row { grid-template-columns: minmax(0, 1fr); }
  }

  @media (max-width: 860px) {
    .registry-head { display: none; }
    .pkg-row { grid-template-columns: minmax(0, 1fr); gap: calc(var(--spacing) * 3); }
    .kind { justify-self: start; }
  }
`),
];
