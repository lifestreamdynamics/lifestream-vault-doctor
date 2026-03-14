import { uuid } from './lib/uuid.js';

/**
 * Tracks a reporting session with a unique ID and duration.
 */
export class Session {
  public readonly id: string;
  private readonly startTime: number;

  constructor() {
    this.id = uuid();
    this.startTime = Date.now();
  }

  /**
   * Returns how long this session has been active, in milliseconds.
   */
  getDurationMs(): number {
    return Date.now() - this.startTime;
  }
}
