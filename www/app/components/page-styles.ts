/**
 * Shared page styles for www documentation routes.
 *
 * Scope: docs typography, prose width, code, tables, callouts, and simple
 * content navigation. Product components still come from @openelement/ui.
 */
import '@openelement/site-ui/open-reading-shell.tsx';
import '@openelement/site-ui/open-artifact-panel.tsx';
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
      linear-gradient(color-mix(in srgb, var(--violet-6) 7%, transparent) 1px, transparent 1px),
      linear-gradient(90deg, color-mix(in srgb, var(--violet-6) 7%, transparent) 1px, transparent 1px);
    background-size: 72px 72px;
    mask-image: linear-gradient(180deg, black, transparent);
  }
`;

export const pageStyles = `
  :host {
    display: block;
    --content-width: 760px;
    --content-max-width: 1120px;
    --toc-width: 228px;
    --underline-offset: 3px;
    --border-hairline: 1px;
    color: var(--text-primary);
  }

  * {
    box-sizing: border-box;
  }

  .container {
    position: relative;
    max-width: var(--content-width);
    margin: 0 auto;
    padding: clamp(2rem, 5vh, 3.5rem) var(--size-6) clamp(6rem, 14vh, 11rem);
    overflow-wrap: break-word;
    word-break: normal;
    background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--violet-2) 20%, transparent), transparent) top / 100% 1px no-repeat;
  }

  img {
    max-width: 100%;
    height: auto;
    border-radius: var(--radius-2);
  }

  .table-wrap {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    margin: var(--size-4) 0;
  }

  h1 {
    font-size: clamp(2.7rem, 6vw, 5.5rem);
    font-weight: var(--font-weight-9);
    letter-spacing: -.06em;
    margin: 0 0 var(--size-4);
    color: var(--text-primary);
    line-height: 1.05;
  }

  h2 {
    font-size: var(--font-size-5);
    font-weight: var(--font-weight-8);
    letter-spacing: 0;
    margin: var(--size-10) 0 var(--size-4);
    color: var(--text-primary);
    padding-bottom: var(--size-2);
    border-bottom: var(--border-hairline) solid var(--border);
    line-height: 1.12;
  }

  h3 {
    font-size: var(--font-size-4);
    font-weight: var(--font-weight-7);
    letter-spacing: 0;
    margin: var(--size-6) 0 var(--size-2);
    color: var(--text-primary);
    line-height: 1.22;
  }

  h4 {
    font-size: var(--font-size-3);
    font-weight: var(--font-weight-6);
    margin: var(--size-4) 0 var(--size-2);
    color: var(--text-primary);
    line-height: 1.3;
  }

  h5,
  h6 {
    font-size: var(--font-size-1);
    font-weight: var(--font-weight-6);
    margin: var(--size-3) 0 var(--size-1);
    color: var(--text-secondary);
    line-height: 1.35;
  }

  .subtitle {
    color: var(--text-secondary);
    margin-bottom: var(--size-10);
    font-size: var(--font-size-2);
    line-height: 1.7;
    max-width: 680px;
  }

  p {
    line-height: 1.72;
    margin: var(--size-2) 0;
    color: var(--text-primary);
    font-size: var(--font-size-1);
  }

  strong {
    color: var(--text-primary);
    font-weight: var(--font-weight-7);
  }

  em {
    font-style: italic;
  }

  a {
    color: var(--brand);
    text-decoration: underline;
    text-underline-offset: var(--underline-offset);
    text-decoration-color: color-mix(in srgb, var(--brand) 34%, transparent);
    text-decoration-thickness: var(--border-size-1);
    transition: color var(--ease-2) var(--duration-2), text-decoration-color var(--ease-2) var(--duration-2);
  }

  a:hover {
    color: var(--brand-hover);
    text-decoration-color: currentColor;
  }

  .section-label {
    font-size: var(--font-size-00);
    font-weight: var(--font-weight-8);
    color: var(--brand);
    text-transform: uppercase;
    letter-spacing: 0;
    margin-bottom: var(--size-3);
  }

  .section-divider {
    border: none;
    height: 1px;
    background: var(--border);
    margin: var(--size-10) 0;
  }

  pre {
    background: var(--bg-code);
    color: var(--code-text);
    padding: var(--size-5) var(--size-6);
    border-radius: var(--radius-2);
    overflow-x: auto;
    font-size: var(--font-size-0);
    line-height: 1.7;
    margin: var(--size-4) 0;
    border: var(--border-hairline) solid var(--code-border);
    box-shadow: none;
  }

  code {
    font-family: var(--font-mono);
  }

  p code,
  li code,
  .inline-code {
    background: var(--brand-subtle);
    padding: 0.14rem 0.36rem;
    border-radius: var(--radius-1);
    font-size: var(--font-size-00);
    color: var(--brand);
    border: var(--border-hairline) solid color-mix(in srgb, var(--brand) 18%, var(--border));
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin: var(--size-3) 0 var(--size-6);
    font-size: var(--font-size-0);
    background: var(--bg-card);
  }

  th,
  td {
    border: var(--border-hairline) solid var(--border);
    padding: var(--size-2) var(--size-3);
    text-align: left;
    vertical-align: top;
  }

  th {
    font-weight: var(--font-weight-7);
    color: var(--text-primary);
    background: var(--bg-surface);
  }

  td {
    color: var(--text-secondary);
  }

  tr:nth-child(even) td {
    background: color-mix(in srgb, var(--bg-surface) 72%, transparent);
  }

  .callout,
  .pillar {
    padding: var(--size-4) var(--size-5);
    margin: var(--size-4) 0;
    border: var(--border-hairline) solid var(--border);
    border-left: var(--border-size-3) solid var(--brand);
    background: var(--bg-card);
    border-radius: var(--radius-2);
  }

  .callout.warn {
    border-left-color: var(--warning);
  }

  .callout.info {
    border-left-color: var(--info);
  }

  .pillar .num {
    font-size: var(--font-size-00);
    font-weight: var(--font-weight-8);
    text-transform: uppercase;
    letter-spacing: 0;
    color: var(--brand);
    margin-bottom: var(--size-1);
  }

  .pillar h3 {
    margin: 0 0 var(--size-2);
  }

  .hard-constraint {
    display: inline-block;
    background: var(--brand-subtle);
    border: var(--border-hairline) solid color-mix(in srgb, var(--brand) 18%, var(--border));
    color: var(--brand);
    padding: var(--size-1) var(--size-2);
    border-radius: var(--radius-1);
    font-size: var(--font-size-00);
    margin: var(--size-1) 0;
  }

  ul,
  ol {
    padding-left: var(--size-5);
    color: var(--text-secondary);
    line-height: 1.7;
    font-size: var(--font-size-1);
  }

  li {
    margin: var(--size-1) 0;
  }

  .nav-row {
    margin-top: var(--size-10);
    padding-top: var(--size-4);
    border-top: var(--border-hairline) solid var(--border);
    display: flex;
    justify-content: space-between;
    gap: var(--size-3);
  }

  .nav-row open-button {
    text-decoration: none;
  }

  .content-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) var(--toc-width);
    gap: var(--size-8);
    align-items: start;
    max-width: var(--content-max-width);
    margin: 0 auto;
    padding: var(--size-6) var(--size-4);
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
      padding: var(--size-8) var(--size-5) var(--size-12);
    }

    h1 {
      font-size: var(--font-size-6);
    }

    h2 {
      font-size: var(--font-size-4);
    }

    .subtitle {
      margin-bottom: var(--size-8);
      font-size: var(--font-size-1);
    }

    p {
      font-size: var(--font-size-0);
    }

    pre {
      padding: var(--size-4) var(--size-5);
      font-size: var(--font-size-00);
    }

    .nav-row {
      flex-direction: column;
    }
  }

  @media (max-width: 480px) {
    .container {
      padding: var(--size-6) var(--size-4) var(--size-10);
    }

    h1 {
      font-size: var(--font-size-5);
    }

    h2 {
      font-size: var(--font-size-3);
    }

    p,
    ul,
    ol {
      font-size: var(--font-size-0);
    }

    ul,
    ol {
      padding-left: var(--size-4);
    }
  }

  :focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    a {
      transition: none;
    }
  }
`;
