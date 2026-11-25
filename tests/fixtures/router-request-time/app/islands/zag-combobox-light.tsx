/**
 * zag-combobox-light — #1149 spike island (light-mode variant).
 *
 * GENERATED lane (F16: class → function), default light root.
 *
 * Light-mode qualification path composing with ADR-0142 (#1148): the SSR'd
 * light subtree carries data-oe-light and is claimed in place — node
 * identity, focus, and the pre-upgrade input value survive, and the Zag
 * machine then binds to that surviving DOM (seeding defaultInputValue from
 * the live input, see zag-combobox-shared.ts). Form participation is real
 * here: the input lives in the same tree as the page's <form>, so a native
 * POST carries the selected value.
 *
 * Lifecycle: `onConnect` replays after either activation (the class lane's
 * `onDsdHydrated` / `onCsrRendered` pair), but in the mount/claim PROLOGUE —
 * before the region is the rendered tree and before the strict claim has
 * validated the static attribute set — so the machine starts one macrotask
 * later (the static-attribute claim contract; www/app/islands/open-dialog.tsx). The connect
 * cleanup is the class lane's `disconnectedCallback`: reset the compiled DOM,
 * then stop the machine.
 *
 * Light mode has no shadow style scope, so the Open Props / --oe-* sheet is
 * declared through the sidecar and delivered by the light-root render as a
 * document resource (the class lane emitted it as a compiled static <style>
 * node scoped to the component root class).
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
  // The class declared no root (LIGHT). The spec reads the light provenance
  // marker (`data-oe-light`, emitted only by light-root serialization) and the
  // input's form-participation from the page's OWN tree — a shadow root here
  // would move both.
  root: 'light',
  styles: ['./zag-combobox-light.css'],
  properties: {
    machineId: { default: '' },
    controlledValue: { attribute: false, default: '' },
    machineSnapshot: { attribute: false, default: '' },
  },
});

// The declared rows are the host API and are driven through the sidecar's
// change channel, never read in this render body, so the parameter is unused by
// design (the compiler still needs the declared signature shape).
export default function ZagComboboxLight(_props: {
  machineId: string;
  controlledValue: string;
  machineSnapshot: string;
}) {
  onConnect((env) => {
    const host = env.host as ZagComboboxHost;
    // See this module's header: the replay runs before the claimed/created
    // region exists and before the strict claim validates it, so the machine
    // starts one macrotask later. A disconnect aborts the connect handle and
    // clears a pending start.
    const timer = globalThis.setTimeout(() => startZagComboboxForRoot(host, 'light'), 0);
    env.signal.addEventListener('abort', () => globalThis.clearTimeout(timer));
    return () => resetAndStopZagCombobox(host);
  });
  // The retired `demoSetControlledValue(value)` authored method: the spec writes
  // the declared `controlledValue` row instead and this declared-row change
  // channel drives machine.updateProps.
  onPropertyChange((event) => {
    if (event.name !== 'controlledValue') return;
    zagComboboxSetControlledValue(event.host as ZagComboboxHost, event.value as string);
  });

  return (
    <div class='zag-combobox-light'>
      <div class='zag-combobox' data-part='root'>
        {/* Every text child stays on its tag's own line: a wrapped text child
            changes the serialized text node, and the point of this migration
            is that the DOM is unchanged (see the note-counter migration). */}
        <label class='zag-combobox-label' data-part='label'>Fruit</label>
        <div class='zag-combobox-control' data-part='control'>
          <input
            class='zag-combobox-input'
            data-part='input'
            type='text'
            name='fruit'
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
    </div>
  );
}
