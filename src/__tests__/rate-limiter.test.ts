import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RateLimiter } from '../rate-limiter.js';

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('shouldAllow', () => {
    it('allows the first occurrence of any fingerprint', () => {
      const rl = new RateLimiter(60_000);
      expect(rl.shouldAllow('TypeError::something went wrong')).toBe(true);
    });

    it('denies the same fingerprint within the window', () => {
      const rl = new RateLimiter(60_000);
      rl.shouldAllow('TypeError::some error'); // first — allowed
      expect(rl.shouldAllow('TypeError::some error')).toBe(false);
    });

    it('denies the same fingerprint even after a short delay inside the window', () => {
      const rl = new RateLimiter(60_000);
      rl.shouldAllow('ReferenceError::x is not defined');
      vi.advanceTimersByTime(30_000); // halfway through window
      expect(rl.shouldAllow('ReferenceError::x is not defined')).toBe(false);
    });

    it('allows the same fingerprint again after the window expires', () => {
      const rl = new RateLimiter(60_000);
      rl.shouldAllow('TypeError::oops');
      vi.advanceTimersByTime(60_000); // exactly at window boundary — expired
      expect(rl.shouldAllow('TypeError::oops')).toBe(true);
    });

    it('allows the same fingerprint well after the window expires', () => {
      const rl = new RateLimiter(5_000);
      rl.shouldAllow('Error::msg');
      vi.advanceTimersByTime(10_000);
      expect(rl.shouldAllow('Error::msg')).toBe(true);
    });

    it('treats different fingerprints independently', () => {
      const rl = new RateLimiter(60_000);
      rl.shouldAllow('TypeError::bad type');
      rl.shouldAllow('SyntaxError::bad syntax');

      expect(rl.shouldAllow('TypeError::bad type')).toBe(false);
      expect(rl.shouldAllow('SyntaxError::bad syntax')).toBe(false);
      expect(rl.shouldAllow('ReferenceError::not defined')).toBe(true);
    });

    it('allows a different fingerprint while another is still rate-limited', () => {
      const rl = new RateLimiter(60_000);
      rl.shouldAllow('Error::A');
      expect(rl.shouldAllow('Error::B')).toBe(true);
    });
  });

  describe('clear()', () => {
    it('resets all tracked fingerprints so they are allowed again', () => {
      const rl = new RateLimiter(60_000);
      rl.shouldAllow('TypeError::first');
      rl.shouldAllow('RangeError::second');
      rl.clear();
      expect(rl.shouldAllow('TypeError::first')).toBe(true);
      expect(rl.shouldAllow('RangeError::second')).toBe(true);
    });
  });

  describe('RateLimiter.fingerprint()', () => {
    it('returns a string in the format errorName::message', () => {
      const fp = RateLimiter.fingerprint('TypeError', 'Cannot read properties of undefined');
      expect(fp).toBe('TypeError::Cannot read properties of undefined');
    });

    it('uses :: as the separator', () => {
      const fp = RateLimiter.fingerprint('Error', 'oops');
      expect(fp).toContain('::');
      const parts = fp.split('::');
      expect(parts[0]).toBe('Error');
      expect(parts[1]).toBe('oops');
    });

    it('produces different fingerprints for different error names', () => {
      const fp1 = RateLimiter.fingerprint('TypeError', 'same message');
      const fp2 = RateLimiter.fingerprint('RangeError', 'same message');
      expect(fp1).not.toBe(fp2);
    });

    it('produces different fingerprints for different messages', () => {
      const fp1 = RateLimiter.fingerprint('Error', 'message one');
      const fp2 = RateLimiter.fingerprint('Error', 'message two');
      expect(fp1).not.toBe(fp2);
    });
  });

  describe('window enforcement', () => {
    it('enforces a custom window duration', () => {
      const rl = new RateLimiter(2_000); // 2-second window
      rl.shouldAllow('Error::fast');
      vi.advanceTimersByTime(1_999);
      expect(rl.shouldAllow('Error::fast')).toBe(false);
      vi.advanceTimersByTime(1); // now at exactly 2000ms
      expect(rl.shouldAllow('Error::fast')).toBe(true);
    });

    it('clamps the window to a minimum of 1000ms', () => {
      // windowMs < 1000 should be clamped to 1000
      const rl = new RateLimiter(100);
      rl.shouldAllow('Error::x');
      vi.advanceTimersByTime(500);
      // still within the 1000ms minimum window
      expect(rl.shouldAllow('Error::x')).toBe(false);
      vi.advanceTimersByTime(500);
      // now at 1000ms — should be allowed
      expect(rl.shouldAllow('Error::x')).toBe(true);
    });
  });
});
