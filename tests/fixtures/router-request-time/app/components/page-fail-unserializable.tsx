/**
 * /fail-unserializable page element — static markup; the fail()-payload
 * protocol cases live in the route module's action (#1146 area 4).
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ tag: 'fail-unserializable', root: 'shadow' });

export default function FailUnserializablePage() {
  return (
    <main>
      <h1>fail-unserializable</h1>
      <form method='post'>
        <button type='submit'>go</button>
      </form>
    </main>
  );
}
