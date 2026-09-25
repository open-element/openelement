import type { PartProgram } from '../protocol/part-program.ts';

export const STREAM_STATE_KEY = Symbol.for('openelement.stream-state.v1');

export interface StreamPropertySeed {
  state: 'resolved' | 'pending' | 'missing';
  type: string;
  value?: unknown;
}

export interface StreamHostState {
  request: string;
  program: string;
  instance: string;
  properties: Record<string, StreamPropertySeed>;
  parts: number[];
  pending: Set<number>;
  listen(callback: (part: number, field: string, outcome: 'content' | 'error') => void): () => void;
}

export function streamHostState(
  host: HTMLElement,
  program: PartProgram,
): StreamHostState | undefined {
  const state = (host as unknown as Record<symbol, unknown>)[STREAM_STATE_KEY] as
    | StreamHostState
    | undefined;
  if (!state) return undefined;
  if (
    host.getAttribute('data-oe-stream-request') !== state.request ||
    host.getAttribute('data-oe-stream-program') !== state.program ||
    host.getAttribute('data-oe-stream-instance') !== state.instance ||
    host.tagName.toLowerCase() !== program.tag ||
    !state.program.startsWith(`${program.version}:`) ||
    !Array.isArray(state.parts) || !(state.pending instanceof Set) ||
    typeof state.listen !== 'function'
  ) return undefined;
  return state;
}
