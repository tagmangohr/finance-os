/**
 * timedFetch — fetch with a hard, non-negotiable timeout.
 *
 * Node's global `fetch` has NO default timeout: a hung or slow upstream request
 * blocks the whole serverless invocation until the platform kills it mid-work —
 * which loses in-flight progress (unsaved cursors, orphaned "running" jobs) and is
 * the root cause of the reconcile / subscription-sync timeout failures.
 *
 * EVERY external HTTP call in the app should go through this instead of raw
 * `fetch()`, so no single request can ever stall a function past its budget.
 * In a paginated loop, ALSO check the chunk deadline between pages — this bounds
 * one request; the loop bounds the whole pass.
 */
export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

export function timedFetch(
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS
): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs);
  // Respect a caller-supplied signal too (abort on whichever fires first).
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
}
