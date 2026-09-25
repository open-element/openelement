/**
 * Streamed-claim ordering against the REAL browser platform.
 *
 * The connectedCallback order owns the early-frame claim: a resolved stream
 * seed must be applied AFTER pre-upgrade JS property sets (pendingOwnValues),
 * or a pre-upgrade write overwrites the early-arrived frame's server value,
 * the claim text drifts from the server-rendered DOM, and — with owning
 * recovery disabled in stream mode — the element never hydrates.
 *
 * Only a real browser can produce the pre-upgrade write channel: the write
 * must land as an own data property on the not-yet-upgraded element, which is
 * exactly what happens between parser insertion and customElements.define.
 * The simulated-DOM suite (facade-dom.ts) cannot express that window because
 * document.createElement runs the compiled constructor immediately.
 */
import { assert } from "chai";
import { OpenElement } from "@openelement/element";
import { STREAM_STATE_KEY } from "../../src/internal/compiled/stream-state.ts";
import { createDeferredServerExecutor } from "../../src/internal/compiled/server/index.ts";
import { signal } from "../../src/internal/signal/framework.ts";
import { testProgram } from "../../__tests__/compiled-runtime/test-program.ts";

function buildFixture(tag) {
  const program = testProgram({
    tag,
    rootMode: "light",
    template: [{
      k: "el",
      tag: "main",
      attrs: [],
      children: [{ k: "text", value: "Start " }, { k: "part", index: 0 }],
    }],
    parts: [{ k: "text", index: 0, signal: "label" }],
    properties: [{
      name: "label",
      attribute: null,
      type: "string",
      converter: "string",
      reflect: false,
      default: "",
    }],
  });

  const Compiled = class extends OpenElement {};
  Compiled.__partProgram = program;
  Compiled.__compiledProperties = program.metadata.properties;
  Compiled.__elementMetadata = program.metadata;

  const owner = { program, version: program.version, instanceId: "instance-1" };
  const executor = createDeferredServerExecutor(
    program,
    { signals: { label: signal("") }, handlers: {} },
    { owner, pendingParts: [0] },
    { mode: "light" },
  );
  const identity = `${program.version}:test-hash`;
  const html = executor.shell.replace(
    `<${tag} `,
    `<${tag} data-oe-stream-request="request-1" ` +
      `data-oe-stream-program="${identity}" data-oe-stream-instance="${owner.instanceId}" `,
  );
  const seedState = (seed) => {
    const listeners = new Set();
    const state = {
      request: "request-1",
      program: identity,
      instance: owner.instanceId,
      properties: { label: seed },
      parts: [0],
      pending: new Set(seed.state === "resolved" ? [] : [0]),
      listen(callback) {
        listeners.add(callback);
        return () => listeners.delete(callback);
      },
    };
    return { state, listeners };
  };
  return { Compiled, html, seedState };
}

describe("streamed claim ordering", () => {
  it("an early frame's server value wins over a pre-upgrade JS write and the claim succeeds", () => {
    const tag = "oe-stream-order";
    const { Compiled, html, seedState } = buildFixture(tag);

    // Server shell + an early backfilled frame: the range already carries the
    // resolved text when the element upgrades. Range layout is
    // ['Start ', <!--oe:p0-->, text, <!--oe:/p0-->] — the claimed text sits at
    // child index 2.
    const template = document.createElement("template");
    template.innerHTML = html;
    const parsed = template.content.firstElementChild;
    const host = document.createElement(tag); // NOT defined yet
    for (const attribute of [...parsed.attributes]) {
      host.setAttribute(attribute.name, attribute.value);
    }
    const main = parsed.firstElementChild;
    host.appendChild(main);
    const end = [...main.childNodes].find(
      (node) => node.nodeType === 8 && node.data === "oe:/p0",
    );
    const earlyNode = document.createTextNode("Early");
    main.insertBefore(earlyNode, end);

    Object.defineProperty(host, STREAM_STATE_KEY, {
      value: seedState({ state: "resolved", type: "string", value: "Early" }).state,
      configurable: true,
    });

    // The pre-upgrade JS write: an own data property on the un-upgraded
    // element (HTMLElement has no `label` IDL attribute, so nothing intercepts
    // it before the compiled accessor exists).
    host.label = "Client";
    assert.isTrue(
      Object.prototype.hasOwnProperty.call(host, "label"),
      "the pre-upgrade write must land as an own data property",
    );

    document.body.appendChild(host);
    customElements.define(tag, Compiled); // upgrade + connect now

    // The resolved seed applied after pendingOwnValues wins: the signal holds
    // the server value, so the claim text matches the server-rendered DOM and
    // the element hydrates in place (no fresh render, no stranded element).
    assert.strictEqual(host.label, "Early", "server seed wins over the pre-upgrade write");
    assert.strictEqual(main.childNodes[2], earlyNode, "claimed node identity is preserved");
    host.label = "Updated";
    assert.strictEqual(earlyNode.data, "Updated", "the claimed Part is live after hydration");
    host.remove();
  });

  it("a late frame still lets a pre-connect JS write win until the server value arrives", () => {
    const tag = "oe-stream-order-late";
    const { Compiled, html, seedState } = buildFixture(tag);

    const template = document.createElement("template");
    template.innerHTML = html;
    const parsed = template.content.firstElementChild;
    const host = document.createElement(tag);
    for (const attribute of [...parsed.attributes]) {
      host.setAttribute(attribute.name, attribute.value);
    }
    host.appendChild(parsed.firstElementChild); // empty pending range

    const { state, listeners } = seedState({ state: "pending", type: "string" });
    Object.defineProperty(host, STREAM_STATE_KEY, {
      value: state,
      configurable: true,
    });
    host.label = "Local";
    document.body.appendChild(host);
    customElements.define(tag, Compiled);

    // Pending seed: the pre-upgrade JS value is visible until the frame lands…
    assert.strictEqual(host.label, "Local");
    // …then the late frame's server value wins (existing contract).
    state.properties.label = { state: "resolved", type: "string", value: "Server" };
    state.pending.delete(0);
    for (const listener of listeners) listener(0, "label", "content");
    assert.strictEqual(host.label, "Server");
    host.remove();
  });
});
