/**
 * v0.44.0-alpha.0 compiler v1 fixture (#1160).
 *
 * This is the exact TSX grammar recognized by the open:compiled-element v1
 * transform. The file is transformed through the Vite plugin hook; it is never
 * executed directly. The intrinsics are canonical named imports - the
 * compile-time-only element/property bindings are stripped from generated
 * output (the canonical decorator contract is owned by #1162).
 */
import { element, OpenElement, property } from '@openelement/element';

@element('oe-program-counter')
export class ProgramCounter extends OpenElement {
  @property({ reflect: true })
  count = 0;

  @property({ reflect: false })
  label = 'ready';

  @property({ reflect: false })
  items: Array<{ id: string; text: string }> = [{ id: 'a', text: 'alpha' }, {
    id: 'b',
    text: 'beta',
  }];

  increment(): void {
    this.count++;
  }

  render() {
    return (
      <div class='proof'>
        <h1>Count: {this.count}</h1>
        <input value={this.label} />
        <button type='button' onClick={this.increment}>+</button>
        {this.count > 0 ? <p class='parity'>positive</p> : <p class='parity'>zero</p>}
        <ul>{this.items.map((item) => <li key={item.id}>{item.text}</li>)}</ul>
      </div>
    );
  }
}
