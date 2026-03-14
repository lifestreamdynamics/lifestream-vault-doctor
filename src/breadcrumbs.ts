import type { Breadcrumb } from './types.js';

/**
 * Fixed-capacity circular buffer for breadcrumbs.
 * Oldest entries are evicted when the buffer is full.
 */
export class BreadcrumbBuffer {
  private readonly buffer: (Breadcrumb | undefined)[];
  private head = 0;
  private count = 0;
  public readonly capacity: number;

  constructor(capacity: number = 50) {
    this.capacity = Math.max(1, capacity);
    this.buffer = new Array(this.capacity);
  }

  /**
   * Add a breadcrumb to the buffer. Auto-sets timestamp if missing.
   */
  add(crumb: Omit<Breadcrumb, 'timestamp'> & { timestamp?: string }): void {
    const entry: Breadcrumb = {
      timestamp: crumb.timestamp ?? new Date().toISOString(),
      type: crumb.type,
      message: crumb.message,
      data: crumb.data,
    };

    this.buffer[this.head] = entry;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }
  }

  /**
   * Returns all breadcrumbs in oldest-first order.
   */
  getAll(): Breadcrumb[] {
    if (this.count === 0) return [];

    const result: Breadcrumb[] = [];
    const start = this.count < this.capacity ? 0 : this.head;

    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.capacity;
      const entry = this.buffer[idx];
      if (entry) {
        result.push(entry);
      }
    }

    return result;
  }

  /**
   * Clears all breadcrumbs.
   */
  clear(): void {
    this.buffer.fill(undefined);
    this.head = 0;
    this.count = 0;
  }

  /**
   * Returns the current number of breadcrumbs.
   */
  size(): number {
    return this.count;
  }
}
