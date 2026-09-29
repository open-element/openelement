/**
 * @openelement/router/server-runtime — the streaming pump (ADR-0158).
 *
 * The request-time streaming semantics of the generated Hono entry: the
 * request scope with its abort fan-out, the deferred-field observer front
 * gate, the shell commitment with its typed seed attribute, the bounded
 * wake/queue pump behind a `highWaterMark: 0` ReadableStream, the
 * cancellation/timeout sweep, the Part backfill frames with their terminal
 * error frames, and the no-JS tail. Migrated verbatim from the
 * generated-entry template strings (entry-stream-runtime.ts, #1470 block d)
 * so the pump is visible to `deno check` and directly unit-testable
 * (ADR-0160 rule a).
 *
 * The per-route shell gate (`__createDeferredPageShell`) stays emitted in the
 * entry: the read-only stream-manifest oracle pins its emitted shape, and its
 * body is the route→manifest/program binding the oracle re-expresses.
 *
 * The admission budgets and the frame deny lists come from the policy
 * constants on Element's kernel-free `/authoring` leaf — the same numbers the
 * build-time manifest scan and the deferred executor enforce, so no copy of
 * 256 KiB / 32 / 64 / 30 s lives in generated code. The Element functions the
 * pump calls (escapeAttr) are injected at binding time — the module carries
 * no Element runtime edge, so the LIT entry's import graph stays kernel-free
 * (#1339).
 *
 * The browser bootstrap (`STREAM_BROWSER_BOOTSTRAP`) stays an inline script in
 * every streamed page's head (S4 will re-home it); this module is its single
 * source, interpolating the same policy constants the server pump enforces.
 *
 * Behavior contract: the wire frames and their ordering are pinned by the
 * read-only stream-manifest oracle, stream-handler.test.ts (the real
 * generated handler driving this module), and stream-browser.test.ts (real
 * Chromium against the real bootstrap string).
 */

import {
  STREAM_FRAME_FORBIDDEN_TAGS,
  STREAM_FRAME_UNSAFE_URL,
  STREAM_FRAME_URL_ATTRIBUTES,
  STREAM_FRAME_URL_CONTROL_MAX,
  STREAM_MAX_FIELDS,
  STREAM_MAX_OWNERS,
  STREAM_MAX_PAYLOAD_LENGTH,
  STREAM_MAX_SEED_PROPERTIES,
  STREAM_TIMEOUT_MS,
} from '@openelement/element/authoring';
import { isOpenElementNotFound, isOpenElementRedirect } from '../../../authoring.ts';
import type { StreamRouteManifest } from '../protocol/ssg.ts';

/** One declared deferred field's settlement record (the pump's queue unit). */
export interface StreamFieldRecord {
  readonly entry: StreamRouteManifest['fields'][number];
  settled: boolean;
  failed: boolean;
  error: unknown;
  value: unknown;
  notify?: () => void;
}

/** The request scope the generated handler builds around a streamed route. */
export interface StreamRequestScope {
  /** The request the loader sees, carrying the scope's abort signal. */
  readonly request: Request;
  /** The original WinterCG request's signal (the response-cancel source). */
  readonly upstreamSignal: AbortSignal;
  /** Aborts the loader's work without tearing down the scope bridge. */
  abortWork(): void;
  /** Detaches the upstream bridge and aborts the scope (handler-level exit). */
  cancel(): void;
}

/** The slice of the element deferred executor the pump consumes. */
export interface StreamExecutorView {
  readonly shell: string;
  readonly owner: { readonly instanceId: string };
  readonly seed: Record<string, { type: string }>;
  resolvedValue(field: string, value: unknown): unknown;
  serializeResolved(field: string, value: unknown): string[];
}

/** The streamed document halves the element `documentStreamParts` produced. */
export interface StreamDocumentParts {
  readonly prefix: string;
  readonly suffix: string;
}

/** Per-request inputs of the streaming body builder. */
export interface StreamBodyOptions {
  scope: StreamRequestScope;
  route: string;
  manifest: StreamRouteManifest;
  executor: StreamExecutorView;
  records: readonly StreamFieldRecord[];
  document: StreamDocumentParts;
  token: string;
}

