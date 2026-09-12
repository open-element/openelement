/**
 * Shared attribute/prop readers for www site-ui components.
 *
 * SSR injectProps() sets camelCase JS properties while plain markup only sets
 * attributes; read the property first (camelCase, then raw name), then the
 * attribute, then the default.
 */
function readProp(host: Element, attr: string): unknown {
  const camel = attr.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  return Reflect.get(host, camel) ?? Reflect.get(host, attr);
}

export function getStr(host: Element, attr: string, def: string): string {
  const prop = readProp(host, attr);
  if (prop !== undefined && prop !== null) return String(prop);
  return host.getAttribute(attr) || def;
}

/** Boolean variant: a boolean property wins, otherwise attribute presence. */
export function getBool(host: Element, attr: string): boolean {
  const prop = readProp(host, attr);
  if (typeof prop === 'boolean') return prop;
  return host.hasAttribute(attr);
}

/** JSON variant: parse the getStr value; null on absence or parse failure. */
export function getJson<T>(host: Element, attr: string): T | null {
  const raw = getStr(host, attr, '');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
