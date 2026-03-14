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
    captureException(error);
    previousHandler?.(error, isFatal);
  });

  return () => {
    ErrorUtils.setGlobalHandler(previousHandler);
  };
}
