import { compiledStyle } from './compiled-style.ts';

export const openStandardsVisualStyles = [
  compiledStyle(`
  :host {
    display: block;
  }

  * {
    box-sizing: border-box;
  }

  .visual {
    display: grid;
    gap: calc(var(--spacing) * 4);
    color: var(--color-foreground);
  }

  .visual--high {
    gap: calc(var(--spacing) * 5);
  }

  .hero {
    display: grid;
    gap: calc(var(--spacing) * 4);
  }

  .hero__top {
    display: grid;
    grid-template-columns: minmax(0, 1.12fr) minmax(0, .88fr);
    gap: calc(var(--spacing) * 4);
  }

  .code {
    margin: 0;
    overflow: auto;
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.75;
    white-space: pre-wrap;
  }

  .mark {
    color: color-mix(in srgb, var(--color-primary) 55%, transparent);
  }

  .spec {
    display: grid;
    gap: calc(var(--spacing) * 3);
  }

  .spec__row,
  .route,
  .package,
  .token,
  .stage {
    position: relative;
    display: grid;
    gap: calc(var(--spacing) * 1);
    padding: calc(var(--spacing) * 3);
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-card);
  }

  .route::before,
  .package::before,
  .token::before,
  .stage::before {
    content: "";
    position: absolute;
    inset-block: 0;
    inset-inline-start: 0;
    width: calc(var(--spacing) * 1);
    background: var(--color-primary);
    opacity: .72;
  }

  .spec__key,
  .route__path,
  .package__name,
  .token__name,
  .stage__num {
    color: var(--color-primary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: var(--font-weight-extrabold);
    letter-spacing: 0;
  }

  .spec__value,
  .route__desc,
  .package__desc,
  .token__desc,
  .stage__copy {
    color: var(--color-muted-foreground);
    font-size: var(--text-sm);
    line-height: 1.5;
  }

  .pipeline {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: calc(var(--spacing) * 2);
  }

  .stage {
    min-height: calc(var(--spacing) * 16);
    background: color-mix(in srgb, var(--color-card) 82%, color-mix(in srgb, var(--color-primary) 14%, transparent));
  }

  .visual--high .stage,
  .visual--high .route,
  .visual--high .package,
  .visual--high .token {
    background:
      linear-gradient(135deg, color-mix(in srgb, color-mix(in srgb, var(--color-primary) 14%, transparent) 64%, transparent), transparent),
      var(--color-card);
  }

  .stage--success .stage__num,
  .package--success .package__name {
    color: var(--color-success);
  }

  .stage--success::before,
  .package--success::before {
    background: var(--color-success);
  }

  .stage--warning .stage__num,
  .package--warning .package__name {
    color: var(--color-warning);
  }

  .stage--warning::before,
  .package--warning::before {
    background: var(--color-warning);
  }

  .routes,
  .packages,
  .tokens {
    display: grid;
    gap: calc(var(--spacing) * 3);
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
    width: calc(var(--spacing) * 8);
    height: calc(var(--spacing) * 5);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    background: var(--color-card);
  }

  .token--brand .token__swatch { background: var(--color-primary); }
  .token--success .token__swatch { background: var(--color-success); }
  .token--warning .token__swatch { background: var(--color-warning); }
  .token--info .token__swatch { background: var(--color-info); }
  .token--surface .token__swatch { background: var(--color-popover); }
  .token--code .token__swatch { background: var(--color-muted); }

  .matrix {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: calc(var(--spacing) * 3);
  }

  .visual--motion .stage,
  .visual--motion .route,
  .visual--motion .package,
  .visual--motion .token {
    animation: visual-lift 7s cubic-bezier(0.45, 0, 0.25, 1) infinite alternate;
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
    animation: visual-code 8s cubic-bezier(0.25, 0, 0.5, 1) infinite alternate;
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
      color: var(--color-muted-foreground);
    }
    to {
      color: color-mix(in srgb, var(--color-primary) 55%, transparent);
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
`),
];
