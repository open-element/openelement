/**
 * Caches the reusable GET request that represents the current SPA route.
 *
 * The only production caller (spa.ts) always builds a plain GET for the
 * current URL, so the cache key is the URL alone — the former RequestInit
 * parameter had no production consumer (#743).
 */
export class SpaRequestCache {
  #url = '';
  #request: Request | undefined;

  get(url: string): Request {
    if (this.#request && this.#url === url) return this.#request;

    const request = new Request(url);
    this.#url = url;
    this.#request = request;
    return request;
  }

  clear(): void {
    this.#url = '';
    this.#request = undefined;
  }
}
