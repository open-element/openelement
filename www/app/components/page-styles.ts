/**
 * Shared page styles for site documentation routes.
 *
 * Scope: docs typography, prose width, code, tables, callouts, and simple
 * content navigation. Product components still come from @openelement/ui.
 */
import '#site-ui/open-reading-shell.tsx';
import '#site-ui/open-artifact-panel.tsx';
import '../islands/open-page-rail.tsx';

/**
 * Shared masthead block: clamp padding + violet-6 grid backdrop. Used by the
 * blog index, contributing, and docs landing routes, which interpolate it
 * into their own route sheets.
 */
export const mastheadStyles = `
  .masthead {
    position: relative;
    isolation: isolate;
    padding: clamp(4rem, 11vh, 8rem) clamp(1.5rem, 5vw, 4.5rem) clamp(2.5rem, 6vh, 4.5rem);
  }

  .masthead::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    background-image:
      linear-gradient(color-mix(in srgb, var(--color-primary) 7%, transparent) 1px, transparent 1px),
      linear-gradient(90deg, color-mix(in srgb, var(--color-primary) 7%, transparent) 1px, transparent 1px);
    background-size: 72px 72px;
    mask-image: linear-gradient(180deg, black, transparent);
  }
`;

export const pageStyles = `
  :host {
    display: block;
    --content-width: var(--site-container-reading);
    --content-max-width: var(--site-container);
    --toc-width: 228px;
    --underline-offset: 3px;
    color: var(--color-foreground);
  }

  * {
    box-sizing: border-box;
  }

  .container {
    position: relative;
    max-width: var(--content-width);
    margin: 0 auto;
    padding: clamp(2rem, 5vh, 3.5rem) calc(var(--spacing) * 6) clamp(6rem, 14vh, 11rem);
    overflow-wrap: break-word;
    word-break: normal;
    background: linear-gradient(90deg, transparent, color-mix(in srgb, color-mix(in srgb, var(--color-primary) 16%, var(--color-background)) 20%, transparent), transparent) top / 100% 1px no-repeat;
  }

  img {
    max-width: 100%;
    height: auto;
    border-radius: var(--radius-lg);
  }

  .table-wrap {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    margin: calc(var(--spacing) * 4) 0;
  }

  h1 {
    font-size: clamp(2.7rem, 6vw, 5.5rem);
    font-weight: var(--font-weight-black);
    letter-spacing: -.06em;
    margin: 0 0 calc(var(--spacing) * 4);
    color: var(--color-foreground);
    line-height: 1.05;
  }

  h2 {
    font-size: var(--text-4xl);
    font-weight: var(--font-weight-extrabold);
    letter-spacing: 0;
    margin: calc(var(--spacing) * 10) 0 calc(var(--spacing) * 4);
    color: var(--color-foreground);
    padding-bottom: calc(var(--spacing) * 2);
    border-bottom: 1px solid var(--color-border);
    line-height: 1.12;
  }

  h3 {
    font-size: var(--text-3xl);
    font-weight: var(--font-weight-bold);
    letter-spacing: 0;
    margin: calc(var(--spacing) * 6) 0 calc(var(--spacing) * 2);
    color: var(--color-foreground);
    line-height: 1.22;
  }

  h4 {
    font-size: var(--text-2xl);
    font-weight: var(--font-weight-semibold);
    margin: calc(var(--spacing) * 4) 0 calc(var(--spacing) * 2);
    color: var(--color-foreground);
    line-height: 1.3;
  }

  h5,
  h6 {
    font-size: var(--text-base);
    font-weight: var(--font-weight-semibold);
    margin: calc(var(--spacing) * 3) 0 calc(var(--spacing) * 1);
    color: var(--color-muted-foreground);
    line-height: 1.35;
  }

  .subtitle {
    color: var(--color-muted-foreground);
    margin-bottom: calc(var(--spacing) * 10);
    font-size: var(--text-xl);
    line-height: 1.7;
    max-width: 680px;
  }

  p {
    line-height: 1.72;
    margin: calc(var(--spacing) * 2) 0;
    color: var(--color-foreground);
    font-size: var(--text-base);
  }

  /* Subject-side :lang — @scope'd sheets cannot match the html[lang] ancestor. */
  p:lang(zh),
  li:lang(zh) {
    line-height: 1.9;
  }

  strong {
    color: var(--color-foreground);
    font-weight: var(--font-weight-bold);
  }

  em {
    font-family: var(--font-serif);
    font-style: italic;
  }

  a {
    color: var(--color-primary);
    text-decoration: underline;
    text-underline-offset: var(--underline-offset);
    text-decoration-color: color-mix(in srgb, var(--color-primary) 34%, transparent);
    text-decoration-thickness: 1px;
    transition: color cubic-bezier(0.45, 0, 0.25, 1) 200ms, text-decoration-color cubic-bezier(0.45, 0, 0.25, 1) 200ms;
  }

  a:hover {
    color: color-mix(in srgb, var(--color-primary) 90%, transparent);
    text-decoration-color: currentColor;
  }

  .section-label {
    font-size: var(--text-xs);
    font-weight: var(--font-weight-extrabold);
    color: var(--color-primary);
    text-transform: uppercase;
    letter-spacing: 0;
    margin-bottom: calc(var(--spacing) * 3);
  }

  .section-divider {
    border: none;
    height: 1px;
    background: var(--color-border);
    margin: calc(var(--spacing) * 10) 0;
  }

  pre,
  /* The vendored Prism sheet ships a light pre[class*=language-] background
     that would win on specificity if a fence ever put the language class on
     pre; pin the real code surface here so that pairing cannot render. */
  pre[class*=language-] {
    background: var(--color-muted);
    color: var(--color-muted-foreground);
    padding: calc(var(--spacing) * 5) calc(var(--spacing) * 6);
    border-radius: var(--radius-lg);
    overflow-x: auto;
    font-size: var(--text-sm);
    line-height: 1.7;
    margin: calc(var(--spacing) * 4) 0;
    border: 1px solid var(--color-border);
    box-shadow: none;
  }

  code {
    font-family: var(--font-mono);
  }

  p code,
  li code,
  .inline-code {
    background: color-mix(in srgb, var(--color-primary) 14%, transparent);
    padding: 0.14rem 0.36rem;
    border-radius: var(--radius-md);
    font-size: var(--text-xs);
    color: var(--color-primary);
    border: 1px solid color-mix(in srgb, var(--color-primary) 18%, var(--color-border));
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin: calc(var(--spacing) * 3) 0 calc(var(--spacing) * 6);
    font-size: var(--text-sm);
    background: var(--color-card);
  }

  th,
  td {
    border: 1px solid var(--color-border);
    padding: calc(var(--spacing) * 2) calc(var(--spacing) * 3);
    text-align: left;
    vertical-align: top;
  }

  th {
    font-weight: var(--font-weight-bold);
    color: var(--color-foreground);
    background: var(--color-muted);
  }

  td {
    color: var(--color-muted-foreground);
  }

  tr:nth-child(even) td {
    background: color-mix(in srgb, var(--color-muted) 72%, transparent);
  }

  .callout,
  .pillar {
    padding: calc(var(--spacing) * 4) calc(var(--spacing) * 5);
    margin: calc(var(--spacing) * 4) 0;
    border: 1px solid var(--color-border);
    border-left: 5px solid var(--color-primary);
    background: var(--color-card);
    border-radius: var(--radius-lg);
  }

  .callout.warn {
    border-left-color: var(--color-warning);
  }

  .callout.info {
    border-left-color: var(--color-info);
  }

  .pillar .num {
    font-size: var(--text-xs);
    font-weight: var(--font-weight-extrabold);
    text-transform: uppercase;
    letter-spacing: 0;
    color: var(--color-primary);
    margin-bottom: calc(var(--spacing) * 1);
  }

  .pillar h3 {
    margin: 0 0 calc(var(--spacing) * 2);
  }

  .hard-constraint {
    display: inline-block;
    background: color-mix(in srgb, var(--color-primary) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-primary) 18%, var(--color-border));
    color: var(--color-primary);
    padding: calc(var(--spacing) * 1) calc(var(--spacing) * 2);
    border-radius: var(--radius-md);
    font-size: var(--text-xs);
    margin: calc(var(--spacing) * 1) 0;
  }

  ul,
  ol {
    padding-left: calc(var(--spacing) * 5);
    color: var(--color-muted-foreground);
    line-height: 1.7;
    font-size: var(--text-base);
  }

  li {
    margin: calc(var(--spacing) * 1) 0;
  }

  .nav-row {
    margin-top: calc(var(--spacing) * 10);
    padding-top: calc(var(--spacing) * 4);
    border-top: 1px solid var(--color-border);
    display: flex;
    justify-content: space-between;
    gap: calc(var(--spacing) * 3);
  }

  .nav-row open-button {
    text-decoration: none;
  }

  .content-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) var(--toc-width);
    gap: calc(var(--spacing) * 8);
    align-items: start;
    max-width: var(--content-max-width);
    margin: 0 auto;
    padding: calc(var(--spacing) * 6) calc(var(--spacing) * 4);
  }

  .content-grid .container {
    max-width: none;
    margin: 0;
    padding: 0;
  }

  @media (max-width: 1100px) {
    .content-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 900px) {
    .container {
      padding: calc(var(--spacing) * 8) calc(var(--spacing) * 5) calc(var(--spacing) * 12);
    }

    h1 {
      font-size: var(--text-5xl);
    }

    h2 {
      font-size: var(--text-3xl);
    }

    .subtitle {
      margin-bottom: calc(var(--spacing) * 8);
      font-size: var(--text-base);
    }

    p {
      font-size: var(--text-sm);
    }

    pre {
      padding: calc(var(--spacing) * 4) calc(var(--spacing) * 5);
      font-size: var(--text-xs);
    }

    .nav-row {
      flex-direction: column;
    }
  }

  @media (max-width: 480px) {
    .container {
      padding: calc(var(--spacing) * 6) calc(var(--spacing) * 4) calc(var(--spacing) * 10);
    }

    h1 {
      font-size: var(--text-4xl);
    }

    h2 {
      font-size: var(--text-2xl);
    }

    p,
    ul,
    ol {
      font-size: var(--text-sm);
    }

    ul,
    ol {
      padding-left: calc(var(--spacing) * 4);
    }
  }

  :focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: 3px;
  }

  @media (prefers-reduced-motion: reduce) {
    a {
      transition: none;
    }
  }
`;
