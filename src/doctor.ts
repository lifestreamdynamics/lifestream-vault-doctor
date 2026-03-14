import type {
  DoctorOptions,
  CrashReport,
  DeviceContext,
  DeviceContextProvider,
  Severity,
  FlushResult,
  Breadcrumb,
  StorageBackend,
} from './types.js';
import { Session } from './session.js';
import { BreadcrumbBuffer } from './breadcrumbs.js';
import { RateLimiter } from './rate-limiter.js';
import { CrashQueue } from './queue/index.js';
import { MemoryStorage } from './queue/memory-storage.js';
import { formatReport, generateDocPath } from './formatter.js';
import { uploadReport } from './uploader.js';
import { uuid } from './lib/uuid.js';

const CONSENT_KEY = 'doctor:consent';

/**
 * Main entry point for the Lifestream Doctor crash reporting SDK.
 */
export class LifestreamDoctor {
  private readonly options: Required<
    Pick<DoctorOptions, 'apiUrl' | 'vaultId' | 'apiKey' | 'environment' | 'enabled' | 'pathPrefix' | 'enableRequestSigning'>
  > & DoctorOptions;

  private readonly session: Session;
  private readonly breadcrumbs: BreadcrumbBuffer;
  private readonly rateLimiter: RateLimiter;
  private readonly queue: CrashQueue;
  private readonly storage: StorageBackend;
  private deviceContextProvider?: DeviceContextProvider;
  private _consentPreVerified = false;

  constructor(options: DoctorOptions) {
    // Resolve enabled first — allow disabled instances with missing credentials
    const enabled = options.enabled ?? true;

    if (enabled) {
      if (!options.apiUrl) throw new Error('LifestreamDoctor: apiUrl is required');
      if (!options.vaultId) throw new Error('LifestreamDoctor: vaultId is required');
      if (!options.apiKey) throw new Error('LifestreamDoctor: apiKey is required');
    }

    this.options = Object.assign(
      {
        environment: 'production' as const,
        enabled,
        maxBreadcrumbs: 50,
        rateLimitWindowMs: 60_000,
        pathPrefix: 'crash-reports',
        tags: [] as string[],
        enableRequestSigning: true,
      },
      options,
      // Re-apply computed enabled after spread so `undefined` from options doesn't override
      { enabled },
    );

    this.storage = options.storage ?? new MemoryStorage();

    this.session = new Session();
    this.breadcrumbs = new BreadcrumbBuffer(this.options.maxBreadcrumbs);
    this.rateLimiter = new RateLimiter(this.options.rateLimitWindowMs);
    this.queue = new CrashQueue(this.storage);
  }

  /**
   * Grants consent for crash reporting. Must be called before reports are sent.
   */
  async grantConsent(): Promise<void> {
    await this.storage.setItem(CONSENT_KEY, 'true');
  }

  /**
   * Revokes consent and clears the offline queue.
   */
  async revokeConsent(): Promise<void> {
    this._consentPreVerified = false;
    await this.storage.removeItem(CONSENT_KEY);
    await this.queue.clear();
  }

  /**
   * Pre-verifies consent in memory so captureException can skip the async
   * storage check. Call this after confirming consent via grantConsent() to
   * eliminate the race window where early crashes are dropped.
   */
  setConsentPreVerified(): void {
    this._consentPreVerified = true;
  }

  /**
   * Returns true if consent has been granted.
   */
  async isConsentGranted(): Promise<boolean> {
    const value = await this.storage.getItem(CONSENT_KEY);
    return value === 'true';
  }

  /**
   * Adds a breadcrumb to the buffer if reporting is enabled.
   */
  addBreadcrumb(crumb: Omit<Breadcrumb, 'timestamp'> & { timestamp?: string }): void {
    if (!this.options.enabled) return;
    this.breadcrumbs.add(crumb);
  }

  /**
   * Sets the device context provider called at crash capture time.
   */
  setDeviceContextProvider(fn: DeviceContextProvider): void {
    this.deviceContextProvider = fn;
  }

