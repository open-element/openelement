/** @jsxImportSource @openelement/element */
/**
 * www/app/site-ui - open-standards-visual
 *
 * Product-art diagrams for the openElement standards lab website.
 *
 * Presentation is authored as Tailwind utilities on this markup (alpha15
 * utility-first migration); the sheet keeps only the host box, the package
 * bar pseudo-element (base + state inks) and the package lift animation with
 * its keyframes and opt-outs — each with its reason in
 * open-standards-visual.css.
 *
 * The emphasis variant is expressed on the wrapper as a host-attribute
 * utility (`[open-standards-visual[emphasis=high]_&]:`): `emphasis` is a
 * reflected host attribute, so the variant is a stable selector subject and
 * the wrapper's class list stays one static literal.
 *
 * GENERATED-ELEMENT LANE (2026-11-20 migration, ADR-0183 D-4). The class this
 * module used to be declared four reflected rows plus one `computed`. The rows
 * are the sidecar `properties` table below; `showPackages` is the lane's
 * `computed` intrinsic, so it is a derived node the compiler creates in the
 * retained setup factory instead of a padded numeric property row. `root:
 * 'light'` is the root the class already rendered (`data-oe-light` in the
 * built pages): declaring `shadow` here would be a behaviour change dressed as
 * a migration.
 */

import { computed } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  root: 'light',
  tag: 'open-standards-visual',
  properties: {
    variant: { reflect: true, default: 'packages' },
    motion: { reflect: true, default: 'auto' },
    emphasis: { reflect: true, default: 'normal' },
    /**
     * Accessible name of the package matrix. Authored copy, never a literal:
     * the zh pages carried the English "Package graph" until T10 because the
     * name was hard-written here and callers had no way to localize it. The
     * default keeps the component self-describing when no label is passed.
     */
    label: { default: 'Package graph' },
  },
});

function OpenStandardsVisual(props: {
  variant: string;
  motion: string;
  emphasis: string;
  label: string;
}) {
  // Derived state is the lane's `computed` intrinsic (ADR-0183 D-4): the
  // compiler creates it once per element and a tracked slot reading
  // `showPackages.value` re-runs only when `variant` changes.
  const showPackages = computed(() => (props.variant === 'packages' ? 1 : 0));
  return (
    <div class='grid gap-4 text-foreground [open-standards-visual[emphasis=high]_&]:gap-5'>
      {showPackages.value > 0 ? (
        <div class='grid gap-3' aria-label={props.label}>
          <div class='package package--success relative grid grid-cols-1 items-start gap-1 overflow-hidden rounded-lg border border-border bg-card p-3 min-[761px]:grid-cols-[minmax(0,.36fr)_minmax(0,1fr)] [open-standards-visual[emphasis=high]_&]:bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-primary)_8.96%,transparent),transparent)]'>
            <span class='font-mono text-(length:--text-xs) font-extrabold tracking-normal text-success'>
              Elements
            </span>
            <span class='text-(length:--text-sm) leading-normal text-muted-foreground'>
              custom elements, DSD rendering, and component contracts
            </span>
          </div>
          <div class='package relative grid grid-cols-1 items-start gap-1 overflow-hidden rounded-lg border border-border bg-card p-3 min-[761px]:grid-cols-[minmax(0,.36fr)_minmax(0,1fr)] [open-standards-visual[emphasis=high]_&]:bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-primary)_8.96%,transparent),transparent)]'>
            <span class='font-mono text-(length:--text-xs) font-extrabold tracking-normal text-primary'>
              UI
            </span>
            <span class='text-(length:--text-sm) leading-normal text-muted-foreground'>
              Open Props primitives used by this website and consumers
            </span>
          </div>
          <div class='package package--warning relative grid grid-cols-1 items-start gap-1 overflow-hidden rounded-lg border border-border bg-card p-3 min-[761px]:grid-cols-[minmax(0,.36fr)_minmax(0,1fr)] [open-standards-visual[emphasis=high]_&]:bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-primary)_8.96%,transparent),transparent)]'>
            <span class='font-mono text-(length:--text-xs) font-extrabold tracking-normal text-warning'>
              Framework
            </span>
            <span class='text-(length:--text-sm) leading-normal text-muted-foreground'>
              routes, layouts, content, islands, i18n, and router build
            </span>
          </div>
          <div class='package relative grid grid-cols-1 items-start gap-1 overflow-hidden rounded-lg border border-border bg-card p-3 min-[761px]:grid-cols-[minmax(0,.36fr)_minmax(0,1fr)] [open-standards-visual[emphasis=high]_&]:bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-primary)_8.96%,transparent),transparent)]'>
            <span class='font-mono text-(length:--text-xs) font-extrabold tracking-normal text-primary'>
              Protocols
            </span>
            <span class='text-(length:--text-sm) leading-normal text-muted-foreground'>
              public boundary declarations and package compatibility language
            </span>
          </div>
        </div>
      ) : (
        <span hidden aria-hidden='true'></span>
      )}
    </div>
  );
}

export default OpenStandardsVisual;
