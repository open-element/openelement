import { compiledStyle } from '../site-ui/compiled-style.ts';

export const page404Styles = [compiledStyle(`
  :host {
    display: block;
    color: var(--text-primary);
    background: var(--bg-base);
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
    gap: var(--size-5);
    min-height: calc(100svh - var(--nav-height) - var(--size-12));
    padding: clamp(3rem, 8vh, 6rem) var(--size-6);
    text-align: center;
    background:
      radial-gradient(circle at 50% 42%, color-mix(in srgb, var(--violet-5) 18%, transparent), transparent 55%),
      var(--bg-base);
  }

  .stage::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    background-image:
      linear-gradient(color-mix(in srgb, var(--violet-6) 7%, transparent) 1px, transparent 1px),
      linear-gradient(90deg, color-mix(in srgb, var(--violet-6) 7%, transparent) 1px, transparent 1px);
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
    -webkit-text-stroke: 1.5px color-mix(in srgb, var(--violet-5) 55%, transparent);
    user-select: none;
  }

  .code .solid {
    color: var(--text-primary);
    -webkit-text-stroke: 0;
  }

  .serif-line {
    font-family: var(--font-serif);
    font-style: italic;
    font-weight: 400;
    font-size: clamp(2rem, 5vw, 4rem);
    letter-spacing: -0.01em;
    color: var(--violet-8);
  }

  .lede {
    max-width: 34rem;
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: var(--font-size-0);
    line-height: 1.75;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--size-3);
    margin-block-start: var(--size-3);
  }

  .marquee {
    overflow: hidden;
    white-space: nowrap;
    border-block: 1px solid var(--border);
    background: var(--surface-1);
  }

  .marquee span {
    display: inline-block;
    padding: var(--size-3) 0;
    color: var(--brand);
    font-family: var(--font-mono);
    font-size: var(--font-size-0);
    font-weight: var(--font-weight-5);
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
`)];
