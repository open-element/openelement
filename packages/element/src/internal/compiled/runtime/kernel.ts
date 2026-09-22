import type { PartProgram } from '../../protocol/part-program.ts';
import {
  type CompiledProgramInstance,
  type CompiledRuntimeHost,
  createFreshDom,
} from '../runtime.ts';
import { claimExecutor } from './claim-seam.ts';
import { CompiledErrorBoundary, type CompiledErrorBoundaryOptions } from './error-boundary.ts';
import { CompiledContextService } from './context.ts';
import { ElementFormController } from '../../../open-element-form.ts';
import { ElementLifecycle } from '../../../open-element-lifecycle.ts';
import {
  type CompiledStyleRoot,
  CompiledStyleScope,
  themeManager,
} from '../../../open-element-styles.ts';
import type { StyleSheetLike } from '../../../internal/protocol/style-sheet.ts';
// Single error dialect (#1386 item 3): kernel lifecycle failures carry codes.
import { frameworkError, KernelErrorCode } from '../../protocol/errors.ts';

/** Raise one kernel lifecycle failure with its catalogued code. */
function fail(code: string, message: string): never {
  throw frameworkError(code, message, { phase: 'csr' });
}

/**
 * The character data of a text-like node.
 *
 * `data` is the canonical accessor for `CharacterData` (`Text`, `Comment`,
 * CDATA) and is what every DOM implementation — including the minimal facade
 * the tests run against — exposes. `textContent` is the fallback for a node
 * that only carries the newer accessor. Reading only `textContent` would treat
 * a text node as empty wherever the property is absent, which is how a
 * content test silently becomes a "strip it" decision.
 */
function characterData(node: Node): string {
  const data = (node as { data?: unknown }).data;
  if (typeof data === 'string') return data;
  const text = (node as { textContent?: unknown }).textContent;
  return typeof text === 'string' ? text : '';
}

/**
 * True when a child node can only have come from rendered output.
 *
 * `childNodes.length > 0` was the original content test, and it counted
 * formatting whitespace as content (#1381): a light-root element written as
 * `<my-el>\n</my-el>`, or a parsed HTML file that puts the closing tag on its
 * own line, carries a whitespace-only text node — which no compiled template
 * begins with, so the claim walked straight into a mismatch and threw. A
 * whitespace-only text node is not content: it is the author's (or the HTML
 * formatter's) line break, and it is invisible either way.
 *
 * Everything else IS content and keeps the fail-closed path: an element, a
 * comment (the serializer's dynamic anchors are comments), or a text node
 * carrying visible characters — including a template that genuinely starts
 * with authored text, which the claim must be given the chance to match.
 */
function isClaimableNode(node: Node): boolean {
  if (node.nodeType !== 3) return true;
  return characterData(node).trim() !== '';
}

/**
 * Remove the formatting whitespace a fresh mount must not inherit.
 *
 * Called only after {@linkcode isClaimableNode} has established that the root
 * holds no content, so every node being removed is whitespace-only. The
 * runtime's own `createFreshDom` guard stays strict — a root with real content
 * must never reach fresh creation — so the normalization belongs here, in the
 * component that chose `fresh` after reading the root.
 */
function clearFormattingWhitespace(root: CompiledStyleRoot): void {
  for (const node of [...root.childNodes]) {
    if (!isClaimableNode(node)) root.removeChild(node);
  }
}

export type CompiledRootMode = 'light' | 'open' | 'closed';

/**
 * Which executor ran for one activation: the canonical claim of existing
 * (SSR/DSD) content, or fresh DOM creation. The kernel decides from the
 * resolved root's actual content and reports it here — the semantic owner of
 * the mode is the execution itself, never a pre-connect guess (#1213).
 */
export type CompiledActivationMode = 'claim' | 'fresh';

/** Truth of one successful kernel activation: the mode and the root it ran against. */
export interface CompiledKernelActivation {
  readonly mode: CompiledActivationMode;
  readonly root: CompiledStyleRoot;
}

