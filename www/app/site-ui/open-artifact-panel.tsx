/** @jsxImportSource @openelement/element */
/** A private WWW frame for inspectable product evidence, never a UI export. */

import { element, OpenElement } from '@openelement/element';
import { compiledStyle } from './compiled-style.ts';

@element('open-artifact-panel')
export default class OpenArtifactPanel extends OpenElement {
  static override styles = [compiledStyle(`
  :host{display:block;min-width:0}.panel{position:relative;min-height:var(--artifact-min-height,220px);padding:var(--size-5);overflow:hidden;border:1px solid color-mix(in srgb,var(--border) 74%,var(--brand));border-radius:var(--radius-2);background:linear-gradient(145deg,color-mix(in srgb,var(--bg-elevated) 94%,var(--violet-1)),var(--bg-surface));box-shadow:inset 0 1px 0 var(--edge-highlight)}.panel::before{content:"";position:absolute;inset:0;pointer-events:none;opacity:.5;background:linear-gradient(90deg,color-mix(in srgb,var(--brand) 12%,transparent) 1px,transparent 1px),linear-gradient(color-mix(in srgb,var(--brand) 9%,transparent) 1px,transparent 1px);background-size:34px 34px;mask-image:linear-gradient(135deg,black,transparent 72%)}.head{position:relative;display:flex;gap:var(--size-3);align-items:baseline;justify-content:space-between;padding-block-end:var(--size-4);border-block-end:1px solid var(--border)}.label,.meta{margin:0;font-family:var(--font-mono);font-size:var(--font-size-00);line-height:1.3;text-transform:uppercase}.label{color:var(--brand);font-weight:var(--font-weight-8)}.meta{color:var(--text-muted);text-align:end}.body{position:relative;padding-block-start:var(--size-5)}
`)];
  render() {
    return (
      <section class='panel'>
        <header class='head'>
          <p class='label'>
            <slot name='label'></slot>
          </p>
          <p class='meta'>
            <slot name='meta'></slot>
          </p>
        </header>
        <div class='body'>
          <slot></slot>
        </div>
      </section>
    );
  }
}
