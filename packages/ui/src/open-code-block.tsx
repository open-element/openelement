/**
 * @openelement/ui - open-code-block
 *
 * Code block with copy button AND syntax highlighting via Prism.
 *
 * Highlighting contract: the component does NOT bundle a tokenizer. It
 * tokenizes the slotted <pre><code> only when the host page has loaded a
 * global `Prism` (core + the matching language grammar, e.g. from a CDN
 * <script>). Without Prism the block degrades to plain text with the copy
 * button — that is expected, not a bug. See README.md for the script recipe.
 *
 * Compiled authoring: the shell (slot + copy button) is the
 * compiled template; the copy label is a compiled text sink driven by the
 * `copyLabel` property. Prism highlighting stays imperative in methods; its
 * per-instance bookkeeping lives in the shared instance-state module. On
 * disconnect the program's static structure is restored so a reconnect
 * re-claims cleanly (the injected highlight <pre> is not program content).
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
import { CODE_BLOCK_CONSTANTS, log, recipe } from './component-recipes.ts';
import { readInstanceState, writeInstanceState } from './instance-state.ts';

/**
 * Token-color rationale (the styles below ship to clients, so this note stays
 * out of the template): the vendored light-DOM Prism theme's comment gray
 * #708090 is 3.6:1 on its own #f5f2f0 background (under AA), but that pairing
 * never renders — the vendor only paints it through pre[class*=language-] and
 * site fences carry the language class on code, not pre. A host site that
 * pins its code surface to the same static zinc-950 the recipes paint
 * (pre[class*=language-] override) measures 4.7:1 there.
 */
@element('open-code-block', { root: 'shadow-open' })
export class OpenCodeBlock extends OpenElement {
  static override styles: StyleSheetLike[] = [
    recipe(`
    :host {
      display: block;
      position: relative;
    }

    pre {
      margin: 0;
      padding: calc(var(--spacing) * 5);
      /* Clear the copy chip (top calc(var(--spacing) * 2) + ~25px tall) so the first line
         never runs underneath it. */
      padding-block-start: calc(var(--spacing) * 9);
      background: var(--color-zinc-950);
      border: calc(var(--spacing) * 0.25) solid var(--color-zinc-700);
      border-radius: var(--radius-lg);
      overflow-x: auto;
      font-family: var(--font-mono);
      font-size: var(--text-sm);
      line-height: var(--leading-relaxed);
      color: var(--color-zinc-200);
      scrollbar-width: thin;
      scrollbar-color: color-mix(in srgb, var(--color-primary) 14%, transparent) transparent;
      white-space: pre-wrap;
      word-break: break-word;
    }

    ::slotted(pre) {
      margin: 0;
      padding: calc(var(--spacing) * 5);
      padding-block-start: calc(var(--spacing) * 9);
      background: var(--color-zinc-950);
      border: calc(var(--spacing) * 0.25) solid var(--color-zinc-700);
      border-radius: var(--radius-lg);
      overflow-x: auto;
      font-family: var(--font-mono);
      font-size: var(--text-sm);
      line-height: var(--leading-relaxed);
      color: var(--color-zinc-200);
      scrollbar-width: thin;
      scrollbar-color: color-mix(in srgb, var(--color-primary) 14%, transparent) transparent;
    }

    .lang-badge {
      position: absolute;
      top: calc(var(--spacing) * 2);
      left: calc(var(--spacing) * 3);
      font-size: var(--text-xs);
      font-weight: var(--font-weight-bold);
      text-transform: uppercase;
      letter-spacing: var(--tracking-widest);
      color: var(--color-zinc-200);
      pointer-events: none;
    }

    .copy-btn {
      position: absolute;
      top: calc(var(--spacing) * 2);
      right: calc(var(--spacing) * 2);
      background: color-mix(in srgb, var(--color-primary) 14%, transparent);
      color: var(--color-zinc-200);
      padding: calc(var(--spacing) * 1) calc(var(--spacing) * 3);
      font-size: var(--text-xs);
      font-family: var(--font-sans);
      font-weight: var(--font-weight-semibold);
      border: 0.5px solid transparent;
      cursor: pointer;
      border-radius: var(--radius-md);
      transition: all var(--ease-in-out) var(--default-transition-duration);
      z-index: 1;
      letter-spacing: var(--tracking-wider);
    }

    /* No ink override on hover: the primary-foreground ink belongs to a brand
       *fill*, and this chip's hover surface is a translucent brand tint
       instead, so the chip keeps the code surface's zinc-200 ink. */
    .copy-btn:hover {
      background: color-mix(in srgb, var(--color-primary) 23%, transparent);
      border-color: var(--color-primary);
    }

    :host(:state(copied)) .copy-btn {
      color: #22c55e;
      border-color: rgba(34,197,94,0.3);
      background: rgba(34,197,94,0.08);
    }

    :host(:state(failed)) .copy-btn {
      color: var(--color-destructive);
      border-color: var(--color-destructive);
    }

    /* Comment gray: #7d8590 (5.2:1 on the static zinc-950 code surface) —
       #6a737d was 4.0:1. */
    .token.cdata, .token.comment, .token.doctype, .token.prolog { color: #7d8590; }
    .token.punctuation { color: #8b949e; }
    .token.namespace { opacity: 0.7; }
    .token.boolean, .token.constant, .token.deleted, .token.number, .token.property, .token.symbol, .token.tag { color: #79c0ff; }
    .token.attr-name, .token.builtin, .token.char, .token.inserted, .token.selector, .token.string { color: #a5d6ff; }
    .token.entity, .token.operator, .token.url, .language-css .token.string, .style .token.string { color: #d2a8ff; }
    .token.atrule, .token.attr-value, .token.keyword { color: #ff7b72; }
    .token.class-name, .token.function { color: #d2a8ff; }
    .token.important, .token.regex, .token.variable { color: #ffa657; }
    .token.bold, .token.important { font-weight: 700; }
    .token.italic { font-style: italic; }
    .token.entity { cursor: help; }
  `),
  ];

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

