// Shared descriptors for the hand-written shell fixtures. The actual module
// recipe and SSR producers in the bundle are compiler output.
export const PROFILE_PROPERTIES = JSON.stringify([
  { name: 'label', attribute: 'label', type: 'string', reflect: true },
  { name: 'count', attribute: 'count', type: 'number', reflect: true },
  { name: 'enabled', attribute: 'enabled', type: 'boolean', reflect: true },
]);

export const DEFINE_PROFILE = `
  const mod = window.__oeM09;
  const ctor = mod.defineGeneratedElement({
    tag: 'oe-m09-profile',
    properties: ${PROFILE_PROPERTIES},
    createRecipe: mod.createProfileRecipe,
  });
`;

export interface ProbeSnapshot {
  owners: number;
  projections: number;
  disposed: number;
  subscriptions: number;
  unsubscribed: number;
}
