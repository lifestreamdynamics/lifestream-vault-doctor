/**
 * Installs a global unhandled promise rejection handler.
 *
 * Strategy:
 * 1. Try `global.HermesInternal.enablePromiseRejectionTracker` — the native
 *    Hermes built-in (React Native's JS engine does NOT implement EventTarget).
 * 2. Fall back to the standard `globalThis.addEventListener('unhandledrejection')`
 *    for browser / Node environments.
 *
 * Returns a cleanup function that removes the listener / disables tracking.
 */
export function installPromiseRejectionHandler(
  captureException: (error: Error) => void,
): () => void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;

  // Hermes path — HermesInternal is a non-standard built-in on the Hermes engine
  if (typeof g.HermesInternal?.enablePromiseRejectionTracker === 'function') {
    g.HermesInternal.enablePromiseRejectionTracker({
      allRejections: true,
      onUnhandled: (_id: number, rejection: unknown) => {
        const error =
          rejection instanceof Error ? rejection : new Error(String(rejection));
        captureException(error);
      },
    });

    return () => {
      // Disable tracking by re-invoking without a handler
      try {
        g.HermesInternal.enablePromiseRejectionTracker({ allRejections: false });
      } catch {
        // Best-effort cleanup — ignore errors
      }
    };
  }

  // Standard DOM / Node path
  if (typeof globalThis.addEventListener !== 'function') {
    // Neither Hermes nor EventTarget — no-op
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
