/**
 * WTR pilot fixture (#1333): shadow-root event source.
 *
 * Mirrors the `activationProgram({ rootMode: 'shadow-open' })` shape used by
 * the simulated-DOM facade-activation tests (button + text part + click
 * handler), authored in the real compiled grammar so the official compiler
 * lowers it. Consumed only through compileElementModule; never executed
 * uncompiled.
 */
import { element, OpenElement, property } from '@openelement/element';

@element('wtr-shadow-button', { root: 'shadow-open' })
export class WtrShadowButton extends OpenElement {
  @property({ reflect: true })
  count = 0;

  increment(): void {
    this.count++;
  }

  render() {
    return <button type='button' onClick={this.increment}>Clicks: {this.count}</button>;
  }
}
