import { compiledStyle } from '../site-ui/compiled-style.ts';

export const pageRoadmapStyles = [
  compiledStyle(`
  :host {
    display: block;
    color: var(--color-foreground);
  }

  * {
    box-sizing: border-box;
  }

  h1,
  h2,
  h3,
  p {
    margin-block-start: 0;
  }

  .now-callout {
    margin: calc(var(--spacing) * 5) 0 calc(var(--spacing) * 6);
    padding: calc(var(--spacing) * 4) calc(var(--spacing) * 5);
    border: calc(var(--spacing) * 0.25) solid var(--color-border);
    border-inline-start: calc(var(--spacing) * 1) solid var(--color-primary);
    border-radius: var(--radius-lg);
  }

  .now-callout .now-title {
    margin: calc(var(--spacing) * 3) 0 calc(var(--spacing) * 2);
    color: var(--color-foreground);
    font-weight: var(--font-weight-bold);
    line-height: 1.3;
  }

  .now-callout .now-copy {
    margin: 0;
    color: var(--color-muted-foreground);
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
  }

  .metric-label,
  .rule-label,
  .rule-title {
    color: var(--color-primary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: var(--font-weight-extrabold);
    letter-spacing: 0;
    text-transform: uppercase;
  }

  .now p,
  .tl-copy,
  .truth p,
  .truth li,
  .rule-copy,
  .rule-text,
  .matrix-copy {
    color: var(--color-muted-foreground);
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
  }

  /* vertical timeline: square nodes, evidence-first versions */
  .roadmap-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(280px, .38fr);
    gap: clamp(2rem, 6vw, 5rem);
    align-items: start;
  }

  .timeline {
    position: relative;
    display: grid;
  }

  .timeline::before {
    content: "";
    position: absolute;
    inset-block: calc(var(--spacing) * 2);
    inset-inline-start: calc(calc(var(--spacing) * 2) / 2);
    width: calc(var(--spacing) * 0.25);
    background: var(--color-border);
  }

  .tl-row {
    position: relative;
    padding: calc(var(--spacing) * 5) 0 calc(var(--spacing) * 5) calc(var(--spacing) * 8);
  }

  .tl-node {
    position: absolute;
    inset-inline-start: 0;
    inset-block-start: calc(calc(var(--spacing) * 5) + calc(var(--spacing) * 3));
    width: calc(var(--spacing) * 2);
    height: calc(var(--spacing) * 2);
  }

  .tl-stable .tl-node {
    background: var(--color-primary);
  }

  .tl-next .tl-node {
    border: calc(var(--spacing) * 0.5) solid var(--color-primary);
    background: var(--color-background);
  }

  .tl-baseline .tl-node {
    background: var(--color-primary);
  }

  .tl-next .tl-node::after {
    content: "";
    position: absolute;
    inset: calc(var(--spacing) * 1);
    background: var(--color-primary);
  }

  .tl-planned .tl-node {
    border: calc(var(--spacing) * 0.5) solid color-mix(in srgb, var(--color-ring) 55%, transparent);
  }

  .tl-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: calc(var(--spacing) * 3) calc(var(--spacing) * 4);
  }

  .tl-version {
    color: var(--color-foreground);
    font-size: clamp(2rem, 4.2vw, 3.6rem);
    font-weight: 800;
    line-height: 1;
    letter-spacing: -.03em;
  }

  .tl-next .tl-version {
    color: var(--color-primary);
  }

  .tl-planned .tl-version {
    color: transparent;
    -webkit-text-stroke: 1.5px color-mix(in srgb, var(--color-ring) 55%, transparent);
  }

  .tl-theme {
    color: var(--color-primary);
    font-family: var(--font-serif);
    font-size: clamp(1.25rem, 1.9vw, 1.7rem);
    font-style: italic;
    font-weight: 400;
  }

  .tl-planned .tl-theme {
    color: var(--color-ring);
  }

  .stamp {
    padding: calc(var(--spacing) * 1) calc(var(--spacing) * 3);
    border-radius: var(--radius-md);
    font-size: var(--text-xs);
    font-weight: var(--font-weight-bold);
    letter-spacing: .08em;
    text-transform: uppercase;
  }

  .stamp:empty,
  .tl-status:empty {
    display: none;
  }

  .stamp-current {
    background: var(--color-primary);
    color: var(--color-primary-foreground);
  }

  .stamp-next {
    border: calc(var(--spacing) * 0.25) solid var(--color-primary);
    color: var(--color-primary);
  }

  .stamp-baseline {
    background: var(--color-primary);
    color: var(--color-primary-foreground);
  }

  .tl-status {
    color: var(--color-muted-foreground);
    font-size: var(--text-xs);
    letter-spacing: .1em;
    text-transform: uppercase;
  }

  .tl-copy {
    max-width: 560px;
    margin-block: calc(var(--spacing) * 3) 0;
  }

  .rule-callout {
    position: sticky;
    top: calc(var(--nav-height) + calc(var(--spacing) * 6));
    padding: calc(var(--spacing) * 5);
    border: calc(var(--spacing) * 0.25) solid color-mix(in srgb, var(--color-ring) 45%, transparent);
    border-radius: var(--radius-lg);
    background: var(--color-primary-foreground);
    box-shadow: inset calc(var(--spacing) * 1) 0 0 var(--color-primary);
  }

  .rule-title {
    margin-block-end: calc(var(--spacing) * 3);
    color: var(--color-primary);
  }

  .rule-text {
    margin-block-end: 0;
  }

  .truth-grid {
    display: grid;
    grid-template-columns: minmax(0, .95fr) minmax(0, .95fr) minmax(0, .72fr);
    gap: calc(var(--spacing) * 5);
  }

  .truth h2 {
    margin-block: 0 calc(var(--spacing) * 4);
    color: var(--color-foreground);
    font-size: var(--text-2xl);
    line-height: 1.08;
    letter-spacing: 0;
  }

  .truth ul {
    display: grid;
    gap: calc(var(--spacing) * 2);
    margin: 0;
    padding-inline-start: calc(var(--spacing) * 5);
  }

  .matrix {
    display: grid;
    border-block-start: calc(var(--spacing) * 0.25) solid var(--color-border);
  }

  .matrix-row {
    display: grid;
    grid-template-columns: minmax(132px, .28fr) minmax(0, 1fr);
    gap: calc(var(--spacing) * 5);
    padding-block: calc(var(--spacing) * 5);
    border-block-end: calc(var(--spacing) * 0.25) solid var(--color-border);
  }

  .matrix-row:last-child {
    border-block-end: 0;
  }

  .visual-grid {
    display: grid;
    grid-template-columns: minmax(0, .88fr) minmax(0, 1fr);
    gap: calc(var(--spacing) * 5);
  }

  .rule-list {
    display: grid;
    gap: calc(var(--spacing) * 2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .rule-list li {
    display: grid;
    grid-template-columns: minmax(110px, .32fr) minmax(0, 1fr);
    gap: calc(var(--spacing) * 4);
    padding-block: calc(var(--spacing) * 4);
    border-block-end: calc(var(--spacing) * 0.25) solid var(--color-border);
  }

  .rule-list li:last-child {
    border-block-end: 0;
  }

  .nav-row {
    display: flex;
    flex-wrap: wrap;
    gap: calc(var(--spacing) * 3);
    width: min(1180px, calc(100% - 3rem));
    margin: clamp(4rem, 10vh, 8rem) auto 0;
    padding-block-end: clamp(3rem, 8vh, 6rem);
  }

  @media (max-width: 1120px) {
    .roadmap-grid,
    .truth-grid,
    .visual-grid {
      grid-template-columns: 1fr;
    }

    .rule-callout {
      position: static;
    }
  }

  @media (max-width: 640px) {
    .matrix-row,
    .rule-list li {
      grid-template-columns: 1fr;
      gap: calc(var(--spacing) * 2);
    }

    .tl-row {
      padding-inline-start: calc(var(--spacing) * 6);
    }
  }
`),
];
