import type { DeviceContext } from '../../types.js';

/**
 * Collects device and runtime context from React Native / Expo APIs.
 * Never throws — wraps all platform calls in try/catch and returns partial context.
 */
export async function getReactNativeDeviceContext(): Promise<DeviceContext> {
  const ctx: DeviceContext = {};

  try {
    // Platform info is synchronous and always available in React Native
    const { Platform } = await import('react-native');
    ctx.platform = Platform.OS;
    ctx.osVersion = String(Platform.Version);
  } catch {
    // react-native not available
  }

  try {
    // expo-constants is optional — dynamic import so it doesn't crash if absent
    const Constants = await import('expo-constants').then((m) => m.default ?? m);
    ctx.deviceName = (Constants as { deviceName?: string }).deviceName ?? undefined;
    ctx.appVersion =
      (Constants as { expoConfig?: { version?: string } }).expoConfig?.version ?? undefined;
  } catch {
    // expo-constants not installed or unavailable
  }

  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions();
    ctx.timezone = resolved.timeZone;
    ctx.locale = resolved.locale;
  } catch {
    // Intl unavailable
  }

  return ctx;
}
