/**
 * @openelement/ui - open-code-block
 *
 * Code block with a copy button.
 *
 * Contract (shrunk in #1552): the component owns the copy interaction only —
 * it does NOT bundle, load, or invoke a tokenizer. Syntax highlighting is the
 * host page's build-time concern: fences are compiled to token-span HTML by
 * the site's markdown pipeline (e.g., Shiki) and project through the slot
 * untouched. The projected content stays light DOM, so the host's stylesheet
 * owns the code surface and token inks; this component only paints its chip.
 *
 * Generated authoring: the shell (slot + copy button) is the compiled
 * template; the copy label is a compiled text sink driven by the `copyLabel`
 * property, and the copy feedback's custom state (`:state(copied)` /
 * `:state(failed)`) is driven from the property-change channel.
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
import { computed, signal } from '@openelement/element';
import { onConnect, onDispose, onPropertyChange } from '@openelement/element/lifecycle';
import { defineComponentConfig } from './component-config.ts';
import { cancelCopyReset, scheduleCopyReset } from './copy-feedback.ts';
import { log } from './component-recipes.ts';

/**
 * Platform facts for the generated element: shadow root, the authored
 * component stylesheet, and the `copyLabel` property (property-only, no
 * attribute form).
 */
export const openElement = /* @__PURE__ */ defineComponentConfig({
  root: 'shadow',
  styles: ['./open-code-block.css'],
  properties: { copyLabel: { default: 'Copy', attribute: false } },
});

/** The generated element's declared property the copy flow writes. */
type CopyHost = HTMLElement & { copyLabel: string };

/** Code block with a copy button. */
function OpenCodeBlock(props: { copyLabel: string }) {
  const chinese = signal(false);
  // Preserve the public property values while presenting one accessible label.
  const translatedLabel = computed(() =>
    !chinese.value
      ? props.copyLabel
      : props.copyLabel === 'Copy'
        ? '复制'
        : props.copyLabel === 'Copied!'
          ? '已复制'
          : props.copyLabel === 'Failed'
            ? '复制失败'
            : props.copyLabel,
  );

  onConnect((env) => {
    globalThis.queueMicrotask(() => {
      if (env.signal.aborted) return;
      const language =
        env.host.closest('[lang]')?.getAttribute('lang') ??
        env.host.ownerDocument.documentElement.lang;
      chinese.value = /^zh(?:-|$)/i.test(language);
    });
  });

  /**
   * Copy the slotted light DOM: token spans (if the host highlighted at build
   * time) concatenate to the exact source text. The clipboard promise chain
   * writes the declared `copyLabel`; the change channel below owns state and
   * timer bookkeeping, so the click path never touches internals.
   */
  const copy = (host: HTMLElement): void => {
    const text = host.textContent || '';
    try {
      globalThis.navigator.clipboard.writeText(text).then(
        () => {
          (host as CopyHost).copyLabel = 'Copied!';
        },
        (error: unknown) => {
          log.warn('Clipboard write failed:', error);
          (host as CopyHost).copyLabel = 'Failed';
        },
      );
    } catch (error) {
      log.warn('Clipboard write failed:', error);
      (host as CopyHost).copyLabel = 'Failed';
    }
  };

  onPropertyChange((env) => {
    if (env.name !== 'copyLabel') return;
    if (env.value === 'Copied!') {
      env.states.add('copied');
      env.states.delete('failed');
      scheduleCopyReset(env.host);
      return;
    }
    if (env.value === 'Failed') {
      env.states.add('failed');
      env.states.delete('copied');
      scheduleCopyReset(env.host);
      return;
    }
    // Back to the idle label (the feedback reset, or a host write): clear both
    // custom states and drop any pending reset.
    env.states.delete('copied');
    env.states.delete('failed');
    cancelCopyReset(env.host);
  });
  onDispose((env) => {
    cancelCopyReset(env.host);
  });

  return (
    <div class='code-block-wrapper'>
      <slot></slot>
      <button
        type='button'
        class='copy-btn absolute top-2 right-2 z-10 cursor-pointer rounded-md border-[0.5px] border-transparent bg-primary/14 px-3 py-1 font-sans text-xs font-semibold tracking-wider text-foreground transition-all duration-150 ease-in-out hover:border-primary hover:bg-primary/23'
        part='copy'
        onClick={(event: Event) => {
          const target = event.currentTarget as HTMLElement;
          copy((target.getRootNode() as ShadowRoot).host as HTMLElement);
        }}
      >
        {translatedLabel.value}
      </button>
    </div>
  );
}

export default OpenCodeBlock;
