/**
 * zag-combobox — #1149 spike island (shadow/DSD variant).
 *
 * GENERATED lane (F16: class → function). The compiled component owns SSR
 * (DSD), the shadow render root, and the lifecycle; the Zag machine starts one
 * macrotask after `onConnect` — the point the class lane's `onDsdHydrated`
 * (claim path) and `onCsrRendered` (fresh-creation path) hooks ran, and the
 * first moment the strict claim has finished validating the static attribute
 * set — and stops from the `onConnect` cleanup at that disconnection (the class
 * lane's `disconnectedCallback`). Zag scopes itself to this island's ShadowRoot
 * via `getRootNode`, so two instances on one page cannot query or collide with
 * each other. Machine state lives in zag-combobox-shared.ts (a WeakMap keyed
 * by host); the component carries only the sidecar's declared rows.
 *
 * The structure below is fully static by design — the compiled grammar v1 has
 * no per-item attribute slots, so the five combobox items are literal markup;
 * Zag drives all per-item behavior (hidden, data-highlighted, ARIA) after
 * activation.
 *
 * Host surface: the sidecar declares the class lane's `machine-id` attribute
 * row plus the two rows the e2e spec drives in place of the retired authored
 * methods — `controlledValue` (write-to-drive) and `machineSnapshot` (the
 * machine writes it back on every publish). Both are `attribute: false`: the
 * class exposed them as instance methods, never as attributes, and ADR-0182
 * records that the generated lane has no authored-method capability.

/**
 * MEASURED LANE LIMITATION — reconnect cannot re-claim this island yet.
 *
 * The cleanup restores the claimed structure exactly (ordered attribute seeds,
 * reflected `hidden`), which is what the strict claim compares, and it stops
 * the machine. The generated claim then still fails on a SAME-TURN
 * disconnect/reconnect with `consumed: ordinal 0 is already committed`: this
 * island's markup is a PURE STATIC directory (every child of the root/control/
 * positioner/content elements is a static element), the generator claims such a
 * directory through the M07b static-sibling-range consumer
 * (packages/compiler/src/internal/compiler/semantic-ir/generated-leaf/generate.ts:3929
 * `staticElementDirectory`), and that consumer keeps a permanent per-parent
 * ordinal tombstone
 * (packages/element/src/internal/compiled/runtime/static-sibling-ranges.ts:505,546,
 * set at :585-587, never released — `rollbackProvisional` only rolls back an
 * INCOMPLETE attempt, :465-470) while the shell re-claims the retained region on
 * reconnect (packages/element/src/internal/compiled/generated-element/shell.ts:2827-2831).
 * The class lane that this fixture used before F16 had no such tombstone, so the
 * spec's same-turn-move row was green there and is red here. The failed claim
 * also aborts the connection scope, which cancels the pending machine start.
 * Fixing it is a packages/ change (release the tombstones for a disposed owner
 * or skip the re-claim of an already-claimed retained region), not a fixture
 * change.
 */
import { onConnect, onPropertyChange } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';
import {
  resetAndStopZagCombobox,
  startZagComboboxForRoot,
  zagComboboxSetControlledValue,
  type ZagComboboxHost,
} from '../components/zag-combobox-shared.ts';

export const openElement = defineIslandConfig({
  hydrate: 'load',
  ssr: true,
  dsd: true,
  // The class declared `shadow-open`; the spec asserts the island's wire form is
  // `<zag-combobox …><template shadowrootmode="open">` and reads every part out
  // of `zag-combobox.shadowRoot`, so the root must be a shadow root.
  root: 'shadow',
  styles: ['./zag-combobox.css'],
  properties: {
    machineId: { default: '' },
    controlledValue: { attribute: false, default: '' },
    machineSnapshot: { attribute: false, default: '' },
  },
});

// The declared rows are the host API and are driven through the sidecar's
// change channel, never read in this render body, so the parameter is unused by
// design (the compiler still needs the declared signature shape).
export default function ZagCombobox(_props: {
  machineId: string;
  controlledValue: string;
  machineSnapshot: string;
}) {
  onConnect((env) => {
    const host = env.host as ZagComboboxHost;
    // `onConnect` is replayed in the mount/claim PROLOGUE, before the generated
    // region is the rendered tree and before the strict claim validates the
    // static attribute set (the static-attribute claim contract); this callback both queries
    // that region and lets Zag write attributes, so it defers one macrotask —
    // the same deferral www/app/islands/open-dialog.tsx uses for its
    // post-DOM sync. The connect handle's abort clears a pending start so a
    // disconnect cannot start a machine against a dead connection.
    const timer = globalThis.setTimeout(() => startZagComboboxForRoot(host, 'shadow'), 0);
    env.signal.addEventListener('abort', () => globalThis.clearTimeout(timer));
    return () => resetAndStopZagCombobox(host);
  });
  // The e2e controlled-prop path: the class's authored
  // `demoSetControlledValue(value)` is retired with the class, so the spec
  // writes the declared `controlledValue` row and this declared-row change
  // channel drives machine.updateProps. Every other row write (machineId,
  // machineSnapshot) is ignored.
  onPropertyChange((event) => {
    if (event.name !== 'controlledValue') return;
    zagComboboxSetControlledValue(event.host as ZagComboboxHost, event.value as string);
  });

  return (
    <div class='zag-combobox' data-part='root'>
      {/* Every text child stays on its tag's own line: a wrapped text child
          changes the serialized text node, and the point of this migration is
          that the DOM is unchanged (see the note-counter migration). */}
      <label class='zag-combobox-label' data-part='label'>Shadow fruit</label>
      <div class='zag-combobox-control' data-part='control'>
        <input
          class='zag-combobox-input'
          data-part='input'
          type='text'
          placeholder='Type or pick a fruit'
          autocomplete='off'
        />
        <button class='zag-combobox-trigger' data-part='trigger' type='button'>▾</button>
      </div>
      <div class='zag-combobox-positioner' data-part='positioner'>
        <ul class='zag-combobox-content' data-part='content'>
          <li class='zag-combobox-item' data-part='item' data-value='apple'>Apple</li>
          <li class='zag-combobox-item' data-part='item' data-value='banana'>Banana</li>
          <li class='zag-combobox-item' data-part='item' data-value='cherry' data-disabled=''>Cherry</li>
          <li class='zag-combobox-item' data-part='item' data-value='mango'>Mango</li>
          <li class='zag-combobox-item' data-part='item' data-value='orange'>Orange</li>
        </ul>
      </div>
    </div>
  );
}
