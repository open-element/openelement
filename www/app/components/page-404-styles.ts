import { compiledStyle } from '../site-ui/compiled-style.ts';

export const page404Styles = [
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

  .stage {
    position: relative;
    isolation: isolate;
    display: grid;
    justify-items: center;
    align-content: center;
    gap: calc(var(--spacing) * 5);
    min-height: calc(100svh - var(--nav-height) - calc(var(--spacing) * 12));
    padding: clamp(3rem, 8vh, 6rem) calc(var(--spacing) * 6);
    text-align: center;
    background:
      radial-gradient(circle at 50% 42%, color-mix(in srgb, var(--color-primary) 18%, transparent), transparent 55%),
      var(--color-background);
  }

  .stage::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    background-image:
      linear-gradient(color-mix(in srgb, var(--color-primary) 7%, transparent) 1px, transparent 1px),
      linear-gradient(90deg, color-mix(in srgb, var(--color-primary) 7%, transparent) 1px, transparent 1px);
    background-size: 72px 72px;
    mask-image: radial-gradient(circle at 50% 45%, black, transparent 75%);
  }

  .code {
    display: flex;
    font-family: var(--font-mono);
    font-size: clamp(9rem, 26vw, 24rem);
    font-weight: 800;
    line-height: 0.9;
    letter-spacing: -0.06em;
    color: transparent;
    -webkit-text-stroke: 1.5px color-mix(in srgb, var(--color-primary) 55%, transparent);
    user-select: none;
  }

  .code .solid {
    color: var(--color-foreground);
    -webkit-text-stroke: 0;
  }

  .serif-line {
    font-family: var(--font-serif);
    font-style: italic;
    font-weight: 400;
    font-size: clamp(2rem, 5vw, 4rem);
    letter-spacing: -0.01em;
    color: var(--color-primary);
  }

  .lede {
    max-width: 34rem;
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: 1.75;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: calc(var(--spacing) * 3);
    margin-block-start: calc(var(--spacing) * 3);
  }

  /* Search hint: the header search listens globally and hydrates on this
     page, so the hint plus the curated links are the honest controls — a
     dedicated search island would tax every page's chunks (see page-404). */
  .search-hint {
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .popular {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: baseline;
    gap: calc(var(--spacing) * 2) calc(var(--spacing) * 4);
    margin-block-start: calc(var(--spacing) * 2);
  }

  .popular-label {
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .popular a {
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    text-decoration: none;
  }

  .popular a:hover {
    color: var(--color-primary);
    text-decoration: underline;
  }

  .marquee {
    overflow: hidden;
    white-space: nowrap;
    border-block: 1px solid var(--color-border);
    background: var(--surface-1);
  }

  .marquee span {
    display: inline-block;
    padding: calc(var(--spacing) * 3) 0;
    color: var(--color-primary);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-weight: var(--font-weight-medium);
    letter-spacing: 0.12em;
    animation: marquee 36s linear infinite;
  }

  @keyframes marquee {
    to {
      transform: translateX(-50%);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .marquee span {
      animation: none;
    }
  }
`),
];
