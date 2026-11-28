import { definePage } from '@openelement/router';

export function DeferredCapability() {
  return (
    <main>
      <h1>Deferred capability</h1>
      <div style="height: 240vh" aria-hidden="true"></div>
      <deferred-counter></deferred-counter>
    </main>
  );
}

export default definePage(DeferredCapability);
