import type { PartProgram } from '../../protocol/part-program.ts';
import {
  claimExistingDom,
  type CompiledProgramInstance,
  type CompiledRuntimeHost,
  createFreshDom,
} from '../runtime.ts';
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
    if (this.#destroyed) throw new Error('[compiled-kernel] kernel is disposed');
    if (this.#active) return this.#activation as CompiledKernelActivation;

    if (this.#element.tagName.toLowerCase() !== this.#program.tag) {
      throw new Error(
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
      const mode: CompiledActivationMode = root.childNodes.length > 0 ? 'claim' : 'fresh';
      // Update-phase failures (#1375) land in the same element-local boundary
      // as connect failures: this element owns the Region subscriptions, so it
      // is the nearest boundary for their update errors.
      const host: CompiledRuntimeHost = {
        ...this.#options,
        onUpdateError: (error) => this.errors.capture(error, this.#element),
      };
      this.#instance = mode === 'claim'
        ? claimExistingDom(this.#program, host, root, {
          expectStaticStyle: styleCount > 0,
        })
        : createFreshDom(this.#program, host, root);
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

  #resolveRoot(): CompiledStyleRoot {
    if (this.#root) return this.#root;
    const mode = this.#options.rootMode ?? 'open';
    if (mode === 'light') {
      this.#root = this.#element;
      return this.#root;
    }
    if (this.#options.root) {
      if (!('host' in this.#options.root) || this.#options.root.host !== this.#element) {
        throw new Error('[compiled-kernel] supplied root is not owned by the element');
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
      throw new Error(`[compiled-kernel] ${mode} root requires attachShadow()`);
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
