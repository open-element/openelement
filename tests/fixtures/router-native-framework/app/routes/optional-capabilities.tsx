import { definePage } from '@openelement/router';

export function OptionalCapabilities() {
  return (
    <main>
      <h1>Optional component capabilities</h1>
      <capability-provider>
        <capability-reader></capability-reader>
      </capability-provider>
    </main>
  );
}

export default definePage(OptionalCapabilities);
