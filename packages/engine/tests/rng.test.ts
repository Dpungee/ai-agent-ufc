import { describe, it, expect } from 'vitest';
import { SeededRNG } from '../src/rng';

describe('SeededRNG', () => {
  it('produces deterministic output for the same seed', () => {
    const rng1 = new SeededRNG(42);
    const rng2 = new SeededRNG(42);
    const values1 = Array.from({ length: 100 }, () => rng1.next());
    const values2 = Array.from({ length: 100 }, () => rng2.next());
    expect(values1).toEqual(values2);
  });

  it('produces different output for different seeds', () => {
    const rng1 = new SeededRNG(42);
    const rng2 = new SeededRNG(43);
    const val1 = rng1.next();
    const val2 = rng2.next();
    expect(val1).not.toEqual(val2);
  });

  it('next() returns values in [0, 1)', () => {
    const rng = new SeededRNG(123);
    for (let i = 0; i < 1000; i++) {
      const val = rng.next();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });

  it('nextInt() returns values in [min, max] inclusive', () => {
    const rng = new SeededRNG(456);
    for (let i = 0; i < 500; i++) {
      const val = rng.nextInt(1, 6);
      expect(val).toBeGreaterThanOrEqual(1);
      expect(val).toBeLessThanOrEqual(6);
    }
  });

  it('nextFloat() returns values in [min, max)', () => {
    const rng = new SeededRNG(789);
    for (let i = 0; i < 500; i++) {
      const val = rng.nextFloat(5.0, 10.0);
      expect(val).toBeGreaterThanOrEqual(5.0);
      expect(val).toBeLessThan(10.0);
    }
  });

  it('chance() returns boolean', () => {
    const rng = new SeededRNG(100);
    let trueCount = 0;
    for (let i = 0; i < 1000; i++) {
      if (rng.chance(0.5)) trueCount++;
    }
    // Should be roughly 50% — allow wide margin
    expect(trueCount).toBeGreaterThan(350);
    expect(trueCount).toBeLessThan(650);
  });

  it('pick() returns an element from the array', () => {
    const rng = new SeededRNG(200);
    const arr = ['a', 'b', 'c', 'd'];
    for (let i = 0; i < 100; i++) {
      expect(arr).toContain(rng.pick(arr));
    }
  });
});
