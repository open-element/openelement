import { compiledStyle } from './compiled-style.ts';

export const openStandardsVisualStyles = [compiledStyle(`
  :host {
    display: block;
  }

  * {
    box-sizing: border-box;
  }

  .visual {
    display: grid;
    gap: var(--size-4);
    color: var(--text-primary);
  }

  .visual--high {
    gap: var(--size-5);
  }

  .hero {
    display: grid;
    gap: var(--size-4);
  }

  .hero__top {
    display: grid;
    grid-template-columns: minmax(0, 1.12fr) minmax(0, .88fr);
    gap: var(--size-4);
  }

  .code {
    margin: 0;
    overflow: auto;
    color: var(--code-text);
    font-family: var(--font-mono);
    font-size: var(--font-size-00);
    line-height: var(--font-lineheight-4);
    white-space: pre-wrap;
  }

  .mark {
    color: var(--brand-light);
  }

  .spec {
    display: grid;
    gap: var(--size-3);
  }

  .spec__row,
  .route,
  .package,
  .token,
  .stage {
    position: relative;
    display: grid;
    gap: var(--size-1);
    padding: var(--size-3);
    overflow: hidden;
    border: var(--border-size-1) solid var(--border);
    border-radius: var(--radius-2);
    background: var(--bg-card);
  }

  .route::before,
  .package::before,
  .token::before,
  .stage::before {
    content: "";
    position: absolute;
    inset-block: 0;
    inset-inline-start: 0;
    width: var(--size-1);
    background: var(--brand);
    opacity: .72;
  }

  .spec__key,
  .route__path,
  .package__name,
  .token__name,
  .stage__num {
    color: var(--brand);
    font-family: var(--font-mono);
    font-size: var(--font-size-00);
    font-weight: var(--font-weight-8);
    letter-spacing: 0;
  }

  .spec__value,
  .route__desc,
  .package__desc,
  .token__desc,
  .stage__copy {
    color: var(--text-secondary);
    font-size: var(--font-size-0);
    line-height: var(--font-lineheight-3);
  }

  .pipeline {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: var(--size-2);
  }

  .stage {
    min-height: var(--size-16);
    background: color-mix(in srgb, var(--bg-card) 82%, var(--brand-subtle));
  }

  .visual--high .stage,
  .visual--high .route,
  .visual--high .package,
  .visual--high .token {
    background:
      linear-gradient(135deg, color-mix(in srgb, var(--brand-subtle) 64%, transparent), transparent),
      var(--bg-card);
  }

  .stage--success .stage__num,
  .package--success .package__name {
    color: var(--success);
  }

  .stage--success::before,
  .package--success::before {
    background: var(--success);
  }

  .stage--warning .stage__num,
  .package--warning .package__name {
    color: var(--warning);
  }

  .stage--warning::before,
  .package--warning::before {
    background: var(--warning);
  }

  .routes,
  .packages,
  .tokens {
    display: grid;
    gap: var(--size-3);
  }

  .route {
    grid-template-columns: minmax(0, .44fr) minmax(0, 1fr);
    align-items: start;
  }

  .package {
    grid-template-columns: minmax(0, .36fr) minmax(0, 1fr);
    align-items: start;
  }

  .tokens {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .token__swatch {
    width: var(--size-8);
    height: var(--size-5);
    border-radius: var(--radius-1);
    border: var(--border-size-1) solid var(--border);
    background: var(--bg-card);
  }

  .token--brand .token__swatch { background: var(--brand); }
  .token--success .token__swatch { background: var(--success); }
  .token--warning .token__swatch { background: var(--warning); }
  .token--info .token__swatch { background: var(--info); }
  .token--surface .token__swatch { background: var(--bg-elevated); }
  .token--code .token__swatch { background: var(--bg-code, var(--gray-11)); }

  .matrix {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--size-3);
  }

  .visual--motion .stage,
  .visual--motion .route,
  .visual--motion .package,
  .visual--motion .token {
    animation: visual-lift 7s var(--ease-2) infinite alternate;
  }

  .visual--motion .stage:nth-child(2),
  .visual--motion .route:nth-child(2),
  .visual--motion .package:nth-child(2),
  .visual--motion .token:nth-child(2) {
    animation-delay: 600ms;
  }

  .visual--motion .stage:nth-child(3),
  .visual--motion .route:nth-child(3),
  .visual--motion .package:nth-child(3),
  .visual--motion .token:nth-child(3) {
    animation-delay: 1200ms;
  }

  .visual--motion .code {
    animation: visual-code 8s var(--ease-1) infinite alternate;
  }

  @keyframes visual-lift {
    from {
      filter: brightness(1);
    }
    to {
      filter: brightness(1.12);
    }
  }

  @keyframes visual-code {
    from {
      color: var(--code-text);
    }
    to {
      color: var(--brand-light);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .visual--motion .stage,
    .visual--motion .route,
    .visual--motion .package,
    .visual--motion .token,
    .visual--motion .code {
      animation: none;
    }
  }

  @media (max-width: 760px) {
    .hero__top,
    .pipeline,
    .route,
    .package,
    .tokens,
    .matrix {
      grid-template-columns: 1fr;
    }
  }
`)];
