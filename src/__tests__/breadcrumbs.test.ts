import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BreadcrumbBuffer } from '../breadcrumbs.js';

describe('BreadcrumbBuffer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('adding breadcrumbs within capacity', () => {
    it('accepts a breadcrumb and returns it via getAll()', () => {
      const buf = new BreadcrumbBuffer(5);
      buf.add({ type: 'navigation', message: 'Navigated to /home' });
      const all = buf.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].type).toBe('navigation');
      expect(all[0].message).toBe('Navigated to /home');
    });

    it('accepts multiple breadcrumbs up to capacity', () => {
      const buf = new BreadcrumbBuffer(3);
      buf.add({ type: 'user', message: 'click A' });
      buf.add({ type: 'user', message: 'click B' });
      buf.add({ type: 'user', message: 'click C' });
      expect(buf.getAll()).toHaveLength(3);
    });

    it('preserves optional data field', () => {
      const buf = new BreadcrumbBuffer(5);
      buf.add({ type: 'http', message: 'GET /api', data: { status: 200 } });
      const all = buf.getAll();
      expect(all[0].data).toEqual({ status: 200 });
    });
  });

  describe('circular eviction when over capacity', () => {
    it('evicts the oldest entry when capacity is exceeded', () => {
      const buf = new BreadcrumbBuffer(3);
      buf.add({ type: 'a', message: 'first' });
      buf.add({ type: 'b', message: 'second' });
      buf.add({ type: 'c', message: 'third' });
      buf.add({ type: 'd', message: 'fourth' }); // evicts 'first'
      const all = buf.getAll();
      expect(all).toHaveLength(3);
      expect(all.find(c => c.message === 'first')).toBeUndefined();
      expect(all[0].message).toBe('second');
    });

    it('evicts multiple old entries when many are added over capacity', () => {
      const buf = new BreadcrumbBuffer(2);
      buf.add({ type: 'a', message: 'one' });
      buf.add({ type: 'b', message: 'two' });
      buf.add({ type: 'c', message: 'three' });
      buf.add({ type: 'd', message: 'four' });
      const all = buf.getAll();
      expect(all).toHaveLength(2);
      expect(all[0].message).toBe('three');
      expect(all[1].message).toBe('four');
    });

    it('never exceeds the declared capacity', () => {
      const buf = new BreadcrumbBuffer(5);
      for (let i = 0; i < 20; i++) {
        buf.add({ type: 'x', message: `msg-${i}` });
      }
      expect(buf.getAll()).toHaveLength(5);
    });
  });

  describe('oldest-first ordering on getAll()', () => {
    it('returns breadcrumbs in insertion order when under capacity', () => {
      const buf = new BreadcrumbBuffer(10);
      buf.add({ type: 'a', message: 'alpha' });
      buf.add({ type: 'b', message: 'beta' });
      buf.add({ type: 'c', message: 'gamma' });
      const all = buf.getAll();
      expect(all[0].message).toBe('alpha');
      expect(all[1].message).toBe('beta');
      expect(all[2].message).toBe('gamma');
    });

    it('returns oldest-surviving entries first after eviction', () => {
      const buf = new BreadcrumbBuffer(3);
      for (let i = 1; i <= 5; i++) {
        buf.add({ type: 'x', message: `msg-${i}` });
      }
      const all = buf.getAll();
      expect(all[0].message).toBe('msg-3');
      expect(all[1].message).toBe('msg-4');
      expect(all[2].message).toBe('msg-5');
    });
  });

  describe('auto-timestamps when omitted', () => {
    it('sets timestamp to current ISO string when not provided', () => {
      const buf = new BreadcrumbBuffer(5);
      buf.add({ type: 'console', message: 'log message' });
      const all = buf.getAll();
      expect(all[0].timestamp).toBe('2024-06-15T12:00:00.000Z');
    });

    it('preserves an explicitly provided timestamp', () => {
      const buf = new BreadcrumbBuffer(5);
      const ts = '2023-01-01T00:00:00.000Z';
      buf.add({ type: 'console', message: 'explicit', timestamp: ts });
      expect(buf.getAll()[0].timestamp).toBe(ts);
    });
  });

  describe('clear()', () => {
    it('empties the buffer', () => {
      const buf = new BreadcrumbBuffer(5);
      buf.add({ type: 'a', message: 'first' });
      buf.add({ type: 'b', message: 'second' });
      buf.clear();
      expect(buf.getAll()).toHaveLength(0);
    });

    it('allows adding new breadcrumbs after clear', () => {
      const buf = new BreadcrumbBuffer(3);
      buf.add({ type: 'a', message: 'old' });
      buf.clear();
      buf.add({ type: 'b', message: 'new' });
      const all = buf.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].message).toBe('new');
    });

    it('resets ordering correctly after clear and re-fill', () => {
      const buf = new BreadcrumbBuffer(3);
      // fill to capacity and then clear
      buf.add({ type: 'x', message: 'a' });
      buf.add({ type: 'x', message: 'b' });
      buf.add({ type: 'x', message: 'c' });
      buf.clear();
      buf.add({ type: 'x', message: 'd' });
      buf.add({ type: 'x', message: 'e' });
      const all = buf.getAll();
      expect(all[0].message).toBe('d');
      expect(all[1].message).toBe('e');
    });
  });

  describe('size()', () => {
    it('returns 0 on an empty buffer', () => {
      const buf = new BreadcrumbBuffer(5);
      expect(buf.size()).toBe(0);
    });

    it('tracks count as items are added', () => {
      const buf = new BreadcrumbBuffer(5);
      buf.add({ type: 'a', message: '1' });
      expect(buf.size()).toBe(1);
      buf.add({ type: 'a', message: '2' });
      expect(buf.size()).toBe(2);
    });

    it('caps at capacity when overflowed', () => {
      const buf = new BreadcrumbBuffer(3);
      for (let i = 0; i < 10; i++) {
        buf.add({ type: 'x', message: `m${i}` });
      }
      expect(buf.size()).toBe(3);
    });

    it('returns 0 after clear', () => {
      const buf = new BreadcrumbBuffer(5);
      buf.add({ type: 'a', message: 'x' });
      buf.clear();
      expect(buf.size()).toBe(0);
    });
  });

  describe('capacity property', () => {
    it('exposes the configured capacity', () => {
      const buf = new BreadcrumbBuffer(42);
      expect(buf.capacity).toBe(42);
    });

    it('defaults to 50', () => {
      const buf = new BreadcrumbBuffer();
      expect(buf.capacity).toBe(50);
    });

    it('clamps capacity to at least 1', () => {
      const buf = new BreadcrumbBuffer(0);
      expect(buf.capacity).toBe(1);
    });
  });
});