  /**
   * Captures an exception and uploads it (or enqueues if offline).
   */
  async captureException(
    error: Error,
    extras?: {
      severity?: Severity;
      extra?: Record<string, unknown>;
      componentStack?: string;
      tags?: string[];
    },
  ): Promise<void> {
    // 1. Check enabled and consent
    if (!this.options.enabled) return;
    if (!this._consentPreVerified && !(await this.isConsentGranted())) return;

    // 2. Rate limit check
    const fingerprint = RateLimiter.fingerprint(error.name, error.message);
    if (!this.rateLimiter.shouldAllow(fingerprint)) return;

    // 3. Collect device context
    let device: DeviceContext = {};
    if (this.deviceContextProvider) {
      try {
        device = await this.deviceContextProvider();
      } catch {
        // Ignore provider errors — continue with empty context
      }
    }

    // 4. Build CrashReport
    const globalTags = this.options.tags ?? [];
    const localTags = extras?.tags ?? [];
    const autoTags = [
      `severity:${extras?.severity ?? 'error'}`,
      `env:${this.options.environment}`,
      error.name.toLowerCase(),
    ];
    const tags = [...new Set([...autoTags, ...globalTags, ...localTags])];

    let report: CrashReport = {
      id: uuid(),
      timestamp: new Date().toISOString(),
      errorName: error.name,
      errorMessage: error.message,
      stackTrace: error.stack,
      componentStack: extras?.componentStack,
      severity: extras?.severity ?? 'error',
      sessionId: this.session.id,
      sessionDurationMs: this.session.getDurationMs(),
      environment: this.options.environment,
      device,
      breadcrumbs: this.breadcrumbs.getAll(),
      extra: extras?.extra,
      tags,
    };

    // 5. Run beforeSend filter
    if (this.options.beforeSend) {
      const filtered = this.options.beforeSend(report);
      if (filtered === null) return;
      report = filtered;
    }

    // 6. Format to markdown
    const content = formatReport(report);

    // 7. Generate path
    const path = generateDocPath(report, this.options.pathPrefix);

    // 8. Try uploadReport, on failure enqueue
    try {
      await uploadReport({
        apiUrl: this.options.apiUrl,
        vaultId: this.options.vaultId,
        apiKey: this.options.apiKey,
        content,
        path,
        enableRequestSigning: this.options.enableRequestSigning,
      });
    } catch {
      await this.queue.enqueue(content, path);
    }
  }

  /**
   * Captures a plain message as a crash report.
   */
  async captureMessage(
    message: string,
    severity: Severity = 'info',
    extra?: Record<string, unknown>,
  ): Promise<void> {
    const error = new Error(message);
    error.name = 'CapturedMessage';
    await this.captureException(error, { severity, extra });
  }

  /**
   * Flushes queued reports that failed to upload previously.
   * Requires consent to be granted.
   */
  async flushQueue(): Promise<FlushResult> {
    if (!(await this.isConsentGranted())) {
      return { sent: 0, failed: 0, deadLettered: 0 };
    }

    return this.queue.flush(async (report) => {
      await uploadReport({
        apiUrl: this.options.apiUrl,
        vaultId: this.options.vaultId,
        apiKey: this.options.apiKey,
        content: report.content,
        path: report.path,
        enableRequestSigning: this.options.enableRequestSigning,
      });
    });
  }

  /**
   * Creates a React Error Boundary class component tied to this doctor instance.
   * Returns a class component without importing React at module load time.
   *
   * Requires React to be available as `globalThis.React` or importable.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createErrorBoundary(): any {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const doctor = this;

    // Lazily access React — must be available in the calling environment
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const React = (globalThis as any).React;

    if (!React) {
      throw new Error(
        'createErrorBoundary() requires React to be available on globalThis. ' +
        'Ensure React is installed and available in your environment.',
      );
    }

    class ErrorBoundary extends React.Component {
      public readonly doctor = doctor;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      constructor(props: any) {
        super(props);
        this.state = { hasError: false, error: null };
        this.resetError = this.resetError.bind(this);
      }

      static getDerivedStateFromError(error: Error) {
        return { hasError: true, error };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      componentDidCatch(error: Error, info: any): void {
        doctor
          .captureException(error, {
            severity: 'fatal',
            componentStack: info?.componentStack,
          })
          .catch(() => {
            // Fire-and-forget — never throw from componentDidCatch
          });
      }

      resetError(): void {
        this.setState({ hasError: false, error: null });
      }

      render() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const state = this.state as any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const props = this.props as any;
        if (state.hasError) {
          if (props.fallback !== undefined) {
            return props.fallback;
          }
          return React.createElement(
            'div',
            { role: 'alert' },
            'Something went wrong.',
          );
        }
        return props.children;
      }
    }

    return ErrorBoundary;
  }
}
