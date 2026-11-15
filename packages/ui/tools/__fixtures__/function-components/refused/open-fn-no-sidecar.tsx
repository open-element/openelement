/**
 * Fixture for the manifest generator's generated-element branch: a function
 * component module WITHOUT the island policy statement. The compiler lane
 * refuses it (`OEIR_GENERATED_ELEMENT_MISSING_SITE_MARKER`), and the projection
 * must surface that refusal instead of forwarding a class declaration.
 */
function FnNoSidecar() {
  return <p part='root'>no island sidecar</p>;
}

export default FnNoSidecar;