/** Binding-time configuration of {@linkcode createStreamBody}. */
export interface StreamBodyConfig {
  /**
   * The entry's `escapeAttr` import — an Element function, injected so this
   * module stays free of an Element runtime edge.
   */
  escapeAttr: (value: string) => string;
  /**
   * Deferred-field resolution budget in milliseconds; defaults to the
   * `STREAM_TIMEOUT_MS` policy constant. Test-only override — production
   * wiring never passes it.
   */
  timeoutMs?: number;
}

/** The bound streaming body builder the generated handler calls. */
export type StreamBodyFn = (options: StreamBodyOptions) => ReadableStream<Uint8Array>;

/**
 * The request scope for one streamed route: the loader's `request.signal`
 * aborts when the client disconnects (upstream abort fan-out), the response
 * body's `cancel()` tears the whole scope down, and {@linkcode
 * StreamRequestScope.abortWork} aborts pending loader work at the timeout
 * without cancelling the still-open response.
 */
export function createStreamRequestScope(original: Request): StreamRequestScope {
  const controller = new AbortController();
  const upstreamAbort = () => controller.abort(original.signal.reason);
  original.signal.addEventListener('abort', upstreamAbort, { once: true });
  if (original.signal.aborted) upstreamAbort();
  return {
    request: new Request(original, { signal: controller.signal }),
    upstreamSignal: original.signal,
    abortWork() {
      if (!controller.signal.aborted) controller.abort();
    },
    cancel() {
      original.signal.removeEventListener('abort', upstreamAbort);
      if (!controller.signal.aborted) controller.abort();
    },
  };
}

/**
 * JSON-encodes one seed attribute or Part frame and escapes the characters
 * HTML would otherwise interpret, bounded by the `STREAM_MAX_PAYLOAD_LENGTH`
 * policy constant.
 */
function streamJson(value: unknown): string {
  const text = JSON.stringify(value);
  if (text === undefined || text.length > STREAM_MAX_PAYLOAD_LENGTH) {
    throw new Error('stream payload exceeds the bound');
  }
  return text.replace(/[<>&\u2028\u2029]/g, (char) =>
    ({
      '<': '\\u003C',
      '>': '\\u003E',
      '&': '\\u0026',
      '\u2028': '\\u2028',
      '\u2029': '\\u2029',
    })[char] ?? '');
}

// A front-gate throw must never strand an unobserved loader rejection: the
// request scope's per-field observers may not exist yet (or may not cover
// every entry), and an unhandled rejection would kill the process instead of
// surfacing as the 500 the route contract promises. Every exit below sweeps
// the loader value itself (a non-object shape may itself be thenable) and all
// its entries first.
function observeThenables(data: unknown): void {
  if (data != null && typeof (data as Thenable).then === 'function') {
    Promise.resolve(data).catch(() => {});
  }
  if (data && typeof data === 'object') {
    for (const value of Object.values(data)) {
      if (value != null && typeof (value as Thenable).then === 'function') {
        Promise.resolve(value).catch(() => {});
      }
    }
  }
}

/** The minimal thenable shape the front gate probes for. */
interface Thenable {
  then: unknown;
}

/**
 * The deferred-field front gate: validates the loader data against the
 * route's build manifest (one plain object, the `STREAM_MAX_FIELDS` /
 * `STREAM_MAX_OWNERS` budget, every declared field present, no undeclared
 * thenable), attaches both settlement observers per field, and hands back the
 * records the pump queues. Every rejection first sweeps the loader's own
 * thenables for observation (see {@linkcode observeThenables}).
 */
