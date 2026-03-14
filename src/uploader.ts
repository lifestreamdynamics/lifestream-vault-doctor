import { UploadError } from './errors.js';
import { signRequest as defaultSignRequest } from './lib/signature.js';

/**
 * Uploads a formatted crash report to the Lifestream Vault API.
 */
export async function uploadReport(options: {
  apiUrl: string;
  vaultId: string;
  apiKey: string;
  content: string;
  path: string;
  enableRequestSigning?: boolean;
  signRequest?: (apiKey: string, method: string, path: string, body: string) => Promise<Record<string, string>>;
}): Promise<void> {
  const { apiUrl, vaultId, apiKey, content, path, enableRequestSigning = true, signRequest } = options;

  const url = `${apiUrl}/api/v1/vaults/${vaultId}/documents/${path}`;
  const body = JSON.stringify({ content, createIntermediateFolders: true });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };

  if (enableRequestSigning) {
    if (signRequest) {
      // Use the custom signing function (e.g. for React Native without crypto.subtle)
      const urlObj = new URL(url);
      const sigHeaders = await signRequest(apiKey, 'PUT', urlObj.pathname, body);
      Object.assign(headers, sigHeaders);
    } else if (typeof globalThis.crypto?.subtle !== 'undefined') {
      // Use the built-in Web Crypto signing
      const urlObj = new URL(url);
      const sigHeaders = await defaultSignRequest(apiKey, 'PUT', urlObj.pathname, body);
      Object.assign(headers, sigHeaders);
    }
    // If neither is available, proceed without signing (server will reject if required)
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'PUT',
        headers,
        body,
        signal: controller.signal,
      });
    } catch (err) {
      // Network error or timeout
      const message =
        err instanceof Error && err.name === 'AbortError'
          ? 'Upload timed out after 15 seconds'
          : `Network error: ${err instanceof Error ? err.message : String(err)}`;
      throw new UploadError(message);
    }

    if (!response.ok) {
      let detail = response.statusText;
      try {
        const body = await response.text();
        if (body) detail = body;
      } catch {
        // Ignore read errors — use statusText
      }
      throw new UploadError(
        `Upload failed with HTTP ${response.status}: ${detail}`,
        response.status,
      );
    }
  } finally {
    clearTimeout(timeoutId);
  }
}
