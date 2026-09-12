// Register the real @openelement/ui custom elements from a Fresh island to
// prove Fresh ↔ custom-element interop. The packed npm package ships
// pre-transpiled jsx() output, so it runs through the Fresh/Preact Vite
// pipeline without any JSX transform conflict.

import { registerOpenUi } from '@openelement/ui';

export default function OpenElementsIsland() {
  // Islands render on the server too; custom element registration is
  // browser-only.
  if (typeof window !== 'undefined') {
    registerOpenUi();
  }
  return null;
}