export function streamFields(
  data: unknown,
  manifest: StreamRouteManifest,
): StreamFieldRecord[] {
  if (
    !data || typeof data !== 'object' || Array.isArray(data) ||
    (Object.getPrototypeOf(data) !== Object.prototype && Object.getPrototypeOf(data) !== null)
  ) {
    observeThenables(data);
    throw new Error('stream loader must return one object');
  }
  const ownerTotal = manifest.fields.reduce((count, field) => count + field.owners.length, 0);
  if (manifest.fields.length > STREAM_MAX_FIELDS || ownerTotal > STREAM_MAX_OWNERS) {
    observeThenables(data);
    throw new Error('stream manifest exceeds the bounded field/Part budget');
  }
  const declared = new Set(manifest.fields.map((entry) => entry.field));
  const loaderData = data as Record<string, unknown>;
  const records = manifest.fields.map((entry): StreamFieldRecord => {
    const record: StreamFieldRecord = {
      entry,
      settled: false,
      failed: false,
      error: undefined,
      value: undefined,
    };
    // Install both observers synchronously, including for already-rejected promises.
    if (Object.prototype.hasOwnProperty.call(loaderData, entry.field)) {
      Promise.resolve(loaderData[entry.field]).then(
        (value) => {
          if (record.settled) return;
          record.settled = true;
          record.value = value;
          record.notify?.();
        },
        (error) => {
          if (record.settled) return;
          record.settled = true;
          record.failed = true;
          record.error = error;
          record.notify?.();
        },
      );
    }
    return record;
  });
  for (const entry of manifest.fields) {
    if (!Object.prototype.hasOwnProperty.call(loaderData, entry.field)) {
      observeThenables(data);
      throw new Error('missing declared deferred field ' + entry.field);
    }
  }
  for (const [field, value] of Object.entries(loaderData)) {
    if (!declared.has(field) && value != null && typeof (value as Thenable).then === 'function') {
      // Observe every thenable, not just this one: the loader may carry
      // several undeclared promises and this loop reports the first.
      observeThenables(data);
      throw new Error('undeclared thenable loader field ' + field);
    }
  }
  return records;
}

/**
 * Binds the streaming body builder to the entry's injected Element function
 * (and the policy timeout default): the returned builder is the
 * `__streamBody` call site the generated handler invokes once per streamed
 * response.
 */
