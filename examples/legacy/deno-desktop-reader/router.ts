/**
 * Shared router reference for SPA navigation.
 * Thin local instance of examples/lib/client-router.ts with this example's
 * log tag. Set by reader.tsx after mount, used by route components.
 */
import { createRouterRef } from '../lib/client-router.ts';

export const { setRouter, navigate } = createRouterRef('reader');
