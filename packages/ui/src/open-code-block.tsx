/**
 * @openelement/ui - open-code-block
 *
 * Code block with a copy button.
 *
 * Contract (shrunk in #1552): the component owns the copy interaction only —
 * it does NOT bundle, load, or invoke a tokenizer. Syntax highlighting is the
 * host page's build-time concern: fences are compiled to token-span HTML by
 * the site's markdown pipeline (e.g. Shiki) and project through the slot
 * untouched. The projected content stays light DOM, so the host's stylesheet
 * owns the code surface and token inks; this component only paints its chip.
 *
 * Compiled authoring: the shell (slot + copy button) is the compiled
 * template; the copy label is a compiled text sink driven by the `copyLabel`
 * property.
 *
 * @csspart copy - The copy button
 *
 * Usage:
 * ```html
 * <open-code-block>
 *   <pre><code>const x = 1;</code></pre>
 * </open-code-block>
 * ```
 */
import { element, OpenElement, property, type StyleSheetLike } from '@openelement/element';
import { CODE_BLOCK_CONSTANTS, log } from './component-recipes.ts';
import openCodeBlockStyles from './open-code-block.css';

@element('open-code-block', { root: 'shadow-open' })
export class OpenCodeBlock extends OpenElement {
  static override styles: StyleSheetLike[] = [openCodeBlockStyles];

  /** The copy button label — compiled text sink ('Copy'/'Copied!'/'Failed'). */
  @property({ reflect: false, attribute: false })
  copyLabel = 'Copy';

  render(): unknown {
    return (
      <div style='display:contents'>
        <slot></slot>
        <button type='button' class='copy-btn' part='copy' onClick={this.copy}>
          {this.copyLabel}
        </button>
      </div>
    );
  }

  /**
   * Copy text reads the slotted light DOM: token spans (if the host
   * highlighted at build time) concatenate to the exact source text.
   */
  private getCodeText(): string {
    return this.textContent || '';
  }

  private async copy(): Promise<void> {
    try {
      const text = this.getCodeText();
      await navigator.clipboard.writeText(text);
      this.copyLabel = 'Copied!';
      this._internals?.states.add('copied');
      this._internals?.states.delete('failed');
      this._setTimeout(() => {
        this.copyLabel = 'Copy';
        this._internals?.states.delete('copied');
      }, CODE_BLOCK_CONSTANTS.copyFeedbackMs);
    } catch (e) {
      log.warn('Clipboard write failed:', e);
      this.copyLabel = 'Failed';
      this._internals?.states.add('failed');
      this._internals?.states.delete('copied');
      this._setTimeout(() => {
        this.copyLabel = 'Copy';
        this._internals?.states.delete('failed');
      }, CODE_BLOCK_CONSTANTS.copyFeedbackMs);
    }
  }
}
