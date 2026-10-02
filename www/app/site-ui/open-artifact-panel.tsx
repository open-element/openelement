/** @jsxImportSource @openelement/element */
/** A private WWW frame for inspectable product evidence, never a UI export. */

import { element, OpenElement } from '@openelement/element';
import { compiledStyle } from './compiled-style.ts';

@element('open-artifact-panel')
export default class OpenArtifactPanel extends OpenElement {
  static override styles = [
    compiledStyle(`
  :host{display:block;min-width:0}.panel{position:relative;min-height:var(--artifact-min-height,220px);padding:calc(var(--spacing) * 5);overflow:hidden;border:1px solid color-mix(in srgb,var(--color-border) 74%,var(--color-primary));border-radius:var(--radius-lg);background:linear-gradient(145deg,color-mix(in srgb,var(--color-popover) 94%,color-mix(in srgb, var(--color-primary) 10%, var(--color-background))),var(--color-muted));box-shadow:inset 0 1px 0 var(--edge-highlight)}.panel::before{content:"";position:absolute;inset:0;pointer-events:none;opacity:.5;background:linear-gradient(90deg,color-mix(in srgb,var(--color-primary) 12%,transparent) 1px,transparent 1px),linear-gradient(color-mix(in srgb,var(--color-primary) 9%,transparent) 1px,transparent 1px);background-size:34px 34px;mask-image:linear-gradient(135deg,black,transparent 72%)}.head{position:relative;display:flex;gap:calc(var(--spacing) * 3);align-items:baseline;justify-content:space-between;padding-block-end:calc(var(--spacing) * 4);border-block-end:1px solid var(--color-border)}.label,.meta{margin:0;font-family:var(--font-mono);font-size:var(--text-xs);line-height:1.3;text-transform:uppercase}.label{color:var(--color-primary);font-weight:var(--font-weight-extrabold)}.meta{color:var(--color-muted-foreground);text-align:end}.body{position:relative;padding-block-start:calc(var(--spacing) * 5)}
`),
  ];
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
