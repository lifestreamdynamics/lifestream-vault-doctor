import { UploadError } from './errors.js';
import { signRequest } from './lib/signature.js';

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
}): Promise<void> {
  const { apiUrl, vaultId, apiKey, content, path, enableRequestSigning = true } = options;

  const url = `${apiUrl}/api/v1/vaults/${vaultId}/documents/${path}`;
  const body = JSON.stringify({ content, createIntermediateFolders: true });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };

  if (enableRequestSigning && typeof globalThis.crypto?.subtle !== 'undefined') {
    const urlObj = new URL(url);
    const requestPath = urlObj.pathname;
    const sigHeaders = await signRequest(apiKey, 'PUT', requestPath, body);
    Object.assign(headers, sigHeaders);
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
      throw new UploadError(
        `Upload failed with HTTP ${response.status}: ${response.statusText}`,
        response.status,
      );
    }
  } finally {
    clearTimeout(timeoutId);
  }
}
