export { getReactNativeDeviceContext } from './device-context.js';
export { installGlobalErrorHandler } from './error-handler.js';
export { installPromiseRejectionHandler } from './promise-handler.js';
export { AsyncStorageBackend } from './async-storage-backend.js';

import { getReactNativeDeviceContext } from './device-context.js';
import { installGlobalErrorHandler } from './error-handler.js';
import { installPromiseRejectionHandler } from './promise-handler.js';

// Type-only import to avoid a circular dependency — doctor.ts imports from adapters indirectly
import type { LifestreamDoctor } from '../../doctor.js';

/**
 * Convenience function that wires all React Native error handlers into a
 * LifestreamDoctor instance in one call.
 *
 * - Sets the device context provider to collect React Native / Expo metadata
 * - Installs a global JS error handler (fatal severity)
 * - Installs a global unhandled promise rejection handler (error severity)
 *
 * Returns a single cleanup function that removes all handlers.
 */
export function installReactNativeHandlers(doctor: LifestreamDoctor): () => void {
  doctor.setDeviceContextProvider(getReactNativeDeviceContext);

  const uninstallGlobal = installGlobalErrorHandler((error: Error) => {
    void doctor.captureException(error, { severity: 'fatal' });
  });

  const uninstallPromise = installPromiseRejectionHandler((error: Error) => {
    void doctor.captureException(error);
  });

  return () => {
    uninstallGlobal();
    uninstallPromise();
  };
}