export interface CompiledElementKernelOptions extends CompiledRuntimeHost {
  rootMode?: CompiledRootMode;
  /** A previously created closed root may be supplied on re-entry. */
  root?: CompiledStyleRoot;
  delegatesFocus?: boolean;
  styles?: StyleSheetLike | StyleSheetLike[];
  formAssociated?: boolean;
  errorBoundary?: CompiledErrorBoundaryOptions;
}

/**
 * Element-local owner for one compiled Part Program instance. It selects one
 * root, runs claim or fresh creation against that same root, and ties the
 * runtime instance, lifecycle signal, form internals, styles, context
 * consumption, and errors to the element's connect/disconnect boundary.
 */
export class CompiledElementKernel {
  readonly lifecycle = new ElementLifecycle();
  readonly form = new ElementFormController();
  readonly errors: CompiledErrorBoundary;
  readonly context: CompiledContextService;

  #element: HTMLElement;
  #program: PartProgram;
  #options: CompiledElementKernelOptions;
  #styleScope = new CompiledStyleScope();
  #root?: CompiledStyleRoot;
  #instance?: CompiledProgramInstance;
  #activation?: CompiledKernelActivation;
  #active = false;
  #destroyed = false;

  constructor(element: HTMLElement, program: PartProgram, options: CompiledElementKernelOptions) {
    this.#element = element;
    this.#program = program;
    this.#options = options;
    this.errors = new CompiledErrorBoundary(options.errorBoundary);
    this.context = new CompiledContextService(element);
  }

  get element(): HTMLElement {
    return this.#element;
  }

  get program(): PartProgram {
    return this.#program;
  }

  get root(): CompiledStyleRoot | undefined {
    return this.#root;
  }

  get active(): boolean {
    return this.#active;
  }

