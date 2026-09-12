import { compiledStyle } from '../site-ui/compiled-style.ts';

export const pageRoadmapStyles = [compiledStyle(`
  :host {
    display: block;
    color: var(--text-primary);
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
    margin: var(--size-5) 0 var(--size-6);
    padding: var(--size-4) var(--size-5);
    border: var(--border-size-1) solid var(--border);
    border-inline-start: var(--size-1) solid var(--brand);
    border-radius: var(--radius-2);
  }

  .now-callout .now-title {
    margin: var(--size-3) 0 var(--size-2);
    color: var(--text-primary);
    font-weight: var(--font-weight-7);
    line-height: 1.3;
  }

  .now-callout .now-copy {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--font-size-0);
    line-height: var(--font-lineheight-3);
  }

  .metric-label,
  .rule-label,
  .rule-title {
    color: var(--brand);
    font-family: var(--font-mono);
    font-size: var(--font-size-00);
    font-weight: var(--font-weight-8);
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
    color: var(--text-secondary);
    font-size: var(--font-size-0);
    line-height: var(--font-lineheight-3);
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
    inset-block: var(--size-2);
    inset-inline-start: calc(var(--size-2) / 2);
    width: var(--border-size-1);
    background: var(--border);
  }

  .tl-row {
    position: relative;
    padding: var(--size-5) 0 var(--size-5) var(--size-8);
  }

  .tl-node {
    position: absolute;
    inset-inline-start: 0;
    inset-block-start: calc(var(--size-5) + var(--size-3));
    width: var(--size-2);
    height: var(--size-2);
  }

  .tl-stable .tl-node {
    background: var(--brand);
  }

  .tl-next .tl-node {
    border: var(--border-size-2) solid var(--violet-8);
    background: var(--bg-base);
  }

  .tl-next .tl-node::after {
    content: "";
    position: absolute;
    inset: var(--size-1);
    background: var(--violet-8);
  }

  .tl-planned .tl-node {
    border: var(--border-size-2) solid color-mix(in srgb, var(--violet-5) 55%, transparent);
  }

  .tl-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--size-3) var(--size-4);
  }

  .tl-version {
    color: var(--text-primary);
    font-size: clamp(2rem, 4.2vw, 3.6rem);
    font-weight: 800;
    line-height: 1;
    letter-spacing: -.03em;
  }

  .tl-next .tl-version {
    color: var(--violet-8);
  }

  .tl-planned .tl-version {
    color: transparent;
    -webkit-text-stroke: 1.5px color-mix(in srgb, var(--violet-5) 55%, transparent);
  }

  .tl-theme {
    color: var(--violet-8);
    font-family: var(--font-serif);
    font-size: clamp(1.25rem, 1.9vw, 1.7rem);
    font-style: italic;
    font-weight: 400;
  }

  .tl-planned .tl-theme {
    color: var(--violet-5);
  }

  .stamp {
    padding: var(--size-1) var(--size-3);
    border-radius: var(--radius-1);
    font-size: var(--font-size-00);
    font-weight: var(--font-weight-7);
    letter-spacing: .08em;
    text-transform: uppercase;
  }

  .stamp:empty,
  .tl-status:empty {
    display: none;
  }

  .stamp-current {
    background: var(--brand);
    color: var(--on-brand);
  }

  .stamp-next {
    border: var(--border-size-1) solid var(--violet-8);
    color: var(--violet-8);
  }

  .tl-status {
    color: var(--text-muted);
    font-size: var(--font-size-00);
    letter-spacing: .1em;
    text-transform: uppercase;
  }

  .tl-copy {
    max-width: 560px;
    margin-block: var(--size-3) 0;
  }

  .rule-callout {
    position: sticky;
    top: calc(var(--nav-height) + var(--size-6));
    padding: var(--size-5);
    border: var(--border-size-1) solid color-mix(in srgb, var(--violet-5) 45%, transparent);
    border-radius: var(--radius-2);
    background: var(--violet-0);
    box-shadow: inset var(--size-1) 0 0 var(--brand);
  }

  .rule-title {
    margin-block-end: var(--size-3);
    color: var(--violet-8);
  }

  .rule-text {
    margin-block-end: 0;
  }

  .truth-grid {
    display: grid;
    grid-template-columns: minmax(0, .95fr) minmax(0, .95fr) minmax(0, .72fr);
    gap: var(--size-5);
  }

  .truth h2 {
    margin-block: 0 var(--size-4);
    color: var(--text-primary);
    font-size: var(--font-size-3);
    line-height: 1.08;
    letter-spacing: 0;
  }

  .truth ul {
    display: grid;
    gap: var(--size-2);
    margin: 0;
    padding-inline-start: var(--size-5);
  }

  .matrix {
    display: grid;
    border-block-start: var(--border-size-1) solid var(--border);
  }

  .matrix-row {
    display: grid;
    grid-template-columns: minmax(132px, .28fr) minmax(0, 1fr);
    gap: var(--size-5);
    padding-block: var(--size-5);
    border-block-end: var(--border-size-1) solid var(--border);
  }

  .matrix-row:last-child {
    border-block-end: 0;
  }

  .visual-grid {
    display: grid;
    grid-template-columns: minmax(0, .88fr) minmax(0, 1fr);
    gap: var(--size-5);
  }

  .rule-list {
    display: grid;
    gap: var(--size-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .rule-list li {
    display: grid;
    grid-template-columns: minmax(110px, .32fr) minmax(0, 1fr);
    gap: var(--size-4);
    padding-block: var(--size-4);
    border-block-end: var(--border-size-1) solid var(--border);
  }

  .rule-list li:last-child {
    border-block-end: 0;
  }

  .nav-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--size-3);
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
      gap: var(--size-2);
    }

    .tl-row {
      padding-inline-start: var(--size-6);
    }
  }
`)];
