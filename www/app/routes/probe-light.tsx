// E2E probe route for #1148 / ADR-0142 (light-mode in-place activation).
//
// Deliberate deviations from content routes like roadmap.tsx:
//
// - No `meta` export: the generated navigation only admits routes with a
//   static section+label meta, and the header nav is hand-configured, so this page
//   enters neither. It is also excluded from sitemap.xml via the explicit
//   exclude list in tools/lib/www-sitemap.ts (#1327: the sitemap enumerates
//   the route catalog, so exclusion is a public-eligibility decision, not a
//   dist-scan filter).
// - The page component is a light-root element (see
//   ../components/page-probe-light.tsx for why); the route module only
//   declares the descriptor.

import { definePage } from '@openelement/router';
import { siteHead } from '@openelement/site-ui/head.ts';
import { contentLocale } from '@openelement/site-ui/locale.ts';
import ProbeLightPage from '../components/page-probe-light.tsx';

const content = {
  en: {
    headTitle: 'Light-root probe',
    headDescription:
      'Internal end-to-end probe route for the compiled light-root rendering path; not a public surface.',
  },
  zh: {
    headTitle: 'Light-root 探针',
    headDescription: '编译型 light-root 渲染路径的内部端到端探针路由；非公开页面。',
  },
} as const;

export default definePage(ProbeLightPage, {
  head({ locale }) {
    const resolved = contentLocale(locale ?? 'en');
    const copy = content[resolved];
    return siteHead({
      route: '/probe-light',
      locale: resolved,
      title: copy.headTitle,
      description: copy.headDescription,
    });
  },
});
