/** @jsxImportSource @openelement/element */
import { element, OpenElement, property } from '@openelement/element';
import '@shoelace-style/shoelace/dist/components/button/button.js';

// Validates @openelement/ui CE coexistence: open-button / open-card / open-input
// + Preact island all render in shadow DOM.

export const tagName = 'reader-wc-interop';

@element('reader-wc-interop', { root: 'shadow-open' })
export default class WcInteropPage extends OpenElement {
  @property({ reflect: false, attribute: false, type: Object })
  feedback: { kind: 'success' | 'info'; text: string } | null = null;

  handleClick(): void {
    this.feedback = { kind: 'success', text: 'open-button 触发了 open-click 事件。' };
  }

  render() {
    const feedback = this.feedback;
    return (
      <main class='reader-main'>
        <div class='page-header'>
          <div class='page-header-text'>
            <h1>组件互操作</h1>
            <p>openElement 自定义元素与 Preact island 在 Shadow DOM 中共存</p>
          </div>
        </div>

        {feedback && (
          <p class={feedback.kind === 'success' ? 'toast-inline' : 'form-error'}>
            {feedback.text}
          </p>
        )}

        <div class='wc-interop-grid'>
          <div class='wc-interop-cell'>
            <h3>shoelace sl-button</h3>
            <sl-button variant='primary'>第三方 WC</sl-button>
            <p class='wc-interop-demo'>
              来自 Shoelace，验证第三方 Web Component 可在 OpenElement 页面中渲染。
            </p>
          </div>

          <div class='wc-interop-cell'>
            <h3>open-button</h3>
            <open-button variant='primary' onClick={this.handleClick}>
              点击触发事件
            </open-button>
            <p class='wc-interop-demo'>按钮组件，支持 variant / size / type 属性。</p>
          </div>

          <div class='wc-interop-cell'>
            <h3>open-card</h3>
            <open-card>
              <h3 slot='header'>卡片标题</h3>
              <p>由 @openelement/ui 提供，支持 header / 默认 slot。</p>
            </open-card>
            <p class='wc-interop-demo'>带 header slot 的内容容器。</p>
          </div>

          <div class='wc-interop-cell'>
            <h3>open-input</h3>
            <open-input label='标签' placeholder='在此输入文字……' />
            <p class='wc-interop-demo'>带 label 的输入框组件。</p>
          </div>

          <div class='wc-interop-cell'>
            <h3>sync-status-island</h3>
            <sync-status-island source-id='fixtures' />
            <p class='wc-interop-demo'>Preact island，处理本地交互。</p>
          </div>
        </div>
      </main>
    );
  }
}
