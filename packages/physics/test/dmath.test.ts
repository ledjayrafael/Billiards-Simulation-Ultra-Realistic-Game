import { describe, expect, it } from 'vitest';
import { dcos, dexp, dsin } from '../src/dmath';

describe('dmath deterministik', () => {
  it('akurat terhadap Math.*', () => {
    for (let i = -400; i <= 400; i++) {
      const x = i * 0.0937;
      expect(Math.abs(dsin(x) - Math.sin(x))).toBeLessThan(1e-12);
      expect(Math.abs(dcos(x) - Math.cos(x))).toBeLessThan(1e-12);
    }
    for (let i = -200; i <= 40; i++) {
      const x = i * 0.05;
      expect(Math.abs(dexp(x) / Math.exp(x) - 1)).toBeLessThan(1e-12);
    }
  });
});
