/** @jsxImportSource @openelement/element */
/**
 * www/site-ui - open-lab-stage
 *
 * Kinetic standards-lab hero primitive for product-art landing pages.
 */

import { computed, element, OpenElement, property } from '@openelement/element';
import { compiledStyle } from './compiled-style.ts';

@element('open-lab-stage')
export default class OpenLabStage extends OpenElement {
  static override styles = [compiledStyle(`
  :host {
    display: block;
  }

  * {
    box-sizing: border-box;
  }

  .stage {
    position: relative;
    display: grid;
    min-height: var(--lab-stage-min-height, 640px);
    overflow: hidden;
    isolation: isolate;
    border: var(--border-size-1) solid var(--code-border);
    border-radius: var(--radius-2);
    background:
      linear-gradient(135deg, color-mix(in srgb, var(--brand) 24%, transparent), transparent),
      linear-gradient(225deg, color-mix(in srgb, var(--success) 18%, transparent), transparent),
      var(--bg-code);
    color: var(--code-text);
    box-shadow: var(--shadow-1);
  }

  .stage--high {
    min-height: var(--lab-stage-min-height, 680px);
  }

  .stage--normal {
    min-height: var(--lab-stage-min-height, 560px);
  }

  .stage__grid,
  .stage__beams,
  .stage__scan {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .stage__grid {
    background:
      linear-gradient(color-mix(in srgb, var(--code-border) 56%, transparent) var(--border-size-1), transparent var(--border-size-1)),
      linear-gradient(90deg, color-mix(in srgb, var(--code-border) 56%, transparent) var(--border-size-1), transparent var(--border-size-1));
    background-size: var(--size-10) var(--size-10);
    mask-image: linear-gradient(to bottom, transparent, var(--bg-code) 18%, var(--bg-code) 82%, transparent);
    opacity: .42;
    z-index: -2;
  }

  .stage__beams {
    background:
      linear-gradient(112deg, transparent 0 31%, color-mix(in srgb, var(--brand-light) 20%, transparent) 31% 32%, transparent 32% 100%),
      linear-gradient(68deg, transparent 0 58%, color-mix(in srgb, var(--success) 16%, transparent) 58% 59%, transparent 59% 100%),
      linear-gradient(92deg, transparent 0 72%, color-mix(in srgb, var(--warning) 12%, transparent) 72% 73%, transparent 73% 100%);
    opacity: .74;
    z-index: -1;
  }

  .stage__scan {
    background:
      linear-gradient(90deg, transparent, color-mix(in srgb, var(--brand-light) 22%, transparent), transparent),
      linear-gradient(180deg, transparent, color-mix(in srgb, var(--success) 14%, transparent), transparent);
    opacity: .72;
    transform: translateX(calc(var(--size-16) * -1));
    z-index: 0;
  }

  .stage__body {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, .78fr) minmax(0, 1.22fr);
    gap: var(--size-4);
    align-items: stretch;
    padding: var(--size-4);
    z-index: 1;
  }

  .stage__browser,
  .stage__side,
  .stage__rail,
  .stage__node {
    border: var(--border-size-1) solid var(--code-border);
    border-radius: var(--radius-2);
    background: color-mix(in srgb, var(--bg-code) 86%, var(--bg-card));
  }

  .stage__browser {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 100%;
    overflow: hidden;
    box-shadow: var(--shadow-1);
  }

  .stage__bar {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: var(--size-3);
    align-items: center;
    min-width: 0;
    padding: var(--size-3) var(--size-4);
    border-bottom: var(--border-size-1) solid var(--code-border);
    background: color-mix(in srgb, var(--bg-code) 82%, var(--code-border));
  }

  .stage__lights {
    display: inline-flex;
    gap: var(--size-2);
  }

  .stage__light {
    width: var(--size-2);
    height: var(--size-2);
    border-radius: var(--radius-round);
    background: var(--brand);
  }

  .stage__light:nth-child(2) {
    background: var(--warning);
  }

  .stage__light:nth-child(3) {
    background: var(--success);
  }

  .stage__url,
  .stage__tag,
  .stage__label,
  .stage__meta,
  .stage__path,
  .stage__code {
    font-family: var(--font-mono);
    letter-spacing: 0;
  }

  .stage__url {
    min-width: 0;
    overflow: hidden;
    color: color-mix(in srgb, var(--code-text) 62%, transparent);
    font-size: var(--font-size-00);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .stage__tag {
    color: var(--success);
    font-size: var(--font-size-00);
    font-weight: var(--font-weight-8);
    text-transform: uppercase;
  }

  .stage__viewport {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    gap: var(--size-4);
    min-width: 0;
    padding: var(--size-4);
  }

  .stage__headline {
    margin: 0;
    color: var(--code-text);
    font-size: var(--font-size-6);
    line-height: var(--font-lineheight-1);
    letter-spacing: 0;
  }

  .stage__copy {
    max-width: 46ch;
    margin: var(--size-3) 0 0;
    color: color-mix(in srgb, var(--code-text) 76%, transparent);
    font-size: var(--font-size-0);
    line-height: var(--font-lineheight-3);
  }

  .stage__map {
    position: relative;
    display: grid;
    min-height: 180px;
    align-items: center;
    padding: var(--size-4);
  }

  .stage__rail {
    position: absolute;
    height: var(--border-size-2);
    background: color-mix(in srgb, var(--brand-light) 46%, transparent);
    border: 0;
  }

  .stage__rail--one {
    inset-inline: var(--size-8) var(--size-16);
    top: 38%;
  }

  .stage__rail--two {
    inset-inline: var(--size-16) var(--size-8);
    top: 63%;
    background: color-mix(in srgb, var(--success) 46%, transparent);
  }

  .stage__nodes {
    position: relative;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--size-4);
  }

  .stage__node {
    display: grid;
    gap: var(--size-2);
    min-height: 104px;
    padding: var(--size-3);
  }

  .stage__node:nth-child(2) {
    transform: translateY(var(--size-7));
  }

  .stage__node:nth-child(3) {
    transform: translateY(calc(var(--size-4) * -1));
  }

  .stage__label {
    color: var(--brand-light);
    font-size: var(--font-size-00);
    font-weight: var(--font-weight-8);
    text-transform: uppercase;
  }

  .stage__meta {
    align-self: end;
    color: color-mix(in srgb, var(--code-text) 62%, transparent);
    font-size: var(--font-size-00);
  }

  .stage__dock {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--size-3);
  }

  .stage__dock-item {
    display: grid;
    gap: var(--size-1);
    padding: var(--size-3);
    border: var(--border-size-1) solid var(--code-border);
    border-radius: var(--radius-1);
    background: color-mix(in srgb, var(--bg-code) 78%, var(--code-border));
  }

  .stage__path {
    color: var(--warning);
    font-size: var(--font-size-00);
    font-weight: var(--font-weight-8);
  }

  .stage__dock-item span:last-child {
    color: color-mix(in srgb, var(--code-text) 62%, transparent);
    font-size: var(--font-size-00);
  }

  .stage__side {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    gap: var(--size-4);
    min-width: 0;
    padding: var(--size-4);
  }

  .stage__panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--size-3);
    padding-block-end: var(--size-3);
    border-bottom: var(--border-size-1) solid var(--code-border);
  }

  .stage__panel-head strong {
    color: var(--code-text);
    font-size: var(--font-size-1);
    letter-spacing: 0;
  }

  .stage__panel-head span {
    color: color-mix(in srgb, var(--code-text) 58%, transparent);
    font-family: var(--font-mono);
    font-size: var(--font-size-00);
  }

  .stage__code {
    display: grid;
    gap: var(--size-2);
    align-content: start;
    margin: 0;
    overflow: hidden;
    color: var(--code-text);
    font-size: var(--font-size-00);
    line-height: var(--font-lineheight-4);
    white-space: pre-wrap;
  }

  .stage__code-line {
    display: block;
    padding: var(--size-1) var(--size-2);
    border-radius: var(--radius-1);
    background: color-mix(in srgb, var(--bg-code) 82%, var(--code-border));
  }

  .stage__code-line:nth-child(2),
  .stage__code-line:nth-child(5) {
    color: var(--brand-light);
  }

  .stage__spec {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--size-3);
  }

  .stage__spec-item {
    display: grid;
    gap: var(--size-1);
    padding: var(--size-3);
    border: var(--border-size-1) solid var(--code-border);
    border-radius: var(--radius-1);
  }

  .stage__spec-item strong {
    color: var(--success);
    font-family: var(--font-mono);
    font-size: var(--font-size-00);
    letter-spacing: 0;
    text-transform: uppercase;
  }

  .stage__spec-item span {
    color: color-mix(in srgb, var(--code-text) 64%, transparent);
    font-size: var(--font-size-00);
    line-height: var(--font-lineheight-3);
  }

  .stage--motion .stage__scan {
    animation: lab-scan 9s var(--ease-2) infinite alternate;
  }

  .stage--motion .stage__beams {
    animation: lab-beams 12s var(--ease-2) infinite alternate;
  }

  .stage--motion .stage__node {
    animation: lab-float 7s var(--ease-1) infinite alternate;
  }

  .stage--motion .stage__node:nth-child(2) {
    animation-delay: 800ms;
  }

  .stage--motion .stage__node:nth-child(3) {
    animation-delay: 1400ms;
  }

  .stage--motion .stage__code-line {
    animation: lab-code 8s var(--ease-2) infinite alternate;
  }

  .stage--still .stage__scan,
  .stage--still .stage__beams,
  .stage--still .stage__node,
  .stage--still .stage__code-line {
    animation: none;
  }

  :host(:hover) .stage--motion .stage__browser {
    transform: translateY(calc(var(--size-1) * -1));
  }

  :host(:hover) .stage--motion .stage__side {
    transform: translateY(var(--size-1));
  }

  .stage__browser,
  .stage__side {
    transition: transform var(--duration-2) var(--ease-2);
  }

  @keyframes lab-scan {
    from {
      transform: translateX(calc(var(--size-16) * -1));
    }
    to {
      transform: translateX(var(--size-16));
    }
  }

  @keyframes lab-beams {
    from {
      transform: translateX(calc(var(--size-8) * -1));
      opacity: .48;
    }
    to {
      transform: translateX(var(--size-8));
      opacity: .86;
    }
  }

  @keyframes lab-float {
    from {
      filter: brightness(1);
    }
    to {
      filter: brightness(1.22);
    }
  }

  @keyframes lab-code {
    from {
      background: color-mix(in srgb, var(--bg-code) 82%, var(--code-border));
    }
    to {
      background: color-mix(in srgb, var(--brand) 18%, transparent);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .stage--motion .stage__scan,
    .stage--motion .stage__beams,
    .stage--motion .stage__node,
    .stage--motion .stage__code-line {
      animation: none;
    }

    :host(:hover) .stage--motion .stage__browser,
    :host(:hover) .stage--motion .stage__side {
      transform: none;
    }
  }

  @media (max-width: 860px) {
    .stage {
      min-height: auto;
    }

    .stage__body,
    .stage__spec {
      grid-template-columns: 1fr;
    }

    .stage__viewport {
      gap: var(--size-3);
      padding: var(--size-3);
    }

    .stage__headline {
      font-size: var(--font-size-3);
    }

    .stage__copy,
    .stage__dock {
      display: none;
    }

    .stage__map {
      min-height: 132px;
      padding: var(--size-3);
    }

    .stage__nodes {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: var(--size-2);
    }

    .stage__side {
      display: none;
    }

    .stage__node,
    .stage__node:nth-child(2),
    .stage__node:nth-child(3) {
      min-height: auto;
      padding: var(--size-2);
      transform: none;
    }

    .stage__rail {
      display: none;
    }
  }
`)];

