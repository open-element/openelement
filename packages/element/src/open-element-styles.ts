import { STYLE_SHEET_READY, type StyleSheetLike } from '@openelement/protocol/style-sheet';
import { OpenElementThemeManager, type StyleAdoptionTarget } from './open-element-theme.ts';
// Single error dialect (#1386 item 3): style-application failures carry codes.
import { frameworkError, raiseFrameworkError, StyleErrorCode } from '@openelement/protocol/errors';
import { reportError } from './internal/core/errors.ts';

/** Raise one style-application failure with its catalogued code. */
function fail(code: string, message: string): never {
  raiseFrameworkError('csr', code, message);
}

/**
 * Owns the global style registry and host theme propagation.
 *
 * Extracted from the base class (#904, concern: StyleSheet management).
 * The single themeManager instance serves every OpenElement host; the base
 * class only forwards the public statics to it.
 */
export const themeManager = new OpenElementThemeManager();

export type CompiledStyleRoot = HTMLElement | ShadowRoot;

function asStyleList(component?: StyleSheetLike | StyleSheetLike[]): StyleSheetLike[] {
  return [
    ...new Set([
      ...themeManager.getStyles(),
      ...(component ? (Array.isArray(component) ? component : [component]) : []),
    ]),
  ];
}

/**
 * The readiness promises of sheets that are still filling. The generated client
 * adapter records its promise on the sheet under
 * {@linkcode STYLE_SHEET_READY}; a sheet without one — the SSR shim, an
 * author-provided in-memory sheet — is ready by definition.
 */
export function pendingSheetReadiness(
  styles?: StyleSheetLike | StyleSheetLike[],
): Promise<unknown>[] {
  const list = Array.isArray(styles) ? styles : styles === undefined ? [] : [styles];
  const pending: Promise<unknown>[] = [];
  for (const sheet of list) {
    const ready = (sheet as { [STYLE_SHEET_READY]?: unknown })[STYLE_SHEET_READY];
    if (typeof (ready as { then?: unknown } | undefined)?.then === 'function') {
      pending.push(ready as Promise<unknown>);
    }
  }
  return pending;
}

/**
 * The aggregate readiness of a component's styles, or `undefined` when every
 * sheet is already usable. One pending sheet is not enough to decide: the SSR
 * fallback may only retire once *all* replacing sheets are installed, so the
 * hydration gate consumes this aggregate rather than the first settlement.
 */
export function staticStyleReadiness(
  styles?: StyleSheetLike | StyleSheetLike[],
): Promise<unknown> | undefined {
  const pending = pendingSheetReadiness(styles);
  return pending.length === 0 ? undefined : Promise.all(pending);
}

function isShadowRoot(root: CompiledStyleRoot): root is ShadowRoot {
  return typeof ShadowRoot !== 'undefined'
    ? root instanceof ShadowRoot
    : 'host' in root && 'adoptedStyleSheets' in root;
}

/**
 * The adoption target one compiled root's sheets belong to: the root itself
 * for a shadow-root component; for a light-root component, the tree the
 * element is actually IN — its `getRootNode()`, which is the document for a
 * document-level component and the ENCLOSING SHADOW ROOT when a parent
 * component's DSD template owns the subtree.
 *
 * `ownerDocument` was wrong for that second case, and wrong in a way no
 * object-level check could see: a document stylesheet never matches elements
 * inside a shadow tree, so the sheets were adopted into a tree that could not
 * reach their subject. The tree is resolved from the element at each connect,
 * never cached: an element can be adopted into another document — or moved
 * into another shadow root — between two connections, and the sheets must land
 * in the tree the element is in NOW.
 */
function adoptionTargetOf(root: CompiledStyleRoot): StyleAdoptionTarget {
  if (isShadowRoot(root)) return root;
  const tree = root.getRootNode();
  if (tree && 'adoptedStyleSheets' in tree) return tree as StyleAdoptionTarget;
  // A detached element whose root cannot adopt still falls back to its owner
  // document: the failure that matters is reported below, once, for both.
  const owned = root.ownerDocument;
  if (owned && 'adoptedStyleSheets' in owned) return owned;
  fail(
    StyleErrorCode.ADOPTED_STYLES_UNSUPPORTED,
    '[compiled-styles] a light root needs a containing tree that supports adoptedStyleSheets',
  );
}

