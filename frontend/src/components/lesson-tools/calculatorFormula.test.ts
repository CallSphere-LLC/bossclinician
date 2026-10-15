import { describe, expect, it } from 'vitest';
import { calculate } from './calculatorFormula';

describe('custom calculator formula', () => {
  it('respects grouping and updates when an input changes', () => {
    expect(calculate('(x1 + x2) / (x3 * x4)', [50000, 10000, 50, 10])).toBe(120);
    expect(calculate('(x1 + x2) / (x3 * x4)', [50000, 10000, 50, 20])).toBe(60);
  });
  it('rejects missing inputs, invalid arithmetic and code', () => {
    expect(calculate('x3 + 1', [1, 2])).toBeNull();
    expect(calculate('x1 / 0', [1])).toBeNull();
    expect(calculate('globalThis.alert(1)', [1])).toBeNull();
    expect(calculate('x1 +', [1])).toBeNull();
  });
});
