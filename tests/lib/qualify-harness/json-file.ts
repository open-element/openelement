/**
 * JSON helpers for the qualify harnesses (#1472).
 *
 * Replaces the per-consumer readJson copies and the identical
 * `JSON.stringify(value, null, 2) + '\n'` writers with one implementation.
 */

/** Read and parse a JSON file. */
export async function readJson<T = unknown>(path: string | URL): Promise<T> {
  return JSON.parse(await Deno.readTextFile(path)) as T;
}

/** Deterministic JSON text: 2-space indent and a trailing newline. */
export function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n';
}