/**
 * Owns the style sink for one compiled element activation (alpha15 S lane,
 * S-C1.2).
 *
 * ONE delivery form for both root kinds: the component's sheets are ADOPTED
 * into the root that can reach the component's DOM — `adoptedStyleSheets` on
 * a shadow root, `adoptedStyleSheets` on the document for a light root. No
 * `<style>` node is created, no rule text is copied, and no CSS is generated
 * at runtime: the build emits each sheet, already scoped to its light-root
 * component's tag, and this scope only installs the sheet object it was
 * handed.
 *
 * Adoption is also what makes the old light-DOM snapshot unnecessary: a sheet
 * whose `replace()` is still in flight fills itself in place, on every target
 * that adopted it, so a reconnect inside that window needs no second pass and
 * cannot read a still-filling sheet (the cross-engine KR-2/Q1-B race).
 *
 * Ownership at disconnect differs by target, and deliberately so:
 *
 *   - A shadow root belongs to ONE instance, so the sheets this scope
 *     installed are removed again (`#adoptedSheets`), leaving the root's
 *     pre-existing sheets untouched.
 *   - The document is SHARED by every instance of every component, so a light
 *     scope never removes: the sheet is a per-component-type singleton owned
 *     by the module graph, other live instances still need it, and its rules
 *     are `@scope`-bounded to its own tag, so it can never reach a foreign
 *     element. `document.adoptedStyleSheets` is itself the record — this
 *     scope keeps no second registry to drift from it, and re-adoption after
 *     a reconnect is a no-op because the sheet object is already listed.
 */
export class CompiledStyleScope {
  #root?: CompiledStyleRoot;
  #styles: StyleSheetLike[] = [];
  /** Sheets this scope installed into a shadow root (never a document). */
  #adoptedSheets: StyleSheetLike[] = [];
  /**
   * One generation per connection. A sheet that settles after this scope moved
   * on — disconnect or a reconnect to another root — must not report against
   * the newer connection, so every continuation compares the generation it was
   * created under with the current one.
   */
  #generation = 0;

  connect(root: CompiledStyleRoot, component?: StyleSheetLike | StyleSheetLike[]): void {
    const styles = asStyleList(component);
    if (this.#root !== root) this.#removeAdoptedSheets();
    this.#root = root;
    this.#styles = styles;
    const generation = (this.#generation += 1);

    // Nothing to install: the root is resolved and recorded, and no adoption
    // target is even consulted. A component with no styles (and no registered
    // global sheets) must connect on any root — including one whose document
    // has no stylesheet list at all, which is exactly the shape a stylesheet-
    // free host presents.
    if (styles.length === 0) {
      this.#adoptedSheets = [];
      this.#observeSheetReadiness(styles, generation);
      return;
    }

    const target = adoptionTargetOf(root);
    if (!('adoptedStyleSheets' in target)) {
      fail(
        StyleErrorCode.ADOPTED_STYLES_UNSUPPORTED,
        '[compiled-styles] the style adoption target does not support adoptedStyleSheets',
      );
    }
    themeManager.applyStyles(target, component);
    // Only a shadow root's adoption is this scope's to undo; a document's is
    // document-lifetime (see the class doc). The sheets are recorded AFTER the
    // adoption, so a failing apply never records sheets it did not install.
    this.#adoptedSheets = isShadowRoot(root) ? styles : [];
    this.#observeSheetReadiness(styles, generation);
  }

  /**
   * Report a failed sheet on the owning connection.
   *
   * Adoption needs no refresh step: the sheet object fills itself, so a late
   * settlement is already reflected everywhere it was adopted. What remains is
   * the failure half of the sheet contract — a rejected `replace()` / fetch is
   * reported once, against the connection that owned the sheet.
   */
  #observeSheetReadiness(styles: readonly StyleSheetLike[], generation: number): void {
    const pending = pendingSheetReadiness(styles as StyleSheetLike[]);
    if (pending.length === 0) return;
    void Promise.all(pending).then(
      () => {},
      (error: unknown) => {
        // A stale connection reports nothing: its sheets are gone with it and
        // the next connection reports its own outcome.
        if (generation !== this.#generation) return;
        reportError(
          frameworkError(
            StyleErrorCode.SHEET_LOAD_FAILED,
            `[compiled-styles] a component style sheet could not be loaded: ${
              error instanceof Error ? error.message : String(error)
            }`,
            {
              phase: 'csr',
              cause: error instanceof Error ? error : undefined,
            },
          ),
        );
      },
    );
  }

  adopted(root: CompiledStyleRoot, component?: StyleSheetLike | StyleSheetLike[]): void {
    this.connect(root, component);
  }

  disconnect(): void {
    // Bump the generation first: a sheet settling after this point belongs to a
    // connection that no longer owns a root to report against.
    this.#generation += 1;
    this.#removeAdoptedSheets();
    this.#root = undefined;
    this.#styles = [];
  }

  get root(): CompiledStyleRoot | undefined {
    return this.#root;
  }

  get styles(): StyleSheetLike[] {
    return [...this.#styles];
  }

  #removeAdoptedSheets(): void {
    const root = this.#root;
    const applied: Set<unknown> = new Set(this.#adoptedSheets);
    this.#adoptedSheets = [];
    if (!root || applied.size === 0 || !isShadowRoot(root)) return;
    root.adoptedStyleSheets = root.adoptedStyleSheets.filter((sheet) => !applied.has(sheet));
  }
}
