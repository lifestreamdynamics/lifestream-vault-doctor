/**
 * React Native's global ErrorUtils object (not in @types/react-native, typed inline).
 */
interface ReactNativeErrorUtils {
  setGlobalHandler(handler: (error: Error, isFatal?: boolean) => void): void;
  getGlobalHandler(): (error: Error, isFatal?: boolean) => void;
}

declare const ErrorUtils: ReactNativeErrorUtils | undefined;

/**
 * Installs a global error handler via React Native's ErrorUtils.
 *
 * Chains to the previous handler so existing behaviour is preserved.
 * Returns a cleanup function that restores the previous handler.
 *
 * Durability note: report persistence is guaranteed by the persist-before-upload
 * strategy in captureException — the report is written to the offline queue
 * (AsyncStorage) before the upload is attempted. AsyncStorage writes typically
 * complete synchronously within the microtask queue before RN's teardown runs,
 * so the report survives even a fatal crash that kills the JS engine before the
 * HTTP upload finishes. Any reports that do not make it out on the first attempt
 * are flushed to Vault by calling flushQueue() on the next app launch.
 *
 * Because the RN global error handler is synchronous (the runtime does not await
 * it), we must never let an exception escape from it — doing so would mask the
 * original crash. All errors from captureException are swallowed here.
 */
export function installGlobalErrorHandler(
  captureException: (error: Error) => void,
): () => void {
  // ErrorUtils is a global injected by React Native's runtime
  if (typeof ErrorUtils === 'undefined') {
    // Not running in React Native — no-op
    return () => undefined;
  }

  const previousHandler = ErrorUtils.getGlobalHandler();

  ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
    // Swallow any error from captureException — a crash handler must never throw.
    try {
      captureException(error);
    } catch {
      // Intentionally swallowed — never let the crash handler itself crash.
    }
    previousHandler?.(error, isFatal);
  });

  return () => {
    ErrorUtils.setGlobalHandler(previousHandler);
  };
}
