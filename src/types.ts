/**
 * Severity levels for crash reports.
 */
export type Severity = 'fatal' | 'error' | 'warning' | 'info';

/**
 * A breadcrumb records a discrete event leading up to a crash.
 */
export interface Breadcrumb {
  /** ISO-8601 timestamp (auto-set if omitted) */
  timestamp: string;
  /** Category of breadcrumb (e.g. 'navigation', 'http', 'user', 'console') */
  type: string;
  /** Human-readable description */
  message: string;
  /** Optional structured data */
  data?: Record<string, unknown>;
}

/**
 * Device and runtime context collected at crash time.
 */
export interface DeviceContext {
  platform?: string;
  osVersion?: string;
  deviceName?: string;
  appVersion?: string;
  timezone?: string;
  locale?: string;
  [key: string]: unknown;
}

/**
 * A fully constructed crash report ready for formatting.
 */
export interface CrashReport {
  /** Unique report ID */
  id: string;
  /** ISO-8601 timestamp */
  timestamp: string;
  /** Error name (e.g. 'TypeError') */
  errorName: string;
  /** Error message */
  errorMessage: string;
  /** Stack trace string */
  stackTrace?: string;
  /** React component stack (from error boundary) */
  componentStack?: string;
  /** Severity level */
  severity: Severity;
  /** Session ID */
  sessionId: string;
  /** Session duration in ms at time of crash */
  sessionDurationMs: number;
  /** Environment tag (e.g. 'production', 'preview', 'development') */
  environment: string;
  /** Device/runtime context */
  device: DeviceContext;
  /** Recent breadcrumbs leading up to the crash */
  breadcrumbs: Breadcrumb[];
  /** Arbitrary user-provided context */
  extra?: Record<string, unknown>;
  /** Tags for frontmatter (auto-generated + user-provided) */
  tags: string[];
}

/**
 * Configuration options for LifestreamDoctor.
 */
export interface DoctorOptions {
  /** Vault API base URL (e.g. 'https://vault.example.com') */
  apiUrl: string;
  /** Vault ID to upload crash reports to */
  vaultId: string;
  /** API key with write scope (lsv_k_ prefix) */
  apiKey: string;
  /** Environment tag (default: 'production') */
  environment?: string;
  /** Enable/disable reporting (default: true, but consent must also be granted) */
  enabled?: boolean;
  /** Maximum breadcrumb buffer size (default: 50) */
  maxBreadcrumbs?: number;
  /** Rate limit window in ms for same error fingerprint (default: 60000) */
  rateLimitWindowMs?: number;
  /** Path prefix for crash report documents (default: 'crash-reports') */
  pathPrefix?: string;
  /** Custom tags added to every report */
  tags?: string[];
  /** Filter/transform reports before send. Return null to discard. */
  beforeSend?: (report: CrashReport) => CrashReport | null;
  /** Custom storage backend for offline queue and consent (default: MemoryStorage) */
  storage?: StorageBackend;
  /** Enable HMAC request signing (default: true) */
  enableRequestSigning?: boolean;
}

/**
 * Storage backend interface for platform-agnostic persistence.
 */
export interface StorageBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * A report queued for later upload (offline).
 */
export interface QueuedReport {
  /** Queue entry ID */
  id: string;
  /** Formatted Markdown content */
  content: string;
  /** Target document path */
  path: string;
  /** Number of upload attempts so far */
  attempts: number;
  /** ISO-8601 timestamp when first queued */
  queuedAt: string;
  /** ISO-8601 timestamp of last attempt */
  lastAttemptAt?: string;
}

/**
 * Result of flushing the offline queue.
 */
export interface FlushResult {
  /** Number of reports successfully uploaded */
  sent: number;
  /** Number of reports that failed and remain in queue */
  failed: number;
  /** Number of reports moved to dead letter (exceeded max retries) */
  deadLettered: number;
}

/**
 * Provider function for collecting device context.
 */
export type DeviceContextProvider = () => Promise<DeviceContext> | DeviceContext;
