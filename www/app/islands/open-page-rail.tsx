/** Client activation entry for the private WWW page rail. */
import { defineIslandConfig } from '@openelement/app';
export { default } from '../site-ui/open-page-rail.tsx';

export const tagName = 'open-page-rail';
export const openElement = defineIslandConfig({ hydrate: 'idle', ssr: true, dsd: true });
