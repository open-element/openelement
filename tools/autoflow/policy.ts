export type AutoFlowTier = 'dev' | 'push' | 'ci' | 'release';

export interface GateDefinition {
  name: string;
  command: string[];
  tiers: AutoFlowTier[];
  triggers?: RegExp[];
}

export const AUTOFLOW_POLICY_VERSION = 'core-v1';

const GATES: readonly GateDefinition[] = [
  {
    name: 'graph:check',
    command: ['deno', 'task', 'graph:check'],
    tiers: ['push', 'ci', 'release'],
  },
  {
    name: 'package-surface:check',
    command: ['deno', 'task', 'package-surface:check'],
    tiers: ['push', 'ci', 'release'],
    triggers: [
      /^packages\//,
      /^deno\.json$/,
      /^tools\/check-package-surface\.ts$/,
      /^docs\/architecture\//,
    ],
  },
  {
    name: 'interface:snapshot',
    command: ['deno', 'task', 'interface:snapshot'],
    tiers: ['ci', 'release'],
    triggers: [/^packages\//, /^docs\/release\/public-interface-snapshot\.json$/, /^deno\.json$/],
  },
  {
    name: 'export-files:check',
    command: ['deno', 'task', 'export-files:check'],
    tiers: ['push', 'ci', 'release'],
    triggers: [/^packages\//, /^deno\.json$/],
  },
  {
    name: 'verify:configs',
    command: ['deno', 'task', 'verify:configs'],
    tiers: ['ci', 'release'],
    triggers: [/^packages\//, /^deno\.json$/, /^tools\/project-constants\.ts$/],
  },
  {
    name: 'url-pattern-list:provenance',
    command: ['deno', 'task', 'url-pattern-list:provenance'],
    tiers: ['ci', 'release'],
    triggers: [/^packages\/app\//, /^deno\.(json|lock)$/],
  },
  {
    name: 'release:state-machine:check',
    command: ['deno', 'task', 'release:state-machine:check'],
    tiers: ['ci', 'release'],
    triggers: [/^docs\/release\//, /^packages\/[^/]+\/deno\.json$/, /^deno\.json$/],
  },
  {
    name: 'signals:check-protocol-boundary',
    command: ['deno', 'task', 'signals:check-protocol-boundary'],
    tiers: ['ci', 'release'],
    triggers: [/^packages\/element\//],
  },
  {
    name: 'deno-api:check',
    command: ['deno', 'task', 'deno-api:check'],
    tiers: ['ci', 'release'],
    triggers: [/^packages\/(element|app)\/src\//],
  },
  {
    name: 'validation:boundary-check',
    command: ['deno', 'task', 'validation:boundary-check'],
    tiers: ['ci', 'release'],
    triggers: [/^packages\/[^/]+\/src\//],
  },
  {
    name: 'build',
    command: ['deno', 'task', 'build'],
    tiers: ['ci', 'release'],
    triggers: [/^packages\//, /^deno\.json$/],
  },
  {
    name: 'test:coverage:check',
    command: ['deno', 'task', 'test:coverage:check'],
    tiers: ['ci', 'release'],
    triggers: [/^(packages|tools)\//, /^deno\.json$/],
  },
  {
    name: 'fixture:request-time:gate',
    command: ['deno', 'task', 'fixture:request-time:gate'],
    tiers: ['ci', 'release'],
    triggers: [/^packages\/(app|adapter-vite)\//, /^deno\.json$/],
  },
  {
    name: 'fixture:app-flow-native:gate',
    command: ['deno', 'task', 'fixture:app-flow-native:gate'],
    tiers: ['ci', 'release'],
    triggers: [/^packages\//, /^deno\.json$/],
  },
  {
    name: 'fixture:app-flow-lit:gate',
    command: ['deno', 'task', 'fixture:app-flow-lit:gate'],
    tiers: ['ci', 'release'],
    triggers: [/^packages\//, /^deno\.json$/],
  },
  {
    name: 'wtr:pilot:gate',
    command: ['deno', 'task', 'wtr:pilot:gate'],
    tiers: ['ci', 'release'],
    triggers: [/^packages\/(element|adapter-vite)\//, /^deno\.json$/],
  },
  {
    name: 'test:starter-smoke',
    command: ['deno', 'task', 'test:starter-smoke'],
    tiers: ['ci', 'release'],
    triggers: [/^packages\//, /^e2e\//, /^deno\.json$/],
  },
  {
    name: 'consumer:local',
    command: ['deno', 'task', 'consumer:local'],
    tiers: ['ci', 'release'],
    triggers: [/^packages\//, /^deno\.json$/],
  },
  {
    name: 'package-artifacts:check',
    command: ['deno', 'task', 'package-artifacts:check'],
    tiers: ['ci', 'release'],
    triggers: [/^packages\//, /^tools\/(publish-npm|check-package-artifacts)\.ts$/, /^deno\.json$/],
  },
  {
    name: 'consumer:packaged',
    command: ['deno', 'task', 'consumer:packaged'],
    tiers: ['ci', 'release'],
    triggers: [/^packages\//, /^tools\/consumer-/, /^deno\.json$/],
  },
  {
    name: 'consumer:packaged-app',
    command: ['deno', 'task', 'consumer:packaged-app'],
    tiers: ['ci', 'release'],
    triggers: [/^packages\//, /^tools\/consumer-packaged-app\.ts$/, /^deno\.json$/],
  },
  {
    name: 'consumer:packaged-router',
    command: ['deno', 'task', 'consumer:packaged-router'],
    tiers: ['ci', 'release'],
    triggers: [
      /^packages\/app\//,
      /^tools\/consumer-packaged-router\.ts$/,
      /^tools\/publish-npm\.ts$/,
      /^deno\.json$/,
    ],
  },
  {
    name: 'consumer:packaged-element',
    command: ['deno', 'task', 'consumer:packaged-element'],
    tiers: ['ci', 'release'],
    triggers: [/^packages\/element\//, /^tools\/consumer-packaged-element\.ts$/, /^deno\.json$/],
  },
  {
    name: 'third-party-wc:smoke',
    command: ['deno', 'task', 'third-party-wc:smoke'],
    tiers: ['ci', 'release'],
    triggers: [/^packages\//, /^tools\/third-party-wc-/, /^docs\/integrations\//],
  },
  {
    name: 'nitro:proof:node',
    command: ['deno', 'task', 'nitro:proof:node'],
    tiers: ['release'],
    triggers: [/^packages\/(app|adapter-vite)\//, /^deno\.json$/],
  },
  {
    name: 'nitro:proof:workers',
    command: ['deno', 'task', 'nitro:proof:workers'],
    tiers: ['release'],
    triggers: [/^packages\/(app|adapter-vite)\//, /^deno\.json$/],
  },
  {
    name: 'publish:npm:dry-run',
    command: ['deno', 'task', 'publish:npm:dry-run'],
    tiers: ['release'],
    triggers: [/^packages\//, /^tools\/publish-npm\.ts$/, /^deno\.json$/],
  },
];

export function allRegisteredGates(): readonly GateDefinition[] {
  return GATES;
}

export function selectGates(tier: AutoFlowTier, changedPaths: string[]): GateDefinition[] {
  return GATES.filter((gate) => {
    if (!gate.tiers.includes(tier)) return false;
    if (tier === 'ci' || tier === 'release' || !gate.triggers?.length) return true;
    return changedPaths.some((path) => gate.triggers!.some((pattern) => pattern.test(path)));
  });
}
