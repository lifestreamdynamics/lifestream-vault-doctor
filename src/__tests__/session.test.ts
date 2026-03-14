import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Session } from '../session.js';

describe('Session', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('UUID format', () => {
    it('generates an id matching the 8-4-4-4-12 hex UUID v4 format', () => {
      const session = new Session();
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(session.id).toMatch(uuidRegex);
    });

    it('generates an id with exactly 5 segments separated by hyphens', () => {
      const session = new Session();
      const segments = session.id.split('-');
      expect(segments).toHaveLength(5);
      expect(segments[0]).toHaveLength(8);
      expect(segments[1]).toHaveLength(4);
      expect(segments[2]).toHaveLength(4);
      expect(segments[3]).toHaveLength(4);
      expect(segments[4]).toHaveLength(12);
    });
  });

  describe('getDurationMs', () => {
    it('returns ~0 immediately after construction', () => {
      const session = new Session();
      expect(session.getDurationMs()).toBe(0);
    });

    it('increases over time after advancing fake timers', () => {
      const session = new Session();
      vi.advanceTimersByTime(1000);
      expect(session.getDurationMs()).toBe(1000);
    });

    it('accumulates correctly across multiple time advances', () => {
      const session = new Session();
      vi.advanceTimersByTime(500);
      vi.advanceTimersByTime(750);
      expect(session.getDurationMs()).toBe(1250);
    });

    it('reflects large durations correctly', () => {
      const session = new Session();
      vi.advanceTimersByTime(5 * 60 * 1000); // 5 minutes
      expect(session.getDurationMs()).toBe(5 * 60 * 1000);
    });
  });

  describe('uniqueness', () => {
    it('each session has a unique id', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 20; i++) {
        ids.add(new Session().id);
      }
      expect(ids.size).toBe(20);
    });
  });
});
