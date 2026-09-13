/** Convert the framework's Hono-style route dialect to WHATWG URLPattern syntax. */
export function normalizeRoutePatternForURLPattern(path: string): string {
  return path
    .split('/')
    .map((segment) => {
      const brace = segment.startsWith(':') ? segment.indexOf('{') : -1;
      if (brace === -1 || !segment.endsWith('}')) return segment;
      return `${segment.slice(0, brace)}(${segment.slice(brace + 1, -1)})`;
    })
    .join('/');
}
