import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CrashQueue } from '../queue/index.js';
import { MemoryStorage } from '../queue/memory-storage.js';
import type { QueuedReport } from '../types.js';

function makeStorage() {
  return new MemoryStorage();
}

function makeQueue(storage = makeStorage()) {
  return new CrashQueue(storage);
}

describe('CrashQueue', () => {
  describe('enqueue', () => {
    it('adds an entry to an empty queue', async () => {
      const q = makeQueue();
      await q.enqueue('# report', 'crash-reports/2024-06-15/typeerror-abc.md');
      expect(await q.size()).toBe(1);
    });

    it('adds multiple entries', async () => {
      const q = makeQueue();
      await q.enqueue('content-1', 'path/one.md');
      await q.enqueue('content-2', 'path/two.md');
      await q.enqueue('content-3', 'path/three.md');
      expect(await q.size()).toBe(3);
    });

    it('initialises attempts to 0', async () => {
      const q = makeQueue();
      await q.enqueue('content', 'path.md');
      const entry = await q.dequeue();
      expect(entry?.attempts).toBe(0);
    });

    it('sets queuedAt as an ISO timestamp string', async () => {
      const q = makeQueue();
      await q.enqueue('content', 'path.md');
      const entry = await q.dequeue();
      expect(entry?.queuedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('generates a unique id for each entry', async () => {
      const q = makeQueue();
      await q.enqueue('a', 'a.md');
      await q.enqueue('b', 'b.md');
      const first = await q.dequeue();
      await q.remove(first!.id);
      const second = await q.dequeue();
      expect(first?.id).not.toBe(second?.id);
    });
  });

  describe('dequeue', () => {
    it('returns null on an empty queue', async () => {
      const q = makeQueue();
      expect(await q.dequeue()).toBeNull();
    });

    it('returns the oldest entry without removing it', async () => {
      const q = makeQueue();
      await q.enqueue('first', 'first.md');
      await q.enqueue('second', 'second.md');
      const entry = await q.dequeue();
      expect(entry?.content).toBe('first');
      // size unchanged
      expect(await q.size()).toBe(2);
    });

    it('returns the same entry on repeated calls when nothing is removed', async () => {
      const q = makeQueue();
      await q.enqueue('only', 'only.md');
      const a = await q.dequeue();
      const b = await q.dequeue();
      expect(a?.id).toBe(b?.id);
    });
  });

  describe('remove', () => {
    it('removes an entry by id', async () => {
      const q = makeQueue();
      await q.enqueue('content', 'path.md');
      const entry = await q.dequeue();
      await q.remove(entry!.id);
      expect(await q.size()).toBe(0);
    });

    it('only removes the entry with the matching id', async () => {
      const q = makeQueue();
      await q.enqueue('first', 'first.md');
      await q.enqueue('second', 'second.md');
      const first = await q.dequeue();
      await q.remove(first!.id);
      expect(await q.size()).toBe(1);
      const remaining = await q.dequeue();
      expect(remaining?.content).toBe('second');
    });

    it('is a no-op for an unknown id', async () => {
      const q = makeQueue();
      await q.enqueue('content', 'path.md');
      await q.remove('non-existent-id');
      expect(await q.size()).toBe(1);
    });
  });

  describe('markAttempted', () => {
    it('increments the attempts counter', async () => {
      const q = makeQueue();
      await q.enqueue('content', 'path.md');
      const entry = await q.dequeue();
      await q.markAttempted(entry!.id);
      const updated = await q.dequeue();
      expect(updated?.attempts).toBe(1);
    });

    it('increments attempts on subsequent calls', async () => {
      const q = makeQueue();
      await q.enqueue('content', 'path.md');
      const entry = await q.dequeue();
      await q.markAttempted(entry!.id);
      await q.markAttempted(entry!.id);
      await q.markAttempted(entry!.id);
      const updated = await q.dequeue();
      expect(updated?.attempts).toBe(3);
    });

    it('sets lastAttemptAt after marking', async () => {
      const q = makeQueue();
      await q.enqueue('content', 'path.md');
      const entry = await q.dequeue();
      await q.markAttempted(entry!.id);
      const updated = await q.dequeue();
      expect(updated?.lastAttemptAt).toBeDefined();
      expect(updated?.lastAttemptAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('max 50 entries — drops oldest on overflow', () => {
    it('caps queue at 50 entries', async () => {
      const q = makeQueue();
      for (let i = 0; i < 55; i++) {
        await q.enqueue(`content-${i}`, `path-${i}.md`);
      }
      expect(await q.size()).toBe(50);
    });

    it('drops the oldest entry when capacity is exceeded', async () => {
      const q = makeQueue();
      // Fill to exactly 50
      for (let i = 0; i < 50; i++) {
        await q.enqueue(`content-${i}`, `path-${i}.md`);
      }
      // Add one more — should drop content-0
      await q.enqueue('content-50', 'path-50.md');
      const oldest = await q.dequeue();
      expect(oldest?.content).toBe('content-1');
    });
  });

  describe('flush', () => {
    it('calls handler for each queued entry', async () => {
      const q = makeQueue();
      await q.enqueue('a', 'a.md');
      await q.enqueue('b', 'b.md');
      const handler = vi.fn().mockResolvedValue(undefined);
      await q.flush(handler);
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('removes entries on successful handler call', async () => {
      const q = makeQueue();
      await q.enqueue('a', 'a.md');
      await q.flush(vi.fn().mockResolvedValue(undefined));
      expect(await q.size()).toBe(0);
    });

    it('marks entry as attempted when handler throws', async () => {
      const q = makeQueue();
      await q.enqueue('a', 'a.md');
      const entry = await q.dequeue();
      const handler = vi.fn().mockRejectedValue(new Error('network down'));
      await q.flush(handler);
      const updated = await q.dequeue();
      expect(updated?.id).toBe(entry!.id);
      expect(updated?.attempts).toBe(1);
    });

    it('keeps failed entry in queue when attempts < 5', async () => {
      const q = makeQueue();
      await q.enqueue('a', 'a.md');
      const handler = vi.fn().mockRejectedValue(new Error('fail'));
      await q.flush(handler);
      expect(await q.size()).toBe(1);
    });

    it('dead-letters entry after 5 failed attempts', async () => {
      const q = makeQueue();
      await q.enqueue('a', 'a.md');
      const handler = vi.fn().mockRejectedValue(new Error('fail'));
      // Flush 5 times to reach MAX_ATTEMPTS
      for (let i = 0; i < 5; i++) {
        await q.flush(handler);
      }
      // On the 5th flush, the entry reaches 5 attempts and is dead-lettered
      expect(await q.size()).toBe(0);
    });

    it('returns correct FlushResult.sent count', async () => {
      const q = makeQueue();
      await q.enqueue('a', 'a.md');
      await q.enqueue('b', 'b.md');
      const result = await q.flush(vi.fn().mockResolvedValue(undefined));
      expect(result.sent).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.deadLettered).toBe(0);
    });

    it('returns correct FlushResult.failed count when handler throws', async () => {
      const q = makeQueue();
      await q.enqueue('a', 'a.md');
      // Pre-mark attempts so this doesn't dead-letter
      const entry = await q.dequeue();
      // 0 attempts, so first failure won't dead-letter
      const result = await q.flush(vi.fn().mockRejectedValue(new Error('fail')));
      expect(result.failed).toBe(1);
      expect(result.sent).toBe(0);
      expect(result.deadLettered).toBe(0);
    });

    it('returns correct FlushResult.deadLettered count', async () => {
      const q = makeQueue();
      await q.enqueue('a', 'a.md');
      const handler = vi.fn().mockRejectedValue(new Error('fail'));
      let lastResult = { sent: 0, failed: 0, deadLettered: 0 };
      for (let i = 0; i < 5; i++) {
        lastResult = await q.flush(handler);
      }
      expect(lastResult.deadLettered).toBe(1);
      expect(lastResult.sent).toBe(0);
      expect(lastResult.failed).toBe(0);
    });

    it('handles mixed success and failure correctly', async () => {
      const q = makeQueue();
      await q.enqueue('good', 'good.md');
      await q.enqueue('bad', 'bad.md');
      let callCount = 0;
      const handler = vi.fn().mockImplementation(async (report: QueuedReport) => {
        callCount++;
        if (report.content === 'bad') throw new Error('fail');
      });
      const result = await q.flush(handler);
      expect(result.sent).toBe(1);
      expect(result.failed).toBe(1);
    });
  });

  describe('clear', () => {
    it('empties the queue', async () => {
      const q = makeQueue();
      await q.enqueue('a', 'a.md');
      await q.enqueue('b', 'b.md');
      await q.clear();
      expect(await q.size()).toBe(0);
    });

    it('returns null from dequeue after clear', async () => {
      const q = makeQueue();
      await q.enqueue('a', 'a.md');
      await q.clear();
      expect(await q.dequeue()).toBeNull();
    });
  });

  describe('persistence round-trip via MemoryStorage', () => {
    it('saves to storage and can be reloaded by a new queue instance', async () => {
      const storage = makeStorage();
      const q1 = new CrashQueue(storage);
      await q1.enqueue('persistent content', 'saved/path.md');

      // Create a new queue pointing at the same storage
      const q2 = new CrashQueue(storage);
      expect(await q2.size()).toBe(1);
      const entry = await q2.dequeue();
      expect(entry?.content).toBe('persistent content');
      expect(entry?.path).toBe('saved/path.md');
    });

    it('persists attempts and lastAttemptAt across instances', async () => {
      const storage = makeStorage();
      const q1 = new CrashQueue(storage);
      await q1.enqueue('content', 'path.md');
      const entry = await q1.dequeue();
      await q1.markAttempted(entry!.id);

      const q2 = new CrashQueue(storage);
      const loaded = await q2.dequeue();
      expect(loaded?.attempts).toBe(1);
      expect(loaded?.lastAttemptAt).toBeDefined();
    });

    it('clear in one instance empties for another instance using same storage', async () => {
      const storage = makeStorage();
      const q1 = new CrashQueue(storage);
      await q1.enqueue('content', 'path.md');
      await q1.clear();

      const q2 = new CrashQueue(storage);
      expect(await q2.size()).toBe(0);
    });
  });

  describe('corrupted storage', () => {
    it('returns empty queue when storage contains invalid JSON', async () => {
      const storage = makeStorage();
      await storage.setItem('doctor:queue', 'not-valid-json{{{');
      const q = new CrashQueue(storage);
      expect(await q.size()).toBe(0);
      expect(await q.dequeue()).toBeNull();
    });

    it('returns empty queue when storage contains non-array JSON', async () => {
      const storage = makeStorage();
      await storage.setItem('doctor:queue', '{"key":"value"}');
      const q = new CrashQueue(storage);
      expect(await q.size()).toBe(0);
    });

    it('returns empty queue when storage contains null JSON', async () => {
      const storage = makeStorage();
      await storage.setItem('doctor:queue', 'null');
      const q = new CrashQueue(storage);
      expect(await q.size()).toBe(0);
    });
  });
});
