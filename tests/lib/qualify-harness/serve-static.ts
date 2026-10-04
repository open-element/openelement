/**
 * Static serving for the qualify harnesses (#1472).
 *
 * Thin re-export of the canonical tools/lib/static-server.ts so harness
 * consumers stop hand-rolling node:http listener loops; serving behavior (MIME
 * table, candidate paths, traversal guard, range support) stays in one
 * place, shared with www/e2e and the fixture e2e servers.
 */

export { contentType, findPort, serveStatic } from '../../../tools/lib/static-server.ts';
