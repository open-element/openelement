/** @jsxImportSource @openelement/element */
/** A private WWW frame for inspectable product evidence, never a UI export. */

import { element, OpenElement } from '@openelement/element';
import openArtifactPanelStyles from './open-artifact-panel.css';

@element('open-artifact-panel')
export default class OpenArtifactPanel extends OpenElement {
  static override styles = [openArtifactPanelStyles];
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
