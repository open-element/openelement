/**
 * Keyed-list fixture for the micro suite (issue #1219), modeled on the upstream
 * js-framework-benchmark keyed implementation.
 *
 * WHY THIS IS A GENERATED ELEMENT, NOT A CLASS. The suite measures compiler
 * throughput over one realistic component and then runs the compiled result
 * through the real runtime. The class/decorator lane and its `@element` /
 * `@property` author form were deleted with the Alpha16 closeout, so the
 * fixture is authored in the lane that ships: one `defineIslandConfig` sidecar
 * carrying the element facts (light root, one non-primitive `rows` property)
 * plus one default-exported function component. `micro.ts` compiles this file
 * with `compileGeneratedElementIfAdmitted` and drives the emitted mount/claim
 * functions; nothing here is executed uncompiled.
 *
 * WHY THE ROWS COME IN AS A PROP. The old fixture owned `rows` as a class
 * property and the benchmark wrote a host signal to drive it. The generated
 * lane's root setup can only be seeded from the element's props (the sidecar
 * `properties` row), so `rows` is a declared non-primitive prop: the benchmark
 * supplies the 1 000 rows for the mount/SSR phases, and the component copies
 * them into a local signal once so the block-op phases can write that signal
 * in place (a prop read is not a writable channel from inside the component).
 *
 * WHY `<ul>`/`<li>` INSTEAD OF `<table>`/`<tbody>`/`<tr>`. A keyed list is
 * claimable and SSR-producible only in a flow parser context: the generated
 * lane's list slice excludes the table contexts (a list under `<tbody>` emits
 * mount only). The suite reports serialize, fresh, claim and the block ops at
 * 1 000 rows, so the row list lives in the flow context that admits all four;
 * the row's DOM shape (id text, label anchor, remove anchor, empty cell) is
 * kept from the old fixture.
 *
 * WHY THE DELEGATED CLICK HANDLER STAYS. The old fixture installed one
 * delegated click handler on the table; the stability probe asserts that a
 * created-and-disposed instance retains zero listeners. The handler body is
 * intentionally empty: the old body selected/removed a row by mutating the
 * row data and a dynamic `class`, and a dynamic class is outside the generated
 * lane's attribute slice, so porting the selection would measure a DOM the
 * lane cannot render. The listener's existence and cleanup ownership are the
 * measured facts.
 */
import { defineIslandConfig } from '@openelement/router';
import { signal } from '@openelement/element';

export const openElement = defineIslandConfig({
  root: 'light',
  properties: {
    // A non-primitive row list has no attribute wire, so the row must declare
    // `attribute: false` explicitly; the literal array default is the lane's
    // required shape for a non-primitive row and leaves the empty list as the
    // element's initial value.
    rows: { attribute: false, default: [] },
  },
});

function OeBenchTable(props: { rows: { id: number; label: string; cls: string }[] }) {
  const rows = signal(props.rows);
  const handleTableClick = (): void => {
    // See the module comment: the listener is the measured resource, not the
    // selection behavior the retired class fixture implemented here.
  };
  return (
    <div class='container'>
      <ul class='table test-data' onClick={handleTableClick}>
        {rows.value.map((row) => (
          <li key={row.id} data-id={row.id}>
            <span class='col-md-1'>{row.id}</span>
            <span class='col-md-4'>
              <a>{row.label}</a>
            </span>
            <span class='col-md-1'>
              <a>
                <span class='glyphicon glyphicon-remove' aria-hidden='true'></span>
              </a>
            </span>
            <span class='col-md-6'></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default OeBenchTable;
