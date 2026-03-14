import { describe, it, expect, beforeEach, afterEach, vi, type MockedFunction } from 'vitest';
import { uploadReport } from '../uploader.js';
import { UploadError } from '../errors.js';

function makeFetchResponse(ok: boolean, status: number = 200, statusText: string = 'OK'): Response {
  return {
    ok,
    status,
    statusText,
  } as Response;
}

describe('uploadReport', () => {
  let mockFetch: MockedFunction<typeof fetch>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const baseOptions = {
    apiUrl: 'https://vault.example.com',
    vaultId: 'vault-abc',
    apiKey: 'lsv_k_testkey1234567890',
    content: '# Crash Report\n\nSomething went wrong.',
    path: 'crash-reports/2024-06-15/typeerror-abcdef12.md',
    enableRequestSigning: false,
  };

  describe('successful upload', () => {
    it('resolves without error when fetch returns ok', async () => {
      mockFetch.mockResolvedValue(makeFetchResponse(true, 200));
      await expect(uploadReport(baseOptions)).resolves.toBeUndefined();
    });

    it('calls fetch exactly once', async () => {
      mockFetch.mockResolvedValue(makeFetchResponse(true, 200));
      await uploadReport(baseOptions);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('request construction', () => {
    it('uses the PUT method', async () => {
      mockFetch.mockResolvedValue(makeFetchResponse(true));
      await uploadReport(baseOptions);
      const [, init] = mockFetch.mock.calls[0];
      expect((init as RequestInit).method).toBe('PUT');
    });

    it('builds the correct URL with vaultId and path', async () => {
      mockFetch.mockResolvedValue(makeFetchResponse(true));
      await uploadReport(baseOptions);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe(
        'https://vault.example.com/api/v1/vaults/vault-abc/documents/crash-reports/2024-06-15/typeerror-abcdef12.md',
      );
    });

    it('sets Authorization header as Bearer token', async () => {
      mockFetch.mockResolvedValue(makeFetchResponse(true));
      await uploadReport(baseOptions);
      const [, init] = mockFetch.mock.calls[0];
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer lsv_k_testkey1234567890');
    });

    it('sets Content-Type to application/json', async () => {
      mockFetch.mockResolvedValue(makeFetchResponse(true));
      await uploadReport(baseOptions);
      const [, init] = mockFetch.mock.calls[0];
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('sends JSON body containing content and createIntermediateFolders:true', async () => {
      mockFetch.mockResolvedValue(makeFetchResponse(true));
      await uploadReport(baseOptions);
      const [, init] = mockFetch.mock.calls[0];
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.content).toBe(baseOptions.content);
      expect(body.createIntermediateFolders).toBe(true);
    });
  });

  describe('HMAC signature headers', () => {
    it('includes x-signature, x-signature-timestamp, and x-signature-nonce when enableRequestSigning is true', async () => {
      mockFetch.mockResolvedValue(makeFetchResponse(true));
      await uploadReport({ ...baseOptions, enableRequestSigning: true });
      const [, init] = mockFetch.mock.calls[0];
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers['x-signature']).toBeDefined();
      expect(headers['x-signature-timestamp']).toBeDefined();
      expect(headers['x-signature-nonce']).toBeDefined();
    });

    it('omits signature headers when enableRequestSigning is false', async () => {
      mockFetch.mockResolvedValue(makeFetchResponse(true));
      await uploadReport({ ...baseOptions, enableRequestSigning: false });
      const [, init] = mockFetch.mock.calls[0];
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers['x-signature']).toBeUndefined();
      expect(headers['x-signature-timestamp']).toBeUndefined();
      expect(headers['x-signature-nonce']).toBeUndefined();
    });

    it('omits signature headers when enableRequestSigning is not specified (defaults to true)', async () => {
      // Default is true, so headers should be present
      mockFetch.mockResolvedValue(makeFetchResponse(true));
      const { enableRequestSigning: _, ...optionsWithoutSigning } = baseOptions;
      await uploadReport(optionsWithoutSigning);
      const [, init] = mockFetch.mock.calls[0];
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers['x-signature']).toBeDefined();
    });

    it('x-signature is a non-empty hex string', async () => {
      mockFetch.mockResolvedValue(makeFetchResponse(true));
      await uploadReport({ ...baseOptions, enableRequestSigning: true });
      const [, init] = mockFetch.mock.calls[0];
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers['x-signature']).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('UploadError on non-2xx response', () => {
    it('throws UploadError when response.ok is false', async () => {
      mockFetch.mockResolvedValue(makeFetchResponse(false, 422, 'Unprocessable Entity'));
      await expect(uploadReport(baseOptions)).rejects.toThrow(UploadError);
    });

    it('includes the HTTP status code on the UploadError', async () => {
      mockFetch.mockResolvedValue(makeFetchResponse(false, 422, 'Unprocessable Entity'));
      try {
        await uploadReport(baseOptions);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(UploadError);
        expect((err as UploadError).statusCode).toBe(422);
      }
    });

    it('throws UploadError for 404 response', async () => {
      mockFetch.mockResolvedValue(makeFetchResponse(false, 404, 'Not Found'));
      try {
        await uploadReport(baseOptions);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(UploadError);
        expect((err as UploadError).statusCode).toBe(404);
      }
    });

    it('throws UploadError for 500 response', async () => {
      mockFetch.mockResolvedValue(makeFetchResponse(false, 500, 'Internal Server Error'));
      try {
        await uploadReport(baseOptions);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(UploadError);
        expect((err as UploadError).statusCode).toBe(500);
      }
    });
  });

  describe('UploadError on network failure', () => {
    it('throws UploadError when fetch rejects with a network error', async () => {
      mockFetch.mockRejectedValue(new Error('Failed to fetch'));
      await expect(uploadReport(baseOptions)).rejects.toThrow(UploadError);
    });

    it('does not include a statusCode on network UploadError', async () => {
      mockFetch.mockRejectedValue(new Error('Network down'));
      try {
        await uploadReport(baseOptions);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(UploadError);
        expect((err as UploadError).statusCode).toBeUndefined();
      }
    });

    it('includes a descriptive message on network UploadError', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
      try {
        await uploadReport(baseOptions);
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as UploadError).message).toContain('ECONNREFUSED');
      }
    });
  });

  describe('timeout after 15 seconds', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('throws UploadError with timeout message when request exceeds 15 seconds', async () => {
      // Mock fetch that never resolves until abort signal fires
      mockFetch.mockImplementation((_url, init) => {
        return new Promise<Response>((_, reject) => {
          const signal = (init as RequestInit).signal;
          if (signal) {
            signal.addEventListener('abort', () => {
              const err = new Error('The operation was aborted.');
              err.name = 'AbortError';
              reject(err);
            });
          }
        });
      });

      const uploadPromise = uploadReport(baseOptions);
      // Advance time past the 15-second timeout
      vi.advanceTimersByTime(15_001);
      await expect(uploadPromise).rejects.toThrow(UploadError);
    });

    it('timeout UploadError message mentions 15 seconds', async () => {
      mockFetch.mockImplementation((_url, init) => {
        return new Promise<Response>((_, reject) => {
          const signal = (init as RequestInit).signal;
          if (signal) {
            signal.addEventListener('abort', () => {
              const err = new Error('The operation was aborted.');
              err.name = 'AbortError';
              reject(err);
            });
          }
        });
      });

      const uploadPromise = uploadReport(baseOptions);
      vi.advanceTimersByTime(15_001);
      try {
        await uploadPromise;
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as UploadError).message).toContain('15 seconds');
      }
    });
  });
});
