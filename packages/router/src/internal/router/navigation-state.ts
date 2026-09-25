/**
 * @openelement/router/internal/router/navigation-state - the client router's
 * explicit navigation state machine (#1385).
 *
 * client-router.ts unifies History, the Navigation API and hash navigation
 * through three pieces of shared mutable state that only make sense together:
 * a monotonic ticket sequence (latest-wins, #1023), the dedup key of the last
 * browser-landed URL, and the one-shot marker of the router's own guard-veto
 * restore (#1036). Each was commented where it was used, but their
 * interaction — ownership-point cancellation (#1343 review) versus
 * Navigation-API interception and abort-bumped tickets — was spread across
 * four functions at once.
 *
 * This module is the single owner of those invariants. The router asks it
 * three questions and nothing else:
 *
 *   issue/owns      — may this navigation still commit? (latest-wins)
 *   isDuplicateLanding/recordLanding — browser-event dedup
 *   armRestore/consumeRestore — is this navigate event our own restore?
 *
 * Ownership (the #1343 contract): cancelling pending execution is a side
 * effect of *owning* intent, never of attempting a navigation. A guard veto
 * (the ticket is superseded only after it passes), a stale ticket, an
 * abort-bumped traversal or a disposed router all fail `owns()`, so the
 * current route's pending render is left alone. `onPending` belongs exactly
 * at the ownership point: after `owns()` answered true.
 *
 * The machine is deliberately DOM-free: URL resolution stays in the router,
 * which is also why `armRestore` takes an already-resolved href. That keeps
 * every transition testable without a browser (navigation-state.test.ts) and
 * lets client-router.ts read as a sequence of navigation flows instead of a
 * set of interacting counters.
 */

/**
 * Which entry point issued a ticket. The kind never changes a decision — it
 * exists so tickets are self-describing in diagnostics and invariant tests.
 */
export type NavigationKind = 'programmatic' | 'browser' | 'native';

/** One issued navigation: its monotonic `id` and the entry point that issued it. */
export interface NavigationTicket {
  readonly id: number;
  readonly kind: NavigationKind;
}

/** Browser-evidence shape of the navigate event the router's own restore fires. */
export interface RestoreCandidate {
  /** `new URL(event.destination.url).href` — already resolved by the caller. */
  readonly destinationHref: string;
  /** `event.navigationType` — `'replace'` only for a replaceState-driven event. */
  readonly navigationType: string | undefined;
  /** `event.info` — absent only for browser-originated navigate events. */
  readonly info: unknown;
}

export type StreamNavigationStatus = 'idle' | 'pending' | 'retired';

export class NavigationState {
  /** Ticket sequence: also the id of the newest ticket. Never decreases. */
  #sequence = 0;
  /** Last URL a browser-driven navigation landed on, for burst dedup. */
  #landedUrl: string | null = null;
  /** One-shot href of the router's own guard-veto restore (Navigation API). */
  #restoreHref: string | null = null;
  #streamToken: string | null = null;
  #streamStatus: StreamNavigationStatus = 'idle';
  #disposed = false;

  get disposed(): boolean {
    return this.#disposed;
  }

  /** Id of the newest ticket; an outstanding ticket holds ownership iff it matches. */
  get latestTicketId(): number {
    return this.#sequence;
  }

  /** The dedup key for browser-driven landings (null right after a commit). */
  get landedUrl(): string | null {
    return this.#landedUrl;
  }

  /** The armed restore href, or null when no restore is pending. Read-only. */
  get restoreHref(): string | null {
    return this.#restoreHref;
  }

  get streamStatus(): StreamNavigationStatus {
    return this.#streamStatus;
  }

  /** A fresh full-document seed supersedes any retired token in this document. */
  observeStream(token: string): void {
    if (this.#disposed || !token || token === this.#streamToken) return;
    this.#streamToken = token;
    this.#streamStatus = 'pending';
  }

  /** A terminal stream no longer needs an ownership-point cancellation. */
  settleStream(token: string): void {
    if (this.#streamToken === token && this.#streamStatus === 'pending') {
      this.#streamStatus = 'idle';
    }
  }

  /** Only a committing navigation may retire the old document's pending frames. */
  retireStream(ticket: NavigationTicket, token: string): boolean {
    if (!this.owns(ticket) || this.#streamToken !== token || this.#streamStatus !== 'pending') {
      return false;
    }
    this.#streamStatus = 'retired';
    return true;
  }

  /** Issue the newest ticket: its holder owns intent unless superseded. */
  issue(kind: NavigationKind): NavigationTicket {
    return { id: ++this.#sequence, kind };
  }

  /**
   * Does this ticket still own intent? False once a newer ticket was issued,
   * once a traversal/disposal superseded it, or once the router is disposed.
   */
  owns(ticket: NavigationTicket): boolean {
    return !this.#disposed && ticket.id === this.#sequence;
  }

  /**
   * Supersede every outstanding ticket without issuing one: an aborted
   * navigation request or a disposal must not become a later commit.
   */
  supersede(): void {
    this.#sequence++;
  }

  /** True when a browser event repeats the last recorded landing (burst dedup). */
  isDuplicateLanding(landed: string): boolean {
    return landed === this.#landedUrl;
  }

  /**
   * Record the URL a browser-driven navigation committed (or `null` when the
   * router took over the address bar, which invalidates the dedup key).
   */
  recordLanding(url: string | null): void {
    this.#landedUrl = url;
  }

  /** Arm the one-shot marker for the router's own guard-veto restore. */
  armRestore(href: string): void {
    this.#restoreHref = href;
  }

  /**
   * Consume the one-shot restore marker. Always clears it — a genuine
   * navigation must never inherit the router's own restore — and returns true
   * only for the router's own event: no `info` payload, replace-shaped, and
   * landing on the armed href.
   */
  consumeRestore(candidate: RestoreCandidate): boolean {
    const armed = this.#restoreHref;
    if (armed === null) return false;
    this.#restoreHref = null;
    return candidate.info === undefined && candidate.navigationType === 'replace' &&
      candidate.destinationHref === armed;
  }

  /** Disposal: no ticket owns intent afterwards and no restore stays armed. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.supersede();
    this.#restoreHref = null;
    this.#landedUrl = null;
    this.#streamToken = null;
    this.#streamStatus = 'idle';
  }
}
