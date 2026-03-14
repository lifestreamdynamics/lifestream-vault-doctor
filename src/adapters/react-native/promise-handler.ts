/**
 * Installs a global unhandled promise rejection handler via the standard
 * `unhandledrejection` DOM/globalThis event.
 *
 * Returns a cleanup function that removes the listener.
 */
export function installPromiseRejectionHandler(
  captureException: (error: Error) => void,
): () => void {
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
