/**
 * @openelement/router/server-runtime — the typecheckable runtime modules
 * that generated entries import (ADR-0160 rule a).
 *
 * Generated Hono entries are route wiring: they select routes, bind
 * renderers, and forward requests. The request-time server semantics they
 * invoke — the response/header channel, its commitment gate, the CSP
 * auto-nonce, the page SSR renderer seam, the page descriptor/props
 * projection, the app-shell composition, the status-page/locale resolution,
 * and the streaming pump (request scope, deferred-field front gate, bounded
 * queue, timeout/cancellation, Part backfill frames, and the browser
 * bootstrap string) — live in the modules re-exported here, so the logic is
 * visible to `deno check` and directly unit-testable instead of hiding inside
 * codegen template strings. The bundler inlines the import into every
 * generated entry (dev, SSG prerender, Nitro production). The modules never
 * import the Element runtime barrel: the entry injects its Element functions
 * and its serialized build data (admitted tag list, dangerous keys, shell
 * plan, body limit) at binding time, keeping the LIT entry's graph
 * kernel-free (#1339). The only Element edge is the kernel-free
 * `/authoring` leaf's protocol constants (the action fetch header, the
 * problem+json media type, and the stream policy budgets/frame lists).
 *
 * Authors never import this subpath directly; it is the generated entry's
 * runtime, kept on the package surface because generated code can only
 * resolve declared exports.
 */

export {
  applyCspNonce,
  createCspNonce,
  createStreamHeaderChannel,
  mergeChannelHeaders,
  PROTOCOL_HEADERS,
} from './response-channel.ts';
export type { ResponseHeaderChannel } from './types.ts';
export {
  ACTION_FETCH_HEADER,
  actionErrorResponse,
  actionRedirectResponse,
  createActionBodyLimit,
  createHonoBridge,
  runActionProtocol,
} from './action-runtime.ts';
export type {
  ActionExecution,
  ActionHonoContext,
  ActionLoadContext,
  ActionProtocolState,
  HonoBridge,
} from './action-runtime.ts';
export {
  createPagePropsRuntime,
  localeFromPath,
  pageDefinition,
  routeMeta,
} from './page-render.ts';
export type {
  PageContext,
  PageDefinition,
  PagePropsRuntime,
  PagePropsRuntimeDeps,
  ProjectedProps,
  RouteModule,
} from './page-render.ts';
export {
  createLitPageRenderer,
  createNativePageRenderer,
  resolveCompiledPageTag,
  resolveLitPageTag,
} from './renderer-runtime.ts';
export type {
  LitPageRendererDeps,
  NativePageRendererDeps,
  PageSsrRenderer,
  PageSsrSourceInfo,
  ProjectedChildren,
  TrustedHtmlValue,
} from './renderer-runtime.ts';
export { createAppShellRuntime, createStatusHtml, localizeShellHref } from './document-runtime.ts';
export type {
  AppShellRuntime,
  AppShellRuntimeDeps,
  StatusHtmlRenderer,
} from './document-runtime.ts';
export {
  createStreamBody,
  createStreamRequestScope,
  STREAM_BROWSER_BOOTSTRAP,
  streamFields,
} from './stream-runtime.ts';
export type {
  StreamBodyConfig,
  StreamBodyFn,
  StreamBodyOptions,
  StreamDocumentParts,
  StreamExecutorView,
  StreamFieldRecord,
  StreamRequestScope,
} from './stream-runtime.ts';
