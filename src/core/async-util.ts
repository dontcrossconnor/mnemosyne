/**
 * Fire-and-forget async operation wrapper.
 * Logs errors to console.warn instead of swallowing them.
 * Use for non-critical background tasks where failure shouldn't crash the caller.
 */
export function fireAndForget<T>(promise: Promise<T>, label: string): void {
  promise.catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[fireAndForget] ${label}: ${msg}`);
  });
}
