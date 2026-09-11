/**
 * @openelement/router/lit - Lit page authoring entry (Beta.2.2, #1339).
 *
 * The Lit renderer counterpart to definePage(): a route module default-exports
 * defineLitPage(tag, PageClass, descriptor) where PageClass is a plain
 * LitElement subclass. The descriptor is validated and attached by the exact
 * same internal path definePage() uses (openElementPage static); the only
 * addition is the page host tag recorded as the openElementPageTag static,
 * which the generated entry reads through its lit __resolvePageTag fork.
 *
 * This module carries NO lit value imports: it runs in every runtime the
 * route graph loads in, including the SSR shim bootstrap, and must not pull
 * the lit runtime into module scope for descriptor attachment alone.
 */

import { ERROR_PREFIX, isValidTagName } from '@openelement/element/authoring';
import { definePage } from './authoring.ts';
import type {
  OpenElementPageDescriptor,
  PageComponentConstructor,
  PageErrorProjector,
  PageHead,
  PageHeadResolver,
  PagePropsProjector,
} from './authoring.ts';

interface LitPageDescriptorInput<
  Data = unknown,
  Params extends Record<string, string> = Record<string, string>,
> {
  route?: { id?: string; params?: readonly string[] };
  head?: PageHead | PageHeadResolver<Data, Params>;
  renderIntent?: { mode?: 'static' | 'dynamic' };
  props?: PagePropsProjector<Data, Params>;
  error?: PageErrorProjector<Data, Params>;
}

/** A LitElement page class carrying the page descriptor and its host tag. */
export type LitPageConstructor<
  Data = unknown,
  Params extends Record<string, string> = Record<string, string>,
> = PageComponentConstructor<Data, Params> & {
  /** The page's custom-element host tag; the generated lit entry registers and renders under it. */
  openElementPageTag: string;
};

/**
 * Attach a page descriptor and host tag to a LitElement page class.
 *
 *   import { defineLitPage } from '@openelement/router/lit';
 *   import { NotesListPage } from '../components/notes-list-page.ts';
 *   export const loader = async (ctx) => ({ ... });
 *   export default defineLitPage('notes-list-page', NotesListPage, {
 *     renderIntent: { mode: 'dynamic' },
 *     head: { title: 'Notes' },
 *     props: ({ data }) => ({ notes: data?.notes ?? [] }),
 *   });
 *
 * The class is rendered server-side by @lit-labs/ssr (DSD output) and hydrated
 * by @lit-labs/ssr-client; the descriptor's projectors stay the single seam
 * mapping loader/action data onto page properties, exactly like definePage().
 */
export function defineLitPage<
  Data = unknown,
  Params extends Record<string, string> = Record<string, string>,
>(
  tag: string,
  componentClass: CustomElementConstructor,
  descriptor?: LitPageDescriptorInput<Data, Params>,
): LitPageConstructor<Data, Params> {
  if (!isValidTagName(tag)) {
    throw new Error(
      `${ERROR_PREFIX} defineLitPage() requires a valid custom-element tag as its first ` +
        `argument (got ${JSON.stringify(String(tag))}).`,
    );
  }
  const pageClass = definePage(componentClass, descriptor) as LitPageConstructor<Data, Params>;
  Object.defineProperty(pageClass, 'openElementPageTag', {
    value: tag,
    writable: true,
    configurable: true,
  });
  return pageClass;
}

export type { OpenElementPageDescriptor };
