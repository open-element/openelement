/** Request-local helpers emitted only when an entry has an admitted stream route. */
import {
  STREAM_FRAME_FORBIDDEN_TAGS,
  STREAM_FRAME_UNSAFE_URL,
  STREAM_FRAME_URL_ATTRIBUTES,
  STREAM_FRAME_URL_CONTROL_MAX,
} from '@openelement/element';

export function renderStreamRuntime(timeoutMs = 30_000): string {
  return `
function __streamBrowserBootstrap() {
  return ${JSON.stringify(renderStreamBrowserBootstrap())};
}

function __streamRequestScope(original) {
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

function __streamHeaderChannel(route) {
  const headers = new Headers();
  let committed = false;
  const channel = new Proxy(headers, {
    get(target, key) {
      if (key === 'append' || key === 'set' || key === 'delete') {
        return (name, value) => {
          if (committed) {
            console.warn('[openElement] late response header write', { route, header: String(name), operation: key });
            return;
          }
          return target[key](name, value);
        };
      }
      if (key === 'forEach') {
        return (callback, thisArg) =>
          target.forEach((value, name) => callback.call(thisArg, value, name, channel));
      }
      const member = Reflect.get(target, key, target);
      return typeof member === 'function' ? member.bind(target) : member;
    },
  });
  return { channel, commit: () => { committed = true; } };
}

function __streamJson(value) {
  const text = JSON.stringify(value);
  if (text === undefined || text.length > 262144) throw new Error('stream payload exceeds the bound');
  return text.replace(/[<>&\\u2028\\u2029]/g, char => ({
    '<': '\\\\u003C', '>': '\\\\u003E', '&': '\\\\u0026',
    '\\u2028': '\\\\u2028', '\\u2029': '\\\\u2029',
  })[char]);
}

// A front-gate throw must never strand an unobserved loader rejection: the
// request scope's per-field observers may not exist yet (or may not cover
// every entry), and an unhandled rejection would kill the process instead of
// surfacing as the 500 the route contract promises. Every exit below sweeps
// the loader value itself (a non-object shape may itself be thenable) and all
// its entries first.
function __streamObserveThenables(data) {
  if (data != null && typeof data.then === 'function') {
    Promise.resolve(data).catch(() => {});
  }
  if (data && typeof data === 'object') {
    for (const value of Object.values(data)) {
      if (value != null && typeof value.then === 'function') {
        Promise.resolve(value).catch(() => {});
      }
    }
  }
}
function __streamFields(data, manifest) {
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      (Object.getPrototypeOf(data) !== Object.prototype && Object.getPrototypeOf(data) !== null)) {
    __streamObserveThenables(data);
    throw new Error('stream loader must return one object');
  }
  if (manifest.fields.length > 32 ||
      manifest.fields.reduce((count, field) => count + field.owners.length, 0) > 64) {
    __streamObserveThenables(data);
    throw new Error('stream manifest exceeds the bounded field/Part budget');
  }
  const declared = new Set(manifest.fields.map(entry => entry.field));
  const records = manifest.fields.map(entry => {
    const record = { entry, settled: false, failed: false, error: undefined, value: undefined };
    // Install both observers synchronously, including for already-rejected promises.
    if (Object.prototype.hasOwnProperty.call(data, entry.field)) Promise.resolve(data[entry.field]).then(
      value => {
        if (record.settled) return;
        record.settled = true; record.value = value; record.notify?.();
      },
      error => {
        if (record.settled) return;
        record.settled = true; record.failed = true; record.error = error; record.notify?.();
      },
    );
    return record;
  });
  for (const entry of manifest.fields) {
    if (!Object.prototype.hasOwnProperty.call(data, entry.field)) {
      __streamObserveThenables(data);
      throw new Error('missing declared deferred field ' + entry.field);
    }
  }
  for (const [field, value] of Object.entries(data)) {
    if (!declared.has(field) && value != null && typeof value.then === 'function') {
      // Observe every thenable, not just this one: the loader may carry
      // several undeclared promises and this loop reports the first.
      __streamObserveThenables(data);
      throw new Error('undeclared thenable loader field ' + field);
    }
  }
  return records;
}

function __streamBody({ scope, route, manifest, executor, records, document, token }) {
  const encoder = new TextEncoder();
  const identity = {
    request: token,
    program: manifest.program.version + ':' + manifest.program.sha256,
    instance: executor.owner.instanceId
  };
  const fields = manifest.fields.map(entry => {
    const property = executor.seed[entry.field];
    return {
      field: entry.field,
      signal: entry.signal,
      type: property.type,
      parts: entry.owners.map(owner => ({ index: owner.index, kind: owner.kind })),
    };
  });
  const seed = { ...identity, properties: executor.seed, pending: manifest.fields.flatMap(field =>
    field.owners.map(owner => owner.index)), fields };
  const shell = document.prefix + executor.shell +
    '<template data-oe-seed="' + escapeAttr(__streamJson(seed)) + '"></template>';
  let active = true;
  let started = false;
  let tail = false;
  let wake;
  let current = [];
  const queued = [];
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
  const abort = () => { cleanup(); };
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
  }, ${timeoutMs});
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
      if (!active) { controller.close(); return; }
      if (!started) {
        started = true;
        controller.enqueue(encoder.encode(shell));
        return;
      }
      while (active && current.length === 0 && queued.length === 0 && pending.size > 0) {
        await new Promise(resolve => { wake = resolve; });
        wake = undefined;
      }
      if (!active) { controller.close(); return; }
      if (current.length === 0 && queued.length) {
        const record = queued.shift();
        const { entry } = record;
        try {
          if (record.failed) throw record.error;
          const value = executor.resolvedValue(entry.field, record.value);
          const ranges = executor.serializeResolved(entry.field, record.value);
          current = entry.owners.map((owner, index) => {
            const html = ranges[index];
            const frame = { ...identity, part: owner.index, field: entry.field,
              type: executor.seed[entry.field].type, kind: owner.kind, outcome: 'content', value };
            const encoded = __streamJson(frame);
            if (html.length > 262144) throw new Error('deferred range exceeds the bound');
            return '<template data-oe-frame="' + escapeAttr(encoded) + '">' + html +
              '</template><noscript>' + html + '</noscript>';
          });
        } catch (error) {
          if (__isOpenElementRedirect(error) || __isOpenElementNotFound(error)) {
            console.error('[openElement] late stream protocol decision', { route, field: entry.field });
          } else {
            console.error('[openElement] deferred Part failed', { route, field: entry.field, error });
          }
          current = entry.owners.map(owner =>
            '<template data-oe-frame="' + escapeAttr(__streamJson({
              ...identity, part: owner.index, field: entry.field,
              type: executor.seed[entry.field].type, kind: owner.kind, outcome: 'error',
            })) + '"></template><noscript><p>Content unavailable.</p></noscript>');
        }
      }
      if (current.length) {
        controller.enqueue(encoder.encode(current.shift()));
      } else if (!tail) {
        tail = true;
        controller.enqueue(encoder.encode(document.suffix));
        cleanup();
      } else {
        controller.close();
      }
    },
    cancel() { cleanup(); },
  }, { highWaterMark: 0 });
}
`;
}

export function renderStreamBrowserBootstrap(): string {
  return `(function () {
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
  var maxPayload = 262144;
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
        !Array.isArray(frame.pending) || frame.fields.length > 32 || frame.pending.length > 64) {
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
      if (names.length > 64 || !names.every(function (name) {
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
}