export function createStreamBody(config: StreamBodyConfig): StreamBodyFn {
  const { escapeAttr } = config;
  const timeoutMs = config.timeoutMs ?? STREAM_TIMEOUT_MS;
  return function streamBody({ scope, route, manifest, executor, records, document, token }) {
    const encoder = new TextEncoder();
    const identity = {
      request: token,
      program: manifest.program.version + ':' + manifest.program.sha256,
      instance: executor.owner.instanceId,
    };
    const fields = manifest.fields.map((entry) => {
      const property = executor.seed[entry.field];
      return {
        field: entry.field,
        signal: entry.signal,
        type: property.type,
        parts: entry.owners.map((owner) => ({ index: owner.index, kind: owner.kind })),
      };
    });
    const seed = {
      ...identity,
      properties: executor.seed,
      pending: manifest.fields.flatMap((field) => field.owners.map((owner) => owner.index)),
      fields,
    };
    const shell = document.prefix + executor.shell +
      '<template data-oe-seed="' + escapeAttr(streamJson(seed)) + '"></template>';
    let active = true;
    let started = false;
    let tail = false;
    let cancelled = false;
    let wake: (() => void) | undefined;
    let current: string[] = [];
    const queued: StreamFieldRecord[] = [];
    const pending = new Set(records);
    const cleanup = () => {
      if (!active) return;
      active = false;
      clearTimeout(timer);
      scope.upstreamSignal.removeEventListener('abort', abort);
      scope.cancel();
      wake?.();
      wake = undefined;
      for (const record of records) record.notify = undefined;
    };
    const abort = () => {
      cleanup();
    };
    scope.upstreamSignal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => {
      for (const record of pending) {
        record.settled = true;
        record.failed = true;
        record.error = new Error('deferred field timed out');
        queued.push(record);
      }
      pending.clear();
      scope.abortWork();
      wake?.();
    }, timeoutMs);
    for (const record of records) {
      record.notify = () => {
        if (!active || !pending.delete(record)) return;
        queued.push(record);
        wake?.();
      };
      if (record.settled) record.notify();
    }
    if (scope.upstreamSignal.aborted) cleanup();

    return new ReadableStream({
      async pull(controller) {
        if (!active) {
          if (!cancelled) controller.close();
          return;
        }
        if (!started) {
          started = true;
          controller.enqueue(encoder.encode(shell));
          return;
        }
        while (active && current.length === 0 && queued.length === 0 && pending.size > 0) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          wake = undefined;
        }
        // A cancel/abort that lands while this pull is parked at the wake-await
        // resumes it on an already-cancelled stream, where close() throws
        // TypeError ("The stream controller cannot close or enqueue") out of the
        // resumed pull. The stream is already closed in that case, so closing is
        // skipped; an abort without cancel() leaves the stream readable and
        // still needs the close to terminate the body.
        if (!active) {
          if (!cancelled) controller.close();
          return;
        }
        if (current.length === 0 && queued.length) {
          const record = queued.shift()!;
          const { entry } = record;
          try {
            if (record.failed) throw record.error;
            const value = executor.resolvedValue(entry.field, record.value);
            const ranges = executor.serializeResolved(entry.field, record.value);
            current = entry.owners.map((owner, index) => {
              const html = ranges[index];
              const frame = {
                ...identity,
                part: owner.index,
                field: entry.field,
                type: executor.seed[entry.field].type,
                kind: owner.kind,
                outcome: 'content',
                value,
              };
              const encoded = streamJson(frame);
              if (html.length > STREAM_MAX_PAYLOAD_LENGTH) {
                throw new Error('deferred range exceeds the bound');
              }
              return '<template data-oe-frame="' + escapeAttr(encoded) + '">' + html +
                '</template><noscript>' + html + '</noscript>';
            });
          } catch (error) {
            if (isOpenElementRedirect(error) || isOpenElementNotFound(error)) {
              console.error('[openElement] late stream protocol decision', {
                route,
                field: entry.field,
              });
            } else {
              console.error('[openElement] deferred Part failed', {
                route,
                field: entry.field,
                error,
              });
            }
            current = entry.owners.map((owner) =>
              '<template data-oe-frame="' + escapeAttr(streamJson({
                ...identity,
                part: owner.index,
                field: entry.field,
                type: executor.seed[entry.field].type,
                kind: owner.kind,
                outcome: 'error',
              })) + '"></template><noscript><p>Content unavailable.</p></noscript>'
            );
          }
        }
        if (current.length) {
          controller.enqueue(encoder.encode(current.shift()!));
        } else if (!tail) {
          tail = true;
          controller.enqueue(encoder.encode(document.suffix));
          cleanup();
        } else {
          controller.close();
        }
      },
      cancel() {
        cancelled = true;
        cleanup();
      },
    }, { highWaterMark: 0 });
  };
}

/**
 * The browser installer bootstrap — the inline head script of every streamed
 * page: the MutationObserver that scans streaming templates, the typed seed
 * admission against the same policy budgets the server enforced, the anchor
 * range ownership check, the frame markup safety screen, and the pagehide
 * retirement/BFCache contract. The module owns the string so the server pump
 * and the browser installer read the same constants from one place; S4 will
 * re-home it from the per-page inline form to a shared asset.
 */
