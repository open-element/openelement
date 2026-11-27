/** Whether an authored module id has a JSX-bearing source extension. */
export function isJsxModuleId(id: string): boolean {
  return /\.[jt]sx$/.test(id.split('?', 1)[0]!);
}
