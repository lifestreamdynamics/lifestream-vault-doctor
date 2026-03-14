/**
 * HMAC request signing utilities.
 * Verbatim copy from packages/sdk/src/lib/signature.ts — kept standalone
 * to avoid a runtime dependency on the full SDK package.
 */

/**
 * Headers used for HMAC request signing.
 */
export const SIGNATURE_HEADER = 'x-signature';
export const SIGNATURE_TIMESTAMP_HEADER = 'x-signature-timestamp';
export const SIGNATURE_NONCE_HEADER = 'x-signature-nonce';

/**
 * Maximum age (in milliseconds) for a signed request timestamp.
 * Requests older than this are rejected to prevent replay attacks.
 */
export const MAX_TIMESTAMP_AGE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Compute a SHA-256 hash of a string and return it as a lowercase hex string.
 * Uses the Web Crypto API (available in Node 18+, all modern browsers, Deno, Bun).
 */
async function sha256Hex(data: string): Promise<string> {
  const encoded = new TextEncoder().encode(data);
  const hash = await globalThis.crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Compute an HMAC-SHA256 of a message using a secret key.
 * Returns the result as a lowercase hex string.
 * Uses the Web Crypto API (available in Node 18+, all modern browsers, Deno, Bun).
 */
async function hmacSha256Hex(key: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await globalThis.crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Constructs the canonical payload string for HMAC signing.
 *
 * Format: METHOD\nPATH\nTIMESTAMP\nNONCE\nBODY_HASH
 *
 * @param method - HTTP method (uppercase)
 * @param path - Request path (no query string)
 * @param timestamp - ISO-8601 timestamp
 * @param nonce - 16-byte hex nonce
 * @param body - Request body string (empty string if no body)
 * @returns The canonical payload string
 */
export async function buildSignaturePayload(
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  body: string,
): Promise<string> {
  const bodyHash = await sha256Hex(body);
  return `${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;
}

/**
 * Generates an HMAC-SHA256 signature for a request.
 *
 * @param secret - The API key used as the HMAC secret
 * @param payload - The canonical payload string
 * @returns Hex-encoded HMAC signature
 */
export async function signPayload(secret: string, payload: string): Promise<string> {
  return hmacSha256Hex(secret, payload);
}

/**
 * Generates a cryptographically secure 16-byte hex nonce.
 * Uses the Web Crypto API (available in Node 18+, all modern browsers, Deno, Bun).
 */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Signs a request and returns the headers to attach.
 *
 * @param apiKey - The full API key (used as HMAC secret)
 * @param method - HTTP method
 * @param path - Request path (without query string)
 * @param body - Request body string (empty string for no body)
 * @returns Object containing the three signature headers
 */
export async function signRequest(
  apiKey: string,
  method: string,
  path: string,
  body: string = '',
): Promise<Record<string, string>> {
  const timestamp = new Date().toISOString();
  const nonce = generateNonce();
  const payload = await buildSignaturePayload(method, path, timestamp, nonce, body);
  const signature = await signPayload(apiKey, payload);

  return {
    [SIGNATURE_HEADER]: signature,
    [SIGNATURE_TIMESTAMP_HEADER]: timestamp,
    [SIGNATURE_NONCE_HEADER]: nonce,
  };
}