export const STREAM_BROWSER_BOOTSTRAP: string = `(function () {
  'use strict';
  var seeds = new Map();
  var terminals = new Map();
  var seen = new WeakSet();
  var stateKey = Symbol.for('openelement.stream-state.v1');
  var controlKey = Symbol.for('openelement.stream-control.v1');
  var control = {
    token: 'preseed',
    pending: true,
    retired: false,
    cancel: function () {
      if (control.retired) return;
      control.retired = true;
      control.pending = false;
      for (var seed of seeds.values()) seed.listeners.clear();
    }
  };
  Object.defineProperty(document, controlKey, { value: control, configurable: true });
  var maxPayload = ${STREAM_MAX_PAYLOAD_LENGTH};
  var maxNodes = 10000;
  var forbiddenFrameTags = new Set(${JSON.stringify(STREAM_FRAME_FORBIDDEN_TAGS)});
  var frameUrlAttributes = new Set(${JSON.stringify(STREAM_FRAME_URL_ATTRIBUTES)});
  var frameUrlControlMax = ${STREAM_FRAME_URL_CONTROL_MAX};
  var unsafeFrameUrl = ${STREAM_FRAME_UNSAFE_URL};
  function report(reason, frame) {
    console.warn('[openElement] rejected streamed Part frame', {
      reason: reason,
      request: frame && frame.request,
      program: frame && frame.program,
      instance: frame && frame.instance,
      part: frame && frame.part
    });
  }
  function record(template, attribute) {
    try {
      var raw = template.getAttribute(attribute);
      if (!raw || raw.length > maxPayload) return null;
      var value = JSON.parse(raw);
      return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    } catch (_) {
      return null;
    }
  }
  function validType(type, value) {
    if (value === null) return true;
    if (type === 'string') return typeof value === 'string';
    if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
    if (type === 'boolean') return typeof value === 'boolean';
    if (type === 'array') return Array.isArray(value) && safeJson(value, 0);
    if (type === 'object') return value !== null && typeof value === 'object' &&
      !Array.isArray(value) && safeJson(value, 0);
    return false;
  }
  function safeJson(value, depth) {
    if (depth > 32) return false;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (Array.isArray(value)) return value.length <= maxNodes &&
      value.every(function (item) { return safeJson(item, depth + 1); });
    if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false;
    var keys = Object.keys(value);
    return keys.length <= maxNodes && keys.every(function (key) {
      return key !== '__proto__' && key !== 'constructor' && key !== 'prototype' &&
        safeJson(value[key], depth + 1);
    });
  }
  function key(frame) {
    return frame.request + '|' + frame.program + '|' + frame.instance + '|' + frame.part;
  }
  function rootAndHost(identity) {
    var candidates = document.querySelectorAll('[data-oe-stream-request]');
    var matches = [];
    for (var i = 0; i < candidates.length; i++) {
      var candidate = candidates[i];
      if (candidate.getAttribute('data-oe-stream-request') === identity.request &&
        candidate.getAttribute('data-oe-stream-program') === identity.program &&
        candidate.getAttribute('data-oe-stream-instance') === identity.instance) {
        matches.push(candidate);
      }
    }
    if (matches.length !== 1) return null;
    var host = matches[0];
    return { host: host, root: host.shadowRoot || host };
  }
  function commentRange(root, index) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
    var start = null;
    var end = null;
    var marker = 'oe:p' + index;
    var endMarker = 'oe:/p' + index;
    while (walker.nextNode()) {
      var node = walker.currentNode;
      if (node.data === marker) {
        if (start) return null;
        start = node;
      } else if (node.data === endMarker) {
        if (end) return null;
        end = node;
      }
    }
    if (!start || !end || start.parentNode !== end.parentNode) return null;
    var cursor = start.nextSibling;
    var nodes = [];
    while (cursor && cursor !== end && nodes.length <= maxNodes) {
      nodes.push(cursor);
      cursor = cursor.nextSibling;
    }
    return cursor === end && nodes.length <= maxNodes ? { start: start, end: end, nodes: nodes } : null;
  }
  function safeFragment(fragment) {
    var walker = document.createTreeWalker(fragment, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT);
    var count = 0;
    while (walker.nextNode()) {
      if (++count > maxNodes) return false;
      var node = walker.currentNode;
      if (node.nodeType === Node.COMMENT_NODE) {
        if (/^oe:\\/?p\\d+$/.test(node.data)) return false;
        continue;
      }
      var tag = node.localName;
      if (tag.includes('-') || forbiddenFrameTags.has(tag)) {
        return false;
      }
      for (var i = 0; i < node.attributes.length; i++) {
        var attr = node.attributes[i];
        var name = attr.name.toLowerCase();
        if (name.startsWith('on') || name.startsWith('data-oe-') || name === 'srcdoc') return false;
        if (frameUrlAttributes.has(name) &&
          unsafeFrameUrl.test(attr.value.split('').filter(function (char) {
            return char.charCodeAt(0) > frameUrlControlMax;
          }).join(''))) return false;
      }
    }
    return true;
  }
  function install(template, frame, field) {
    var owner = rootAndHost(frame);
    if (!owner) return 'missing or ambiguous owning host';
    var range = commentRange(owner.root, frame.part);
    if (!range) return 'missing, ambiguous, or cross-parent anchors';
    if (range.nodes.length !== 0) return 'pending range is not empty';
    if (frame.kind === 'part' && field.kind !== 'part' ||
      frame.kind === 'region' && field.kind !== 'region') return 'wrong range kind';
    var fragment = template.content.cloneNode(true);
    if (!safeFragment(fragment)) return 'unsafe range markup';
    if (frame.outcome === 'error' && (
      fragment.childNodes.length !== 0 ||
      Object.prototype.hasOwnProperty.call(frame, 'value')
    )) return 'error frame must have no content or value';
    if (frame.outcome === 'content' && frame.kind === 'part' && (
      fragment.childNodes.length > 1 ||
      fragment.firstChild && fragment.firstChild.nodeType !== Node.TEXT_NODE ||
      // The server serializes a text Part as escapeText(String(value)) while
      // the frame carries the typed value, so the comparison is on the
      // canonical string form: number (including 0), boolean, and null typed
      // values must not be rejected for not being string instances.
      fragment.textContent !== String(frame.value)
    )) return 'text Part markup does not match its typed value';
    while (range.start.nextSibling && range.start.nextSibling !== range.end) {
      range.start.parentNode.removeChild(range.start.nextSibling);
    }
    range.end.parentNode.insertBefore(fragment, range.end);
    template.remove();
    return null;
  }
  function consume(template, attribute) {
    if (seen.has(template)) return;
    seen.add(template);
    if (control.retired) { template.remove(); return; }
    var frame = record(template, attribute);
    if (!frame) { report('malformed payload'); return; }
    if (attribute === 'data-oe-seed') {
      if (typeof frame.request !== 'string' || typeof frame.program !== 'string' ||
        typeof frame.instance !== 'string' || !frame.properties || !Array.isArray(frame.fields) ||
        !Array.isArray(frame.pending) || frame.fields.length > ${STREAM_MAX_FIELDS} || frame.pending.length > ${STREAM_MAX_OWNERS}) {
        report('malformed seed', frame);
        return;
      }
      var fields = new Map();
      for (var i = 0; i < frame.fields.length; i++) {
        var field = frame.fields[i];
        if (!field || typeof field.field !== 'string' || field.signal !== field.field ||
          !Array.isArray(field.parts) || field.parts.length === 0 ||
          !['string', 'number', 'boolean', 'array', 'object'].includes(field.type) ||
          !frame.properties[field.field] ||
          frame.properties[field.field].state !== 'pending' ||
          frame.properties[field.field].type !== field.type ||
          !field.parts.every(function (part) {
            return part && Number.isInteger(part.index) && part.index >= 0 &&
              (part.kind === 'part' || part.kind === 'region');
          })) {
          report('malformed field authorization', frame);
          return;
        }
        for (var j = 0; j < field.parts.length; j++) {
          var part = field.parts[j];
          if (fields.has(part.index) || frame.pending.indexOf(part.index) < 0) {
            report('duplicate or unauthorized seed Part', frame);
            return;
          }
          fields.set(part.index, Object.assign({}, field, { kind: part.kind }));
        }
      }
      if (fields.size !== frame.pending.length || frame.pending.some(function (part) {
        return !fields.has(part);
      })) {
        report('seed Part set mismatch', frame);
        return;
      }
      var names = Object.keys(frame.properties);
      if (names.length > ${STREAM_MAX_SEED_PROPERTIES} || !names.every(function (name) {
        var property = frame.properties[name];
        return name !== '__proto__' && name !== 'constructor' && name !== 'prototype' &&
          property && typeof property === 'object' &&
          ['string', 'number', 'boolean', 'array', 'object'].includes(property.type) &&
          ['resolved', 'pending', 'missing'].includes(property.state) &&
          (property.state === 'resolved') === Object.prototype.hasOwnProperty.call(property, 'value') &&
          (property.state !== 'resolved' || validType(property.type, property.value));
      })) {
        report('invalid typed property seed', frame);
        return;
      }
      var owner = rootAndHost(frame);
      if (!owner) { report('missing or ambiguous seed host', frame); return; }
      var id = frame.request + '|' + frame.program + '|' + frame.instance;
      if (seeds.size !== 0) {
        report('duplicate seed identity', frame);
        template.remove();
        return;
      }
      var listeners = new Set();
      var state = {
        request: frame.request, program: frame.program, instance: frame.instance,
        properties: frame.properties, parts: frame.pending.slice(),
        pending: new Set(frame.pending),
        listen: function (callback) {
          listeners.add(callback);
          return function () { listeners.delete(callback); };
        }
      };
      Object.defineProperty(owner.host, stateKey, { value: state, configurable: true });
      seeds.set(id, { identity: frame, fields: fields, state: state, listeners: listeners,
        fieldValues: new Map(), remaining: new Set(frame.pending) });
      control.token = id;
      return;
    }
    if (typeof frame.request !== 'string' || typeof frame.program !== 'string' ||
      typeof frame.instance !== 'string' || !Number.isInteger(frame.part) || frame.part < 0 ||
      typeof frame.field !== 'string' || (frame.outcome !== 'content' && frame.outcome !== 'error')) {
      report('malformed frame identity or outcome', frame);
      return;
    }
    var id = frame.request + '|' + frame.program + '|' + frame.instance;
    var seed = seeds.get(id);
    var expected = seed && seed.fields.get(frame.part);
    if (!expected || expected.field !== frame.field || expected.signal !== frame.field ||
      expected.kind !== frame.kind || expected.type !== frame.type) {
      report('unknown or unauthorized tuple', frame);
      return;
    }
    if (frame.outcome === 'content' && !validType(frame.type, frame.value)) {
      report('typed value mismatch', frame);
      return;
    }
    if (frame.outcome === 'content' && seed.fieldValues.has(frame.field) &&
      seed.fieldValues.get(frame.field) !== JSON.stringify(frame.value)) {
      report('conflicting field value', frame);
      return;
    }
    var tuple = key(frame);
    var fingerprint = JSON.stringify(frame) + '\\u0000' + template.innerHTML;
    if (terminals.has(tuple)) {
      if (terminals.get(tuple) !== fingerprint) report('conflicting terminal duplicate', frame);
      template.remove();
      return;
    }
    var failure = install(template, frame, expected);
    if (failure) { report(failure, frame); return; }
    terminals.set(tuple, fingerprint);
    seed.remaining.delete(frame.part);
    if (seed.remaining.size === 0) control.pending = false;
    if (frame.outcome === 'content') {
      seed.fieldValues.set(frame.field, JSON.stringify(frame.value));
      seed.state.properties[frame.field] = {
        state: 'resolved', type: frame.type, value: frame.value
      };
      seed.state.pending.delete(frame.part);
    }
    for (var callback of seed.listeners) {
      try {
        callback(frame.part, frame.field, frame.outcome);
      } catch (error) {
        report('stream claim listener failed: ' + String(error), frame);
      }
    }
  }
  function scan(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    var element = node;
    if (element.matches('template[data-oe-seed]')) consume(element, 'data-oe-seed');
    else if (element.matches('template[data-oe-frame]')) consume(element, 'data-oe-frame');
    var nested = element.querySelectorAll('template[data-oe-seed],template[data-oe-frame]');
    for (var i = 0; i < nested.length; i++) {
      var template = nested[i];
      if (template.hasAttribute('data-oe-seed')) consume(template, 'data-oe-seed');
      else consume(template, 'data-oe-frame');
    }
  }
  var observer = new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i++) {
      for (var j = 0; j < records[i].addedNodes.length; j++) scan(records[i].addedNodes[j]);
    }
  });
  addEventListener('pagehide', function (event) {
    if (!event.persisted) control.cancel();
  });
  observer.observe(document, { childList: true, subtree: true });
  scan(document.documentElement);
})();`;
