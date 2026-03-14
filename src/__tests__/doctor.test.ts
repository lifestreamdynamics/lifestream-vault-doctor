import { describe, it, expect, beforeEach, afterEach, vi, type MockedFunction } from 'vitest';
import { LifestreamDoctor } from '../doctor.js';
import { MemoryStorage } from '../queue/memory-storage.js';

function makeFetchResponse(ok: boolean, status: number = 200, statusText = 'OK'): Response {
  return { ok, status, statusText } as Response;
}

function makeDoctor(overrides: Partial<ConstructorParameters<typeof LifestreamDoctor>[0]> = {}) {
  const storage = new MemoryStorage();
  const doctor = new LifestreamDoctor({
    apiUrl: 'https://vault.example.com',
    vaultId: 'vault-test',
    apiKey: 'lsv_k_testkey',
    enableRequestSigning: false,
    storage,
    ...overrides,
  });
  return { doctor, storage };
}

describe('LifestreamDoctor', () => {
  let mockFetch: MockedFunction<typeof fetch>;

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue(makeFetchResponse(true));
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // ── Constructor validation ─────────────────────────────────────────────────

  describe('constructor validation', () => {
    it('throws when apiUrl is missing', () => {
      expect(() =>
        new LifestreamDoctor({ apiUrl: '', vaultId: 'v', apiKey: 'k' }),
      ).toThrow('apiUrl is required');
    });

    it('throws when vaultId is missing', () => {
      expect(() =>
        new LifestreamDoctor({ apiUrl: 'https://x.com', vaultId: '', apiKey: 'k' }),
      ).toThrow('vaultId is required');
    });

    it('throws when apiKey is missing', () => {
      expect(() =>
        new LifestreamDoctor({ apiUrl: 'https://x.com', vaultId: 'v', apiKey: '' }),
      ).toThrow('apiKey is required');
    });

    it('does not throw with all required fields present', () => {
      expect(() => makeDoctor()).not.toThrow();
    });

    it('allows empty apiKey when enabled is false', () => {
      expect(() =>
        new LifestreamDoctor({
          apiUrl: 'https://x.com',
          vaultId: 'v',
          apiKey: '',
          enabled: false,
        }),
      ).not.toThrow();
    });

    it('allows empty apiUrl and vaultId when enabled is false', () => {
      expect(() =>
        new LifestreamDoctor({
          apiUrl: '',
          vaultId: '',
          apiKey: '',
          enabled: false,
        }),
      ).not.toThrow();
    });

    it('still throws on empty apiKey when enabled is true', () => {
      expect(() =>
        new LifestreamDoctor({ apiUrl: 'https://x.com', vaultId: 'v', apiKey: '', enabled: true }),
      ).toThrow('apiKey is required');
    });
  });

  // ── Consent gate ──────────────────────────────────────────────────────────

  describe('consent gate', () => {
    it('captureException does nothing without consent', async () => {
      const { doctor } = makeDoctor();
      await doctor.captureException(new Error('test'));
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('captureException uploads after grantConsent', async () => {
      const { doctor } = makeDoctor();
      await doctor.grantConsent();
      await doctor.captureException(new Error('test'));
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('isConsentGranted returns false before grant', async () => {
      const { doctor } = makeDoctor();
      expect(await doctor.isConsentGranted()).toBe(false);
    });

    it('isConsentGranted returns true after grantConsent', async () => {
      const { doctor } = makeDoctor();
      await doctor.grantConsent();
      expect(await doctor.isConsentGranted()).toBe(true);
    });
  });

  // ── revokeConsent ─────────────────────────────────────────────────────────

  describe('revokeConsent', () => {
    it('clears the queue after revoking consent', async () => {
      mockFetch.mockRejectedValue(new Error('network down'));
      const { doctor } = makeDoctor();
      await doctor.grantConsent();
      await doctor.captureException(new Error('queued'));
      // Consent revoked — queue should be cleared
      await doctor.revokeConsent();
      // Re-grant and flush — nothing to upload since queue was cleared
      await doctor.grantConsent();
      const result = await doctor.flushQueue();
      expect(result.sent).toBe(0);
    });

    it('isConsentGranted returns false after revokeConsent', async () => {
      const { doctor } = makeDoctor();
      await doctor.grantConsent();
      await doctor.revokeConsent();
      expect(await doctor.isConsentGranted()).toBe(false);
    });
  });

  // ── Rate limiting ─────────────────────────────────────────────────────────

  describe('rate limiting', () => {
    it('captures the same error only once within the window', async () => {
      const { doctor } = makeDoctor({ rateLimitWindowMs: 60_000 });
      await doctor.grantConsent();
      const err = new Error('rate limited error');
      await doctor.captureException(err);
      await doctor.captureException(err); // same error, same window
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('allows the same error again after the rate limit window expires', async () => {
      vi.useFakeTimers();
      const { doctor } = makeDoctor({ rateLimitWindowMs: 1_000 });
      await doctor.grantConsent();
      const err = new Error('transient error');
      await doctor.captureException(err);
      vi.advanceTimersByTime(1_000);
      await doctor.captureException(err);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  // ── beforeSend filter ─────────────────────────────────────────────────────

  describe('beforeSend filter', () => {
    it('can modify the report before sending', async () => {
      const { doctor } = makeDoctor({
        beforeSend: (report) => ({ ...report, environment: 'modified-env' }),
      });
      await doctor.grantConsent();
      await doctor.captureException(new Error('test'));
      expect(mockFetch).toHaveBeenCalledTimes(1);
      // Verify the modified content is in the upload body
      const [, init] = mockFetch.mock.calls[0];
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.content).toContain('modified-env');
    });

    it('discards the report when beforeSend returns null', async () => {
      const { doctor } = makeDoctor({
        beforeSend: () => null,
      });
      await doctor.grantConsent();
      await doctor.captureException(new Error('filtered'));
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ── Full captureException flow ────────────────────────────────────────────

  describe('captureException full flow', () => {
    it('calls fetch with PUT method', async () => {
      const { doctor } = makeDoctor();
      await doctor.grantConsent();
      await doctor.captureException(new Error('full flow'));
      const [, init] = mockFetch.mock.calls[0];
      expect((init as RequestInit).method).toBe('PUT');
    });

    it('constructs the correct upload URL', async () => {
      const { doctor } = makeDoctor({
        apiUrl: 'https://vault.example.com',
        vaultId: 'vault-test',
      });
      await doctor.grantConsent();
      await doctor.captureException(new Error('url check'));
      const [url] = mockFetch.mock.calls[0];
      expect(url as string).toMatch(
        /^https:\/\/vault\.example\.com\/api\/v1\/vaults\/vault-test\/documents\//,
      );
    });

    it('includes the Authorization header with the apiKey', async () => {
      const { doctor } = makeDoctor({ apiKey: 'lsv_k_mykey' });
      await doctor.grantConsent();
      await doctor.captureException(new Error('auth check'));
      const [, init] = mockFetch.mock.calls[0];
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer lsv_k_mykey');
    });

    it('sends a body with content (Markdown) and createIntermediateFolders:true', async () => {
      const { doctor } = makeDoctor();
      await doctor.grantConsent();
      await doctor.captureException(new Error('body check'));
      const [, init] = mockFetch.mock.calls[0];
      const body = JSON.parse((init as RequestInit).body as string);
      expect(typeof body.content).toBe('string');
      expect(body.content.length).toBeGreaterThan(0);
      expect(body.createIntermediateFolders).toBe(true);
    });

    it('the upload URL path uses the pathPrefix option', async () => {
      const { doctor } = makeDoctor({ pathPrefix: 'custom-prefix' });
      await doctor.grantConsent();
      await doctor.captureException(new Error('prefix check'));
      const [url] = mockFetch.mock.calls[0];
      expect(url as string).toContain('custom-prefix/');
    });

    it('the upload URL path ends with .md', async () => {
      const { doctor } = makeDoctor();
      await doctor.grantConsent();
      await doctor.captureException(new Error('extension check'));
      const [url] = mockFetch.mock.calls[0];
      expect(url as string).toMatch(/\.md$/);
    });
  });

  // ── Queue fallback ────────────────────────────────────────────────────────

  describe('queue fallback', () => {
    it('enqueues the report when fetch throws', async () => {
      mockFetch.mockRejectedValue(new Error('offline'));
      const { doctor } = makeDoctor();
      await doctor.grantConsent();
      await doctor.captureException(new Error('queued error'));
      // Reset fetch to succeed so we can flush
      mockFetch.mockResolvedValue(makeFetchResponse(true));
      const result = await doctor.flushQueue();
      expect(result.sent).toBe(1);
    });

    it('enqueues the report when fetch returns non-2xx', async () => {
      mockFetch.mockResolvedValue(makeFetchResponse(false, 503, 'Service Unavailable'));
      const { doctor } = makeDoctor();
      await doctor.grantConsent();
      await doctor.captureException(new Error('server error'));
      mockFetch.mockResolvedValue(makeFetchResponse(true));
      const result = await doctor.flushQueue();
      expect(result.sent).toBe(1);
    });
  });

  // ── captureMessage ────────────────────────────────────────────────────────

  describe('captureMessage', () => {
    it('wraps the message as an Error with name CapturedMessage', async () => {
      const { doctor } = makeDoctor();
      await doctor.grantConsent();
      await doctor.captureMessage('Something notable', 'info');
      const [, init] = mockFetch.mock.calls[0];
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.content).toContain('CapturedMessage');
      expect(body.content).toContain('Something notable');
    });

    it('applies the provided severity', async () => {
      const { doctor } = makeDoctor();
      await doctor.grantConsent();
      await doctor.captureMessage('a warning', 'warning');
      const [, init] = mockFetch.mock.calls[0];
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.content).toContain('WARNING');
    });

    it('defaults severity to info', async () => {
      const { doctor } = makeDoctor();
      await doctor.grantConsent();
      await doctor.captureMessage('just info');
      const [, init] = mockFetch.mock.calls[0];
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.content).toContain('INFO');
    });
  });

  // ── flushQueue ────────────────────────────────────────────────────────────

  describe('flushQueue', () => {
    it('returns zero counts when queue is empty', async () => {
      const { doctor } = makeDoctor();
      await doctor.grantConsent();
      const result = await doctor.flushQueue();
      expect(result).toEqual({ sent: 0, failed: 0, deadLettered: 0 });
    });

    it('returns zero counts when consent has not been granted', async () => {
      const { doctor } = makeDoctor();
      const result = await doctor.flushQueue();
      expect(result).toEqual({ sent: 0, failed: 0, deadLettered: 0 });
    });

    it('uploads queued reports on flush', async () => {
      // First capture fails → enqueued
      mockFetch.mockRejectedValueOnce(new Error('offline'));
      const { doctor } = makeDoctor();
      await doctor.grantConsent();
      await doctor.captureException(new Error('queued'));
      expect(mockFetch).toHaveBeenCalledTimes(1);
      // Now flush — should succeed
      mockFetch.mockResolvedValue(makeFetchResponse(true));
      const result = await doctor.flushQueue();
      expect(result.sent).toBe(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  // ── addBreadcrumb ─────────────────────────────────────────────────────────

  describe('addBreadcrumb', () => {
    it('adds a breadcrumb that appears in the captured report', async () => {
      const { doctor } = makeDoctor();
      await doctor.grantConsent();
      doctor.addBreadcrumb({ type: 'navigation', message: 'User went to /settings' });
      await doctor.captureException(new Error('test'));
      const [, init] = mockFetch.mock.calls[0];
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.content).toContain('User went to /settings');
    });

    it('does not add breadcrumbs when enabled:false', () => {
      const { doctor } = makeDoctor({ enabled: false });
      // Should silently do nothing (no error thrown)
      expect(() => doctor.addBreadcrumb({ type: 'user', message: 'click' })).not.toThrow();
    });
  });

  // ── enabled:false skips capture ───────────────────────────────────────────

  describe('enabled: false', () => {
    it('skips captureException entirely', async () => {
      const { doctor } = makeDoctor({ enabled: false });
      await doctor.grantConsent();
      await doctor.captureException(new Error('should be skipped'));
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('skips captureMessage entirely', async () => {
      const { doctor } = makeDoctor({ enabled: false });
      await doctor.grantConsent();
      await doctor.captureMessage('skipped message');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ── Device context provider ───────────────────────────────────────────────

  describe('device context provider', () => {
    it('calls the provider when capturing an exception', async () => {
      const { doctor } = makeDoctor();
      await doctor.grantConsent();
      const provider = vi.fn().mockResolvedValue({ platform: 'ios', appVersion: '3.0.0' });
      doctor.setDeviceContextProvider(provider);
      await doctor.captureException(new Error('ctx test'));
      expect(provider).toHaveBeenCalledTimes(1);
    });

    it('includes device context in the report content', async () => {
      const { doctor } = makeDoctor();
      await doctor.grantConsent();
      doctor.setDeviceContextProvider(() => ({ platform: 'android', osVersion: '14' }));
      await doctor.captureException(new Error('device test'));
      const [, init] = mockFetch.mock.calls[0];
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.content).toContain('android');
    });

    it('continues without device context if provider throws', async () => {
      const { doctor } = makeDoctor();
      await doctor.grantConsent();
      doctor.setDeviceContextProvider(() => { throw new Error('provider error'); });
      await expect(doctor.captureException(new Error('test'))).resolves.toBeUndefined();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  // ── Tags: auto-tags + global tags + local tags merged and deduplicated ────

  describe('tags', () => {
    it('auto-generates severity, env, and errorName tags', async () => {
      const { doctor } = makeDoctor({ environment: 'staging' });
      await doctor.grantConsent();
      await doctor.captureException(new TypeError('bad type'));
      const [, init] = mockFetch.mock.calls[0];
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.content).toContain('severity:error');
      expect(body.content).toContain('env:staging');
      expect(body.content).toContain('typeerror');
    });

    it('includes global tags configured in options', async () => {
      const { doctor } = makeDoctor({ tags: ['app:mobile', 'team:platform'] });
      await doctor.grantConsent();
      await doctor.captureException(new Error('test'));
      const [, init] = mockFetch.mock.calls[0];
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.content).toContain('app:mobile');
      expect(body.content).toContain('team:platform');
    });

    it('includes local tags provided at capture time', async () => {
      const { doctor } = makeDoctor();
      await doctor.grantConsent();
      await doctor.captureException(new Error('test'), { tags: ['feature:payments', 'sprint:42'] });
      const [, init] = mockFetch.mock.calls[0];
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.content).toContain('feature:payments');
      expect(body.content).toContain('sprint:42');
    });

    it('deduplicates tags that appear in multiple sources', async () => {
      const { doctor } = makeDoctor({ tags: ['env:production'] });
      await doctor.grantConsent();
      await doctor.captureException(new Error('test'), { tags: ['env:production'] });
      const [, init] = mockFetch.mock.calls[0];
      const body = JSON.parse((init as RequestInit).body as string);
      // Count occurrences of 'env:production' in the tags YAML list
      const matches = (body.content as string).match(/  - env:production/g);
      expect(matches).toHaveLength(1);
    });

    it('uses severity from extras in auto-tags', async () => {
      const { doctor } = makeDoctor();
      await doctor.grantConsent();
      await doctor.captureException(new Error('fatal crash'), { severity: 'fatal' });
      const [, init] = mockFetch.mock.calls[0];
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.content).toContain('severity:fatal');
    });
  });

  // ── createErrorBoundary ───────────────────────────────────────────────────

  describe('createErrorBoundary', () => {
    it('throws when React is not available on globalThis', () => {
      const { doctor } = makeDoctor();
      // Ensure React is not on globalThis
      delete (globalThis as any).React;
      expect(() => doctor.createErrorBoundary()).toThrow('createErrorBoundary() requires React');
    });

    it('returns a component class when React is available', () => {
      const { doctor } = makeDoctor();
      // Minimal React mock
      (globalThis as any).React = {
        Component: class {},
        createElement: vi.fn(),
      };
      try {
        const Boundary = doctor.createErrorBoundary();
        expect(Boundary).toBeDefined();
        expect(typeof Boundary).toBe('function');
      } finally {
        delete (globalThis as any).React;
      }
    });

    it('returned boundary has a doctor reference', () => {
      const { doctor } = makeDoctor();
      (globalThis as any).React = {
        Component: class {},
        createElement: vi.fn(),
      };
      try {
        const Boundary = doctor.createErrorBoundary();
        const instance = new Boundary({});
        expect(instance.doctor).toBe(doctor);
      } finally {
        delete (globalThis as any).React;
      }
    });
  });
});
