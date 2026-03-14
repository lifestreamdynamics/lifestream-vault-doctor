import type { StorageBackend } from '../types.js';

/**
 * Simple in-memory storage backend using a Map.
 * Useful for testing or environments without persistent storage.
 */
export class MemoryStorage implements StorageBackend {
  private readonly store = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.store.delete(key);
  }
}
