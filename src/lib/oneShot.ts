import "server-only";

/**
 * One-shot display channel for values that must be readable exactly once and are
 * never persisted anywhere durable (work items 1.6 and 1.7):
 *
 *  - the TOTP enrollment URI + secret + freshly generated backup codes,
 *  - an administrator-generated temporary password.
 *
 * Why not the obvious places?
 *  - the database: these values are shown once on purpose; a second copy in a table
 *    is a second thing to back up, encrypt and leak. Better Auth already stores the
 *    TOTP secret and the hashed backup codes in `two_factor`.
 *  - a cookie or a query string: both are sent to every subresource, land in browser
 *    history, and end up in proxy access logs. `?notice=…` carries *codes*, never values.
 *  - component state: these screens are JS-free HTML forms + Server Actions, so
 *    there is no client state to hold them in.
 *
 * The honest trade-off: the value lives in this process's memory for up to `TTL_MS`.
 * A restart before the user looked at it means it was never shown, and the flow is
 * re-run — which is the safe direction to fail. Today the app is one Node process
 * (`output: "standalone"`, one `node server.js`); if it ever runs with more than one
 * app process, this must become a shared short-TTL store, and that is recorded in
 * PROGRESS.md as a deployment precondition.
 */

const TTL_MS = 10 * 60 * 1000;

interface Entry {
  lines: string[];
  expiresAt: number;
}

const entries = new Map<string, Entry>();

export function stashOnce(key: string, lines: string[]): void {
  prune();
  entries.set(key, { lines, expiresAt: Date.now() + TTL_MS });
}

/** Reads the value and destroys it: a second render of the same page shows nothing. */
export function takeOnce(key: string): string[] | null {
  const hit = entries.get(key);
  if (!hit) return null;
  entries.delete(key);
  if (hit.expiresAt <= Date.now()) return null;
  return hit.lines;
}

/** Non-consuming check, used to decide whether a "shown once" block is still available. */
export function peekOnce(key: string): boolean {
  const hit = entries.get(key);
  if (!hit) return false;
  if (hit.expiresAt <= Date.now()) {
    entries.delete(key);
    return false;
  }
  return true;
}

export function dropOnce(key: string): void {
  entries.delete(key);
}

/** How many entries are held — asserted by tests so nothing accumulates. */
export function oneShotCount(): number {
  return entries.size;
}

function prune(): void {
  const now = Date.now();
  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now) entries.delete(key);
  }
}
