// Nested Light component of the /styled/:id route: server-rendered, NEVER
// hydrated (`hydrate: 'none'`), so its stylesheet is delivered without shipping
// client JavaScript for it — while still using the framework's island
// admission, which is what makes a nested custom element renderable at all.
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  hydrate: 'none',
  ssr: true,
  // The class declared this LIGHT, and the /styled/:id sheet assertions read the
  // native `@scope (styled-badge)` projection of the badge sheet — omitting the
  // root would deliver the sheet to a shadow tree the page never creates.
  root: 'light',
  styles: ['./styled-badge.css'],
});

export default function StyledBadge() {
  return (
    <div class='styled-badge'>
      <span class='styled-shared'>badge</span>
    </div>
  );
}
