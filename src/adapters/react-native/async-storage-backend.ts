import type { StorageBackend } from '../../types.js';

/**
 * Minimal interface matching @react-native-async-storage/async-storage.
 * Typed inline so the package is not a required peer dependency.
 */
interface AsyncStorageInstance {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * StorageBackend implementation backed by AsyncStorage.
 *
 * Pass an AsyncStorage instance in the constructor, or leave it out and the
 * module will be lazily imported from @react-native-async-storage/async-storage
 * the first time a storage method is called.
 */
export class AsyncStorageBackend implements StorageBackend {
  private readonly _provided: AsyncStorageInstance | undefined;
  private _resolved: AsyncStorageInstance | undefined;

  constructor(asyncStorage?: AsyncStorageInstance) {
    this._provided = asyncStorage;
  }

  private async _storage(): Promise<AsyncStorageInstance> {
    if (this._provided !== undefined) {
      return this._provided;
    }
    if (this._resolved !== undefined) {
      return this._resolved;
    }
    // Lazy-load module — only imported once
    // @ts-ignore — optional peer dependency, not installed in standalone builds
    const mod = await import('@react-native-async-storage/async-storage');
    // The module's default export is the AsyncStorage object
    this._resolved = (mod.default ?? mod) as unknown as AsyncStorageInstance;
    return this._resolved;
  }

  async getItem(key: string): Promise<string | null> {
    const storage = await this._storage();
    return storage.getItem(key);
  }

  async setItem(key: string, value: string): Promise<void> {
    const storage = await this._storage();
    return storage.setItem(key, value);
  }

  async removeItem(key: string): Promise<void> {
    const storage = await this._storage();
    return storage.removeItem(key);
  }
}
