# @lifestreamdynamics/doctor

Crash reporting SDK for Lifestream Vault — captures exceptions and uploads them as searchable, taggable Markdown documents via the Vault API.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/@lifestreamdynamics/doctor.svg)](https://www.npmjs.com/package/@lifestreamdynamics/doctor)

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
  - [LifestreamDoctor](#lifestreamdoctor)
  - [Consent Methods](#consent-methods)
  - [captureException](#captureexception)
  - [captureMessage](#capturemessage)
  - [addBreadcrumb](#addbreadcrumb)
  - [setDeviceContextProvider](#setdevicecontextprovider)
  - [flushQueue](#flushqueue)
  - [createErrorBoundary](#createerrorboundary)
- [DoctorOptions](#doctoroptions)
- [React Native Integration](#react-native-integration)
- [Document Format](#document-format)
- [Consent Management](#consent-management)
- [beforeSend Filter](#beforesend-filter)
- [Offline Queue](#offline-queue)
- [Custom Context](#custom-context)
- [License](#license)

---

## Installation

```bash
npm install @lifestreamdynamics/doctor
```

React Native / Expo projects also need:

```bash
npx expo install @react-native-async-storage/async-storage
# Optional — expo-constants enables automatic device context (falls back gracefully without it):
npx expo install expo-constants
```

---

## Quick Start

```typescript
import { LifestreamDoctor } from '@lifestreamdynamics/doctor';

const doctor = new LifestreamDoctor({
  apiUrl: 'https://vault.example.com',
  vaultId: 'your-vault-id',
  apiKey: 'lsv_k_your_api_key',
  environment: 'production',
});

// Crash reports are only uploaded after the user grants consent.
await doctor.grantConsent();

// Capture an exception manually.
try {
  await riskyOperation();
} catch (err) {
  await doctor.captureException(err as Error, { severity: 'error' });
}
```

Each captured exception becomes a Markdown document inside your vault, searchable by error name, severity, tag, date, or any text in the stack trace.

---

## API Reference

### LifestreamDoctor

```typescript
import { LifestreamDoctor } from '@lifestreamdynamics/doctor';

const doctor = new LifestreamDoctor(options: DoctorOptions);
```

The main SDK class. Manages consent state, breadcrumb history, the offline queue, and report upload. A new session ID is generated on construction and included in every report produced by this instance.

---

### Consent Methods

#### `grantConsent(): Promise<void>`

Marks consent as granted in the configured storage backend and enables report uploads. Call this only after the user has explicitly agreed to error reporting in your UI.

```typescript
await doctor.grantConsent();
```

#### `revokeConsent(): Promise<void>`

Revokes consent and clears the pending offline queue. Subsequent calls to `captureException` and `captureMessage` silently no-op until consent is re-granted.

```typescript
await doctor.revokeConsent();
```

#### `isConsentGranted(): Promise<boolean>`

Returns `true` if consent is currently active.

```typescript
const hasConsent = await doctor.isConsentGranted();
```

---

### captureException

```typescript
await doctor.captureException(error: Error, extras?: {
  severity?: Severity;               // 'fatal' | 'error' | 'warning' | 'info' (default: 'error')
  extra?: Record<string, unknown>;   // Arbitrary structured context
  componentStack?: string;           // React component stack from an error boundary
  tags?: string[];                   // Additional tags merged into the report
}): Promise<void>
```

Builds a crash report from the error and current breadcrumb buffer, runs it through `beforeSend` (if configured), and uploads it to the vault. If the upload fails due to a network error, the report is placed in the offline queue for later retry via `flushQueue()`.

Duplicate errors (same error name and message) are suppressed within the `rateLimitWindowMs` window to prevent report storms.

```typescript
await doctor.captureException(new TypeError('Cannot read properties of undefined'), {
  severity: 'fatal',
  tags: ['checkout', 'payment'],
  extra: { orderId: 'ord_123', userId: 'usr_456' },
});
```

---

### captureMessage

```typescript
await doctor.captureMessage(
  message: string,
  severity?: Severity,               // default: 'info'
  extra?: Record<string, unknown>,
): Promise<void>
```

Captures a plain message (not an exception) as a crash report. Useful for logging non-error conditions — degraded states, feature flag mismatches, or manual checkpoints — at a specific severity level.

```typescript
await doctor.captureMessage(
  'Payment gateway returned unexpected status code 202',
  'warning',
  { gatewayResponse: rawBody },
);
```

---

### addBreadcrumb

```typescript
doctor.addBreadcrumb(crumb: {
  type: string;                      // Category: 'navigation', 'http', 'user', 'console', etc.
  message: string;                   // Human-readable description
  data?: Record<string, unknown>;    // Optional structured data
}): void
```

Adds an event to the breadcrumb buffer. Breadcrumbs record the sequence of events leading up to a crash and are included in every subsequent report. The buffer holds the most recent `maxBreadcrumbs` entries (default 50); older entries are evicted automatically. Timestamps are set automatically.

```typescript
// Record a navigation event
doctor.addBreadcrumb({ type: 'navigation', message: 'Navigated to /checkout' });

// Record an HTTP request
doctor.addBreadcrumb({
  type: 'http',
  message: 'POST /api/v1/orders',
  data: { statusCode: 500, durationMs: 342 },
});

// Record a user action
doctor.addBreadcrumb({ type: 'user', message: 'Tapped "Place Order" button' });
```

---

### setDeviceContextProvider

```typescript
doctor.setDeviceContextProvider(fn: () => DeviceContext | Promise<DeviceContext>): void
```

Registers a function that returns device and runtime context to attach to every report. The provider is called at capture time, not at construction, so it always reflects current state. If no provider is set, device context is empty.

```typescript
doctor.setDeviceContextProvider(() => ({
  platform: 'web',
  appVersion: import.meta.env.VITE_APP_VERSION,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  locale: navigator.language,
  memoryMB: (performance as { memory?: { usedJSHeapSize: number } }).memory
    ? Math.round((performance as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize / 1e6)
    : undefined,
}));
```

---

### flushQueue

```typescript
await doctor.flushQueue(): Promise<FlushResult>
```

Attempts to upload all reports currently in the offline queue. Returns a summary of the flush attempt.

```typescript
interface FlushResult {
  sent: number;         // Successfully uploaded and removed from queue
  failed: number;       // Upload failed — will be retried on next flush
  deadLettered: number; // Exceeded maximum retries — moved to dead-letter and discarded
}
```

Call `flushQueue()` when the device comes back online, or on app resume:

```typescript
// Web — listen for network reconnection
window.addEventListener('online', () => {
  doctor.flushQueue().then(({ sent, failed, deadLettered }) => {
    console.log(`Flushed queue: ${sent} sent, ${failed} failed, ${deadLettered} dead-lettered`);
  });
});
```

---

### createErrorBoundary

```typescript
const ErrorBoundary = doctor.createErrorBoundary();
```

Returns a React error boundary component that automatically calls `captureException` with the `componentStack` when a descendant component throws during rendering. Renders a minimal fallback UI while the exception is captured.

```tsx
import React from 'react';

const ErrorBoundary = doctor.createErrorBoundary();

export function App() {
  return (
    <ErrorBoundary>
      <MyApplication />
    </ErrorBoundary>
  );
}
```

The boundary passes the React `componentStack` as part of `extras`, which appears as a dedicated **Component Stack** section in the generated Markdown document.

---

## DoctorOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiUrl` | `string` | required | Base URL of your Lifestream Vault instance (e.g. `https://vault.example.com`) |
| `vaultId` | `string` | required | ID of the vault where crash reports are written |
| `apiKey` | `string` | required | API key with write scope (`lsv_k_` prefix) |
| `environment` | `string` | `'production'` | Environment tag included in every report (e.g. `'staging'`, `'development'`) |
| `enabled` | `boolean` | `true` | Master switch. When `false`, all capture calls no-op regardless of consent |
| `maxBreadcrumbs` | `number` | `50` | Maximum breadcrumb buffer size. Oldest entries evicted when full |
| `rateLimitWindowMs` | `number` | `60000` | Suppression window (ms) for duplicate errors with the same fingerprint |
| `pathPrefix` | `string` | `'crash-reports'` | Document path prefix. Reports land at `{prefix}/{YYYY-MM-DD}/{errorname}-{id}.md` |
| `tags` | `string[]` | `[]` | Additional tags attached to every report |
| `beforeSend` | `(report: CrashReport) => CrashReport \| null` | `undefined` | Filter or transform a report before upload. Return `null` to discard it |
| `storage` | `StorageBackend` | `MemoryStorage` | Persistence backend for offline queue and consent state |
| `enableRequestSigning` | `boolean` | `true` | Sign uploads with HMAC-SHA256 using the API key as the signing secret. When `crypto.subtle` is unavailable (e.g. React Native Hermes), signing is automatically skipped and the request proceeds unsigned |

---

## React Native Integration

Import the React Native adapter from the `@lifestreamdynamics/doctor/react-native` sub-path. This entry point exports platform-specific helpers that are safe to tree-shake from web bundles.

### Setup

```typescript
// doctor.ts — initialise once, import everywhere
import { LifestreamDoctor } from '@lifestreamdynamics/doctor';
import {
  installReactNativeHandlers,
  AsyncStorageBackend,
  getReactNativeDeviceContext,
} from '@lifestreamdynamics/doctor/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const doctor = new LifestreamDoctor({
  apiUrl: 'https://vault.example.com',
  vaultId: 'your-vault-id',
  apiKey: 'lsv_k_your_api_key',
  environment: __DEV__ ? 'development' : 'production',
  storage: new AsyncStorageBackend(AsyncStorage),
});

// Wire up device context (reads from expo-constants if available)
doctor.setDeviceContextProvider(getReactNativeDeviceContext);
```

### `installReactNativeHandlers`

```typescript
installReactNativeHandlers(doctor: LifestreamDoctor): () => void
```

Installs a global handler via React Native's `ErrorUtils` that automatically captures unhandled native exceptions. Chains to any previously registered handler so existing behaviour is preserved. Returns a cleanup function that restores the previous handler.

```typescript
// App.tsx
import { useEffect } from 'react';
import { doctor } from './doctor';
import { installReactNativeHandlers } from '@lifestreamdynamics/doctor/react-native';

export default function App() {
  useEffect(() => {
    const cleanup = installReactNativeHandlers(doctor);
    return cleanup;
  }, []);

  // ...
}
```

### `AsyncStorageBackend`

A `StorageBackend` implementation backed by `@react-native-async-storage/async-storage`. Persists the offline queue and consent state across app restarts.

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AsyncStorageBackend } from '@lifestreamdynamics/doctor/react-native';

const storage = new AsyncStorageBackend(AsyncStorage);
```

### Flush on App Resume

```typescript
import { AppState } from 'react-native';

AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    doctor.flushQueue();
  }
});
```

---

## Document Format

Each crash report is stored as a Markdown document with YAML frontmatter. The document path follows this pattern:

```
{pathPrefix}/{YYYY-MM-DD}/{errorname-lowercase}-{first8charsOfId}.md
```

For example: `crash-reports/2026-03-13/typeerror-a3f2c1b0.md`

### Example Document

```markdown
---
title: "[ERROR] TypeError: Cannot read properties of undefined (reading 'id')"
tags:
  - crash-report
  - error
  - production
  - checkout
date: 2026-03-13T14:23:01.482Z
severity: error
device: ios
os: 17.4
appVersion: 2.1.0
sessionId: f47ac10b-58cc-4372-a567-0e02b2c3d479
environment: production
---

## Stack Trace

```
TypeError: Cannot read properties of undefined (reading 'id')
    at CheckoutScreen.getOrderId (CheckoutScreen.tsx:142:18)
    at CheckoutScreen.handlePlaceOrder (CheckoutScreen.tsx:87:22)
    at callCallback (react-dom.development.js:3945:14)
```

## Component Stack

```
    in CheckoutScreen
    in Navigator
    in App
```

## Breadcrumbs

| Time | Type | Message |
|------|------|---------|
| 2026-03-13T14:22:58.100Z | navigation | Navigated to /checkout |
| 2026-03-13T14:23:00.340Z | http | POST /api/v1/orders |
| 2026-03-13T14:23:01.100Z | user | Tapped "Place Order" button |

## Device Context

- **platform**: ios
- **osVersion**: 17.4
- **deviceName**: iPhone 15 Pro
- **appVersion**: 2.1.0
- **timezone**: America/Toronto
- **locale**: en-CA

## Additional Context

```json
{
  "orderId": "ord_missing",
  "cartItems": 3
}
```
```

Because every report is a standard Vault document, you can search across crash reports using Vault's full-text search, filter by tag (`crash-report`, `fatal`, `production`), browse by date in the file tree, and link reports to related notes or post-mortems.

---

## Consent Management

Crash reporting is gated on explicit user consent. `captureException` and `captureMessage` are silent no-ops until `grantConsent()` is called. This design satisfies GDPR Article 7 (freely given, specific, informed consent) and PIPEDA Principle 3 (meaningful consent).

Consent state is persisted in the configured `StorageBackend` so it survives page reloads and app restarts. A user who previously granted consent does not need to re-consent on every launch, but a user who revokes consent has their offline queue cleared immediately.

### Typical Consent Flow

```typescript
// Show your consent UI, then:
async function onUserAcceptsReporting() {
  await doctor.grantConsent();
  // Reporting is now active
}

async function onUserDeclinesReporting() {
  await doctor.revokeConsent();
  // Queue cleared, all future captures are suppressed
}

// Check on startup to restore UI state
const hasConsent = await doctor.isConsentGranted();
if (!hasConsent) {
  showConsentBanner();
}
```

If your app has a settings screen with a "Send crash reports" toggle, bind it directly to `grantConsent()` / `revokeConsent()`.

---

## beforeSend Filter

Register a `beforeSend` callback in `DoctorOptions` to inspect, transform, or discard a report before it is uploaded. The callback receives the fully assembled `CrashReport` object and must return either a (possibly modified) `CrashReport` or `null` to drop the report silently.

### Redacting PII

```typescript
const doctor = new LifestreamDoctor({
  // ...
  beforeSend(report) {
    // Remove email addresses from the extra context
    if (report.extra?.userEmail) {
      return {
        ...report,
        extra: {
          ...report.extra,
          userEmail: '[redacted]',
        },
      };
    }
    return report;
  },
});
```

### Discarding Reports

```typescript
const doctor = new LifestreamDoctor({
  // ...
  beforeSend(report) {
    // Don't report known benign errors
    if (report.errorMessage.includes('ResizeObserver loop')) {
      return null; // Discarded — no upload, no queue entry
    }

    // Don't report anything below 'warning' in development
    if (report.environment === 'development' && report.severity === 'info') {
      return null;
    }

    return report;
  },
});
```

### Enriching Reports

```typescript
const doctor = new LifestreamDoctor({
  // ...
  beforeSend(report) {
    return {
      ...report,
      tags: [...report.tags, `session:${report.sessionId.slice(0, 8)}`],
      extra: {
        ...report.extra,
        buildSha: import.meta.env.VITE_GIT_SHA,
        featureFlags: getActiveFlags(),
      },
    };
  },
});
```

`beforeSend` is called synchronously. Avoid async operations or expensive work inside it; if you need async enrichment, use `setDeviceContextProvider` instead, which is awaited at capture time.

> **Note:** If `beforeSend` throws an error, the exception propagates to the caller of `captureException` / `captureMessage`. Guard any fallible logic with try-catch inside your callback.

---

## Offline Queue

When a report upload fails due to a network error or a non-2xx response, the report is placed in an in-memory (or persistent, if `storage` is configured) offline queue rather than being dropped.

### Queue Behaviour

- Maximum queue size: **50 entries**. When the queue is full, the oldest entry is evicted to make room for the new one.
- Maximum retry attempts per entry: **5**. After 5 failed attempts, the entry is moved to a dead-letter state and removed from the active queue.
- The queue is not flushed automatically. Call `flushQueue()` to trigger a flush.

```typescript
const result = await doctor.flushQueue();
// { sent: 3, failed: 1, deadLettered: 0 }
```

### Persistent Queue (React Native)

By default the queue lives in memory and is lost on app restart. Supply `AsyncStorageBackend` to persist it:

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AsyncStorageBackend } from '@lifestreamdynamics/doctor/react-native';

const doctor = new LifestreamDoctor({
  // ...
  storage: new AsyncStorageBackend(AsyncStorage),
});
```

With a persistent backend, reports queued during an offline session are uploaded the next time the app comes online, even across restarts.

### Custom StorageBackend

Implement the `StorageBackend` interface to adapt to any storage mechanism (e.g. `localStorage` on web, SQLite, Secure Storage):

```typescript
import type { StorageBackend } from '@lifestreamdynamics/doctor';

class LocalStorageBackend implements StorageBackend {
  async getItem(key: string): Promise<string | null> {
    return localStorage.getItem(key);
  }

  async setItem(key: string, value: string): Promise<void> {
    localStorage.setItem(key, value);
  }

  async removeItem(key: string): Promise<void> {
    localStorage.removeItem(key);
  }
}

const doctor = new LifestreamDoctor({
  // ...
  storage: new LocalStorageBackend(),
});
```

---

## Custom Context

Add arbitrary structured data to individual reports via the `extra` field on `captureException` and `captureMessage`:

```typescript
await doctor.captureException(err, {
  severity: 'error',
  extra: {
    userId: currentUser.id,
    planTier: subscription.tier,
    requestId: response.headers.get('x-request-id'),
    attemptNumber: retryCount,
  },
});
```

Add data to every report by using `beforeSend`:

```typescript
const doctor = new LifestreamDoctor({
  // ...
  beforeSend(report) {
    return {
      ...report,
      extra: {
        ...report.extra,
        appBuild: BUILD_NUMBER,
        region: navigator.language,
      },
    };
  },
});
```

Add custom tags to every report via `DoctorOptions.tags`:

```typescript
const doctor = new LifestreamDoctor({
  // ...
  tags: ['web', 'dashboard', `version:${APP_VERSION}`],
});
```

Custom tags are merged with the auto-generated tags (`crash-report`, severity level, environment) in the document frontmatter, making them searchable and filterable in Vault.

---

## License

MIT — see [LICENSE](./LICENSE) for details.
