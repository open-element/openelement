/**
 * module-vocabulary.ts — the single definition of the router's module-scan
 * vocabulary for the element semantic core.
 *
 * The semantic core knows no router: its module scan recognizes a
 * page-definition or element-registration factory only when the host injects
 * the binding identity ({moduleSpecifier, exportName, kind}). Router is that
 * host — this module is the one place the router's factory bindings are
 * written, and every router call site that scans module sources injects it,
 * so the scan and the authored route grammar cannot drift (#1473 item 3, the
 * static-sidecar admission pattern).
 */

import type { ModuleVocabularyDescriptor } from '@openelement/element/compiler';

/** The module vocabulary router injects into `analyzeModuleSemantics`. */
export const ROUTER_MODULE_VOCABULARY: readonly ModuleVocabularyDescriptor[] = [
  {
    moduleSpecifier: '@openelement/router',
    exportName: 'definePage',
    kind: 'page-definition',
  },
  {
    moduleSpecifier: '@openelement/router/lit',
    exportName: 'defineLitPage',
    kind: 'page-definition',
  },
  {
    moduleSpecifier: '@openelement/router',
    exportName: 'defineElement',
    kind: 'element-registration',
  },
  {
    moduleSpecifier: '@openelement/router',
    exportName: 'defineIsland',
    kind: 'element-registration',
  },
];