  /**
   * Resolve the root, run exactly one executor (claim of existing content or
   * fresh creation), and return the activation truth. The facade derives its
   * lifecycle hooks from this result; a thrown connect never produces a mode.
   */
  connect(): CompiledKernelActivation {
    if (this.#destroyed) fail(KernelErrorCode.DISPOSED, '[compiled-kernel] kernel is disposed');
    if (this.#active) return this.#activation as CompiledKernelActivation;

    if (this.#element.tagName.toLowerCase() !== this.#program.tag) {
      fail(
        KernelErrorCode.TAG_MISMATCH,
        `[compiled-kernel] program tag <${this.#program.tag}> does not match ` +
          `<${this.#element.tagName.toLowerCase()}>`,
      );
    }
    this.lifecycle.connect();
    let themeConnected = false;
    try {
      // Form internals attach first: for a form-associated host they are the
      // one channel through which a declaratively attached closed root is
      // reachable (ElementInternals.shadowRoot) during root resolution.
      this.form.attach(this.#element, { formAssociated: this.#options.formAssociated });
      const root = this.#resolveRoot();
      this.#styleScope.connect(root, this.#options.styles);
      themeManager.connect(this.#element);
      themeConnected = true;
      const styles = this.#options.styles;
      const styleCount = Array.isArray(styles) ? styles.length : styles ? 1 : 0;
      // Content decides, not a non-zero child count (#1381): formatting
      // whitespace is not content, so a light root whose authored line breaks
      // survived parsing still mounts fresh instead of failing a claim that
      // could not match. Real content — an element, an anchor comment, or
      // visible text — keeps the fail-closed claim path.
      const hasContent = Array.from(root.childNodes).some(isClaimableNode);
      const mode: CompiledActivationMode = hasContent ? 'claim' : 'fresh';
      if (!hasContent && root.childNodes.length > 0) clearFormattingWhitespace(root);
      // Update-phase failures (#1375) land in the same element-local boundary
      // as connect failures: this element owns the Region subscriptions, so it
      // is the nearest boundary for their update errors.
      const host: CompiledRuntimeHost = {
        ...this.#options,
        onUpdateError: (error) => this.errors.capture(error, this.#element),
      };
      this.#instance = mode === 'fresh' ? createFreshDom(this.#program, host, root) : this.#claim(
        host,
        root,
        styleCount,
      );
      this.context.connect();
      if (this.errors.hasError) this.errors.reset();
      this.#activation = { mode, root };
      this.#active = true;
      return this.#activation;
    } catch (error) {
      try {
        this.context.disconnect();
      } catch {
        // Preserve the original construction/claim error.
      }
      try {
        this.#instance?.dispose();
      } catch {
        // Preserve the original construction/claim error.
      }
      this.#instance = undefined;
      if (themeConnected) themeManager.disconnect(this.#element);
      this.#styleScope.disconnect();
      this.lifecycle.dispose();
      this.errors.capture(error, this.#element);
      throw error;
    }
  }

  disconnect(): void {
    if (!this.#active) return;
    this.#active = false;
    this.#activation = undefined;
    try {
      this.#instance?.dispose();
    } finally {
      this.#instance = undefined;
      this.context.disconnect();
      themeManager.disconnect(this.#element);
      this.#styleScope.disconnect();
      this.lifecycle.dispose();
    }
  }

  adopted(): void {
    if (!this.#active || !this.#root) return;
    this.#styleScope.adopted(this.#root, this.#options.styles);
    themeManager.connect(this.#element);
  }

  dispose(): void {
    if (this.#destroyed) return;
    this.disconnect();
    this.context.dispose();
    this.form.dispose();
    this.errors.dispose();
    this.#destroyed = true;
  }

  /**
   * Claim the root's existing content through the executor seam (#1416). The
   * kernel never imports the claim implementation: the full entry installs it
   * (claim-install.ts), the client-only entry does not. An uninstalled claim
   * is fail-closed — a connected element that finds content in its root has
   * server-rendered (or light-mode) DOM that only the full entry can hydrate,
   * so this throws instead of building a second tree beside it.
   */
  #claim(
    host: CompiledRuntimeHost,
    root: CompiledStyleRoot,
    styleCount: number,
  ): CompiledProgramInstance {
    const executor = claimExecutor();
    if (!executor) {
      fail(
        KernelErrorCode.CLAIM_EXECUTOR_MISSING,
        '[compiled-kernel] existing DOM in the resolved root needs the claim executor: ' +
          "the element was connected from the '@openelement/element/client-only' entry, " +
          "which omits it. Import '@openelement/element' for any element that can " +
          'hydrate server-rendered content.',
      );
    }
    return executor(this.#program, host, root, { expectStaticStyle: styleCount > 0 });
  }

  #resolveRoot(): CompiledStyleRoot {
    if (this.#root) return this.#root;
    const mode = this.#options.rootMode ?? 'open';
    if (mode === 'light') {
      this.#root = this.#element;
      return this.#root;
    }
    if (this.#options.root) {
      if (!('host' in this.#options.root) || this.#options.root.host !== this.#element) {
        fail(
          KernelErrorCode.ROOT_NOT_OWNED,
          '[compiled-kernel] supplied root is not owned by the element',
        );
      }
      this.#root = this.#options.root;
      return this.#root;
    }
    const existing = mode === 'open' ? this.#element.shadowRoot : this.#existingClosedRoot();
    if (existing) {
      this.#root = existing;
      return existing;
    }
    if (typeof this.#element.attachShadow !== 'function') {
      fail(
        KernelErrorCode.ATTACH_SHADOW_REQUIRED,
        `[compiled-kernel] ${mode} root requires attachShadow()`,
      );
    }
    this.#root = this.#element.attachShadow({
      mode,
      delegatesFocus: this.#options.delegatesFocus ?? false,
    });
    return this.#root;
  }

  /**
   * A declaratively attached (DSD) closed root is reachable only through the
   * host's own ElementInternals — `attachShadow()` on such a host would wipe
   * the declarative content, so it can never serve the claim. Form-associated
   * hosts already attached their internals via the form controller (a second
   * `attachInternals()` would throw), so direct discovery skips them.
   */
  #existingClosedRoot(): CompiledStyleRoot | undefined {
    const viaForm = this.form.internals?.shadowRoot;
    if (viaForm) return viaForm;
    if (this.#options.formAssociated === true) return undefined;
    if (typeof this.#element.attachInternals !== 'function') return undefined;
    try {
      return this.#element.attachInternals().shadowRoot ?? undefined;
    } catch {
      // Internals were attached elsewhere; no discovery channel remains.
      return undefined;
    }
  }
}
