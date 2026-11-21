/**
 * The shared sheet registry, for the generated client entry (F16).
 *
 * The class base used to forward `registerGlobalStyles` to this manager. With the
 * class lane deleted the entry calls the OWNER directly, and this internal subpath
 * exists so that call does not widen the PUBLIC surface with a symbol no author is
 * meant to touch: the entry is framework-generated code, not an authoring API.
 *
 * No stability promise (ADR-0177): the only consumer is the generated entry.
 */
export { themeManager } from '../open-element-styles.ts';
