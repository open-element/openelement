// Root route for the light-mode probe fixture (#1148 / ADR-0142).
//
// The route module only declares the descriptor: the page component and the
// island live in their own modules so the compiled-element grammar applies.
// No meta export, no i18n, no site shell — this fixture exists to prove
// in-place activation after a delayed upgrade on real public exports.

import { definePage } from '@openelement/router';
import LightProbePage from '../components/page-light-probe.tsx';

export default definePage(LightProbePage, {
  head: {
    title: 'Light-mode activation probe',
    description: 'Internal end-to-end probe for the compiled light-root rendering path.',
    canonical: 'https://fixture.example.test/',
  },
});
