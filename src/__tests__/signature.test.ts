import { describe, it, expect } from 'vitest';
import { buildSignaturePayload, generateNonce, signRequest, signPayload, SIGNATURE_HEADER, SIGNATURE_TIMESTAMP_HEADER, SIGNATURE_NONCE_HEADER } from '../lib/signature.js';

describe('signature', () => {
  describe('buildSignaturePayload', () => {
    it('returns a string with METHOD\\nPATH\\nTIMESTAMP\\nNONCE\\nBODY_HASH format', async () => {
      const payload = await buildSignaturePayload('PUT', '/api/v1/test', '2024-01-01T00:00:00.000Z', 'abc123', '{"hello":"world"}');
      const parts = payload.split('\n');
      expect(parts).toHaveLength(5);
      expect(parts[0]).toBe('PUT');
      expect(parts[1]).toBe('/api/v1/test');
      expect(parts[2]).toBe('2024-01-01T00:00:00.000Z');
      expect(parts[3]).toBe('abc123');
      // 5th part is the SHA-256 hash of the body
      expect(parts[4]).toMatch(/^[0-9a-f]{64}$/);
    });

    it('uppercases the HTTP method', async () => {
      const payload = await buildSignaturePayload('get', '/path', 'ts', 'n', '');
      expect(payload.startsWith('GET\n')).toBe(true);
    });

    it('produces different payloads for different bodies', async () => {
      const p1 = await buildSignaturePayload('PUT', '/p', 'ts', 'n', 'body-a');
      const p2 = await buildSignaturePayload('PUT', '/p', 'ts', 'n', 'body-b');
      expect(p1).not.toBe(p2);
    });

    it('produces the same payload for the same inputs', async () => {
      const args = ['POST', '/path', 'ts', 'nonce', 'body'] as const;
      const p1 = await buildSignaturePayload(...args);
      const p2 = await buildSignaturePayload(...args);
      expect(p1).toBe(p2);
    });
  });

  describe('generateNonce', () => {
    it('returns a 32-character hex string', () => {
      const nonce = generateNonce();
      expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    });

    it('generates unique nonces on consecutive calls', () => {
      const nonces = new Set(Array.from({ length: 20 }, () => generateNonce()));
      expect(nonces.size).toBe(20);
    });
  });

  describe('signPayload', () => {
    it('returns a 64-character hex string (HMAC-SHA256)', async () => {
      const sig = await signPayload('my-secret-key', 'some-payload-data');
      expect(sig).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces different signatures for different secrets', async () => {
      const s1 = await signPayload('key-a', 'payload');
      const s2 = await signPayload('key-b', 'payload');
      expect(s1).not.toBe(s2);
    });

    it('produces different signatures for different payloads', async () => {
      const s1 = await signPayload('key', 'payload-a');
      const s2 = await signPayload('key', 'payload-b');
      expect(s1).not.toBe(s2);
    });

    it('produces the same signature for same inputs', async () => {
      const s1 = await signPayload('key', 'payload');
      const s2 = await signPayload('key', 'payload');
      expect(s1).toBe(s2);
    });
  });

  describe('signRequest', () => {
    it('returns an object with x-signature, x-signature-timestamp, and x-signature-nonce', async () => {
      const headers = await signRequest('lsv_k_testkey', 'PUT', '/api/v1/vaults/v1/documents/test.md', '{"content":"hi"}');
      expect(headers[SIGNATURE_HEADER]).toBeDefined();
      expect(headers[SIGNATURE_TIMESTAMP_HEADER]).toBeDefined();
      expect(headers[SIGNATURE_NONCE_HEADER]).toBeDefined();
    });

    it('x-signature is a 64-char hex string', async () => {
      const headers = await signRequest('key', 'GET', '/path');
      expect(headers[SIGNATURE_HEADER]).toMatch(/^[0-9a-f]{64}$/);
    });

    it('x-signature-timestamp is an ISO timestamp', async () => {
      const headers = await signRequest('key', 'GET', '/path');
      expect(headers[SIGNATURE_TIMESTAMP_HEADER]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('x-signature-nonce is a 32-char hex string', async () => {
      const headers = await signRequest('key', 'GET', '/path');
      expect(headers[SIGNATURE_NONCE_HEADER]).toMatch(/^[0-9a-f]{32}$/);
    });

    it('defaults body to empty string when not provided', async () => {
      // Should not throw
      const headers = await signRequest('key', 'DELETE', '/path');
      expect(headers[SIGNATURE_HEADER]).toBeDefined();
    });
  });
});
