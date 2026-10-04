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

  .package {
    position: relative;
    display: grid;
    gap: calc(var(--spacing) * 1);
    padding: calc(var(--spacing) * 3);
    overflow: hidden;
    border: calc(var(--spacing) * 0.25) solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-card);
  }

  .package::before {
    content: "";
    position: absolute;
    inset-block: 0;
    inset-inline-start: 0;
    width: calc(var(--spacing) * 1);
    background: var(--color-primary);
    opacity: .72;
  }

  .package__name {
    color: var(--color-primary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: var(--font-weight-extrabold);
    letter-spacing: 0;
  }

  .package__desc {
    color: var(--color-muted-foreground);
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
  }

  .visual--high .package {
    background:
      linear-gradient(135deg, color-mix(in srgb, color-mix(in srgb, var(--color-primary) 14%, transparent) 64%, transparent), transparent),
      var(--color-card);
  }

  .package--success .package__name {
    color: var(--color-success);
  }

  .package--success::before {
    background: var(--color-success);
  }

  .package--warning .package__name {
    color: var(--color-warning);
  }

  .package--warning::before {
    background: var(--color-warning);
  }

  .packages {
    display: grid;
    gap: calc(var(--spacing) * 3);
  }

  .package {
    grid-template-columns: minmax(0, .36fr) minmax(0, 1fr);
    align-items: start;
  }

  .visual--motion .package {
    animation: visual-lift 7s var(--ease-in-out) infinite alternate;
  }

  .visual--motion .package:nth-child(2) {
    animation-delay: 600ms;
  }

  .visual--motion .package:nth-child(3) {
    animation-delay: 1200ms;
  }

  @keyframes visual-lift {
    from {
      filter: brightness(1);
    }
    to {
      filter: brightness(1.12);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .visual--motion .package {
      animation: none;
    }
  }

  @media (max-width: 760px) {
    .package {
      grid-template-columns: 1fr;
    }
  }
`),
];
