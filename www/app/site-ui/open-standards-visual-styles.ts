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
    gap: var(--size-4);
    color: var(--text-primary);
  }

  .visual--high {
    gap: var(--size-5);
  }

  .package {
    position: relative;
    display: grid;
    gap: var(--size-1);
    padding: var(--size-3);
    overflow: hidden;
    border: var(--border-size-1) solid var(--border);
    border-radius: var(--radius-2);
    background: var(--bg-card);
  }

  .package::before {
    content: "";
    position: absolute;
    inset-block: 0;
    inset-inline-start: 0;
    width: var(--size-1);
    background: var(--brand);
    opacity: .72;
  }

  .package__name {
    color: var(--brand);
    font-family: var(--font-mono);
    font-size: var(--font-size-00);
    font-weight: var(--font-weight-8);
    letter-spacing: 0;
  }

  .package__desc {
    color: var(--text-secondary);
    font-size: var(--font-size-0);
    line-height: var(--font-lineheight-3);
  }

  .visual--high .package {
    background:
      linear-gradient(135deg, color-mix(in srgb, var(--brand-subtle) 64%, transparent), transparent),
      var(--bg-card);
  }

  .package--success .package__name {
    color: var(--success);
  }

  .package--success::before {
    background: var(--success);
  }

  .package--warning .package__name {
    color: var(--warning);
  }

  .package--warning::before {
    background: var(--warning);
  }

  .packages {
    display: grid;
    gap: var(--size-3);
  }

  .package {
    grid-template-columns: minmax(0, .36fr) minmax(0, 1fr);
    align-items: start;
  }

  .visual--motion .package {
    animation: visual-lift 7s var(--ease-2) infinite alternate;
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