  @property({ reflect: true })
  motion = 'auto';
  @property({ reflect: true })
  emphasis = 'high';
  @property({ reflect: true })
  version = '';
  @property({ reflect: false, attribute: false })
  stageClass = computed(() =>
    `stage stage--${this.emphasis === 'normal' ? 'normal' : 'high'} stage--${
      this.motion === 'off' ? 'still' : 'motion'
    }`
  );

  render() {
    return (
      <section className={this.stageClass} part='stage'>
        <div className='stage__grid' aria-hidden='true'></div>
        <div className='stage__beams' aria-hidden='true'></div>
        <div className='stage__scan' aria-hidden='true'></div>
        <div className='stage__body'>
          <article className='stage__browser' aria-label='Browser standards lab'>
            <header className='stage__bar'>
              <span className='stage__lights' aria-hidden='true'>
                <span className='stage__light'></span>
                <span className='stage__light'></span>
                <span className='stage__light'></span>
              </span>
              <span className='stage__url'>openelement.org/app/routes/index.tsx</span>
              <span className='stage__tag'>DSD</span>
            </header>
            <div className='stage__viewport'>
              <div>
                <h2 className='stage__headline'>
                  Platform HTML. Precise islands. Public contracts.
                </h2>
                <p className='stage__copy'>
                  A full-stack framework surface built from native custom elements, route graphs,
                  and standards-first rendering evidence.
                </p>
              </div>
              <div className='stage__map' aria-label='Route and island diagram'>
                <span className='stage__rail stage__rail--one'></span>
                <span className='stage__rail stage__rail--two'></span>
                <div className='stage__nodes'>
                  <div className='stage__node'>
                    <span className='stage__label'>route</span>
                    <span className='stage__meta'>/guide/getting-started</span>
                  </div>
                  <div className='stage__node'>
                    <span className='stage__label'>render</span>
                    <span className='stage__meta'>declarative shadow DOM</span>
                  </div>
                  <div className='stage__node'>
                    <span className='stage__label'>island</span>
                    <span className='stage__meta'>hydrate only behavior</span>
                  </div>
                </div>
              </div>
              <div className='stage__dock'>
                <div className='stage__dock-item'>
                  <span className='stage__path'>Elements</span>
                  <span>custom element runtime</span>
                </div>
                <div className='stage__dock-item'>
                  <span className='stage__path'>UI</span>
                  <span>Open Props primitives</span>
                </div>
                <div className='stage__dock-item'>
                  <span className='stage__path'>Framework</span>
                  <span>routes, APIs, content</span>
                </div>
                <div className='stage__dock-item'>
                  <span className='stage__path'>Protocols</span>
                  <span>public package contracts</span>
                </div>
              </div>
            </div>
          </article>

          <aside className='stage__side' aria-label='Specification sheet'>
            <div className='stage__panel-head'>
              <strong>Spec sheet</strong>
              <span>{this.version}</span>
            </div>
            <pre className='stage__code'><code>
              <span className='stage__code-line'>export default app({'{'}</span>
              <span className='stage__code-line'>  render: 'declarative-shadow-dom',</span>
              <span className='stage__code-line'>  routes: './app/routes',</span>
              <span className='stage__code-line'>  islands: 'interaction-only',</span>
              <span className='stage__code-line'>  api: 'hono',</span>
              <span className='stage__code-line'>{'}'});</span>
            </code></pre>
            <div className='stage__spec'>
              <div className='stage__spec-item'>
                <strong>HTML</strong>
                <span>DSD first rendering target</span>
              </div>
              <div className='stage__spec-item'>
                <strong>API</strong>
                <span>routes beside pages</span>
              </div>
              <div className='stage__spec-item'>
                <strong>Tokens</strong>
                <span>Open Props semantic roles</span>
              </div>
              <div className='stage__spec-item'>
                <strong>CI</strong>
                <span>AutoFlow verified gates</span>
              </div>
            </div>
          </aside>
        </div>
      </section>
    );
  }
}
