/**
 * Rate limiter that deduplicates errors by fingerprint within a time window.
 */
export class RateLimiter {
  private static readonly MAX_FINGERPRINTS = 10_000;
  private readonly windowMs: number;
  private readonly seen = new Map<string, number>();

  constructor(windowMs: number = 60_000) {
    this.windowMs = Math.max(1000, windowMs);
  }

  /**
   * Creates a fingerprint from an error name and message.
   */
  static fingerprint(errorName: string, message: string): string {
    return `${errorName}::${message}`;
  }

  /**
   * Returns true if this error should be allowed (not rate-limited).
   * Returns false if the same fingerprint was seen within the window.
   * When the fingerprint map reaches MAX_FINGERPRINTS, new unknown
   * fingerprints are allowed through without tracking to prevent
   * unbounded memory growth.
   */
  shouldAllow(fingerprint: string): boolean {
    this.prune();

    const lastSeen = this.seen.get(fingerprint);
    const now = Date.now();

    if (lastSeen !== undefined && now - lastSeen < this.windowMs) {
      return false;
    }

    // Prevent unbounded memory growth — allow but don't track new fingerprints
    // when the map is at capacity
    if (this.seen.size >= RateLimiter.MAX_FINGERPRINTS && !this.seen.has(fingerprint)) {
      return true;
    }

    this.seen.set(fingerprint, now);
    return true;
  }

  /**
   * Removes expired entries from the map.
   */
  private prune(): void {
    const now = Date.now();
    for (const [key, timestamp] of this.seen) {
      if (now - timestamp >= this.windowMs) {
        this.seen.delete(key);
      }
    }
  }

  /**
   * Clears all tracked fingerprints.
   */
  clear(): void {
    this.seen.clear();
  }
}
