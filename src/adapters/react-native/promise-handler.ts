/**
 * Installs a global unhandled promise rejection handler via the standard
 * `unhandledrejection` DOM/globalThis event.
 *
 * Returns a cleanup function that removes the listener.
 *
 * Note: Hermes (React Native's JS engine) does NOT implement EventTarget on
 * globalThis, so addEventListener may not be available. In that case this
 * function is a no-op and returns a no-op cleanup function.
 */
export function installPromiseRejectionHandler(
  captureException: (error: Error) => void,
): () => void {
  if (typeof globalThis.addEventListener !== 'function') {
    // Not available (e.g., Hermes/React Native) — no-op
    return () => {};
  }

  const handler = (event: PromiseRejectionEvent): void => {
    const reason: unknown = event.reason;
    const error = reason instanceof Error ? reason : new Error(String(reason));
    captureException(error);
  };

  globalThis.addEventListener('unhandledrejection', handler as EventListener);

  return () => {
    globalThis.removeEventListener('unhandledrejection', handler as EventListener);
  };
}