  override onDsdHydrated(): void {
    this.tryHighlight();
  }

  override onCsrRendered(): void {
    this.tryHighlight();
  }

  override disconnectedCallback(): void {
    // Compiled-kernel ownership: restore the program's static structure before
    // teardown so a reconnect re-claims cleanly (the injected highlight <pre>
    // and the copy-label text are imperative writes, not program content).
    const slot = this.shadowRoot?.querySelector('slot');
    if (!slot) {
      const root = this.shadowRoot;
      const highlighted = root?.querySelector('pre');
      if (root && highlighted) {
        const restored = root.ownerDocument.createElement('slot');
        highlighted.replaceWith(restored);
      }
      const lightPre = this.querySelector('pre');
      if (lightPre) (lightPre as HTMLElement).style.display = '';
      writeInstanceState(this, 'highlighted', false);
    }
    super.disconnectedCallback();
  }

  private prismGlobal(): unknown {
    return (globalThis as typeof globalThis & { Prism?: unknown }).Prism;
  }

  private tryHighlight(): void {
    const p = this.prismGlobal();
    if (typeof p === 'undefined') {
      // Prism not loaded yet: backoff 10, 20, 40, ..., 500ms cap.
      this.scheduleRetry(10, 500);
      return;
    }

    const pre =
      this.querySelector(':scope > pre') ||
      Array.from(this.children).find((c) => c.tagName === 'PRE');
    if (!pre) return;
    const codeEl = pre.querySelector('code');
    if (!codeEl) return;

    let lang = 'typescript';
    const classes = codeEl.classList;
    for (let i = 0; i < classes.length; i++) {
      if (classes[i].startsWith('language-')) {
        lang = classes[i].slice(9);
        break;
      }
    }

    const raw = codeEl.textContent || '';
    const grammar = (p as Record<string, Record<string, unknown>>).languages?.[lang] as
      | Record<string, unknown>
      | undefined;
    if (!grammar) {
      // Grammar not registered yet: backoff 20, 40, 80, ..., 1000ms cap.
      this.scheduleRetry(20, 1000);
      return;
    }
    writeInstanceState(this, 'highlightRetries', 0);
    const highlightedHtml = (
      p as { highlight: (code: string, grammar: unknown, lang: string) => string }
    ).highlight(raw, grammar, lang);
    this.injectHighlighted(highlightedHtml, lang);
  }

  /** Retry tryHighlight with exponential backoff (base×2ⁿ, 6 steps max, capped). */
  private scheduleRetry(base: number, cap: number): void {
    const retries = readInstanceState(this, 'highlightRetries', () => 0);
    if (retries >= CODE_BLOCK_CONSTANTS.maxHighlightRetries) return;
    writeInstanceState(this, 'highlightRetries', retries + 1);
    const delay = Math.min(base * Math.pow(2, Math.min(retries + 1, 6)), cap);
    this._setTimeout(() => this.tryHighlight(), delay);
  }

  private injectHighlighted(html: string, lang: string): void {
    if (!this.shadowRoot || readInstanceState(this, 'highlighted', () => false)) return;
    writeInstanceState(this, 'highlighted', true);

    const slot = this.shadowRoot.querySelector('slot');
    if (!slot) return;

    const highlightedPre = document.createElement('pre');
    const highlightedCode = document.createElement('code');
    highlightedCode.className = `language-${lang}`;
    highlightedCode.innerHTML = html;
    highlightedPre.appendChild(highlightedCode);
    slot.replaceWith(highlightedPre);

    const lightPre = this.querySelector('pre');
    if (lightPre) (lightPre as HTMLElement).style.display = 'none';
  }

  private getCodeText(): string {
    if (this.shadowRoot) {
      const shadowCode = this.shadowRoot.querySelector('pre code');
      if (shadowCode) return shadowCode.textContent || '';
    }
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
