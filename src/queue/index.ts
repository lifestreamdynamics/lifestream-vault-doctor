import type { StorageBackend, QueuedReport, FlushResult } from '../types.js';
import { uuid } from '../lib/uuid.js';

const MAX_QUEUE_SIZE = 50;
const MAX_ATTEMPTS = 5;

/**
 * Persistent offline queue for crash reports that failed to upload.
 * Reports are stored as JSON via a StorageBackend and flushed when
 * connectivity is restored.
 */
export class CrashQueue {
  private readonly storage: StorageBackend;
  private readonly storageKey: string;

  constructor(storage: StorageBackend, storageKey: string = 'doctor:queue') {
    this.storage = storage;
    this.storageKey = storageKey;
  }

  /**
   * Adds a report to the queue.
   * If the queue is at capacity (50), the oldest entry is dropped to make room.
   */
  async enqueue(content: string, path: string): Promise<void> {
    const queue = await this.load();

    const entry: QueuedReport = {
      id: uuid(),
      content,
      path,
      attempts: 0,
      queuedAt: new Date().toISOString(),
    };

    // Drop oldest entry if at capacity
    if (queue.length >= MAX_QUEUE_SIZE) {
      queue.shift();
    }

    queue.push(entry);
    await this.save(queue);
  }

  /**
   * Returns the oldest entry without removing it, or null if empty.
   */
  async dequeue(): Promise<QueuedReport | null> {
    const queue = await this.load();
    return queue[0] ?? null;
  }

  /**
   * Removes an entry by id.
   */
  async remove(id: string): Promise<void> {
    const queue = await this.load();
    const updated = queue.filter(entry => entry.id !== id);
    await this.save(updated);
  }

  /**
   * Increments the attempt counter and sets lastAttemptAt for an entry.
   */
  async markAttempted(id: string): Promise<void> {
    const queue = await this.load();
    const updated = queue.map(entry => {
      if (entry.id === id) {
        return {
          ...entry,
          attempts: entry.attempts + 1,
          lastAttemptAt: new Date().toISOString(),
        };
      }
      return entry;
    });
    await this.save(updated);
  }

  /**
   * Returns the current number of queued reports.
   */
  async size(): Promise<number> {
    const queue = await this.load();
    return queue.length;
  }

  /**
   * Processes all queued reports by calling the handler for each.
   * - On success: removes the entry
   * - On failure: marks as attempted; dead-letters after MAX_ATTEMPTS
   */
  async flush(handler: (report: QueuedReport) => Promise<void>): Promise<FlushResult> {
    const queue = await this.load();
    const result: FlushResult = { sent: 0, failed: 0, deadLettered: 0 };

    for (const entry of queue) {
      try {
        await handler(entry);
        await this.remove(entry.id);
        result.sent++;
      } catch {
        await this.markAttempted(entry.id);
        const updated = await this.load();
        const current = updated.find(e => e.id === entry.id);

        if (current && current.attempts >= MAX_ATTEMPTS) {
          // Dead-letter: remove from queue after too many failures
          await this.remove(entry.id);
          result.deadLettered++;
        } else {
          result.failed++;
        }
      }
    }

    return result;
  }

  /**
   * Empties the queue.
   */
  async clear(): Promise<void> {
    await this.save([]);
  }

  /**
   * Loads the queue from storage, returning an empty array on parse failure.
   */
  private async load(): Promise<QueuedReport[]> {
    const raw = await this.storage.getItem(this.storageKey);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as QueuedReport[];
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Persists the queue to storage.
   */
  private async save(queue: QueuedReport[]): Promise<void> {
    await this.storage.setItem(this.storageKey, JSON.stringify(queue));
  }
}
