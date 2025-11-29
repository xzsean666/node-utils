import { describe, it, expect } from 'vitest';
import { sum, multiply } from '../src/index.js';

describe('sum function', () => {
  it('should add two numbers correctly', () => {
    expect(sum(1, 2)).toBe(3);
  });

  it('should handle negative numbers', () => {
    expect(sum(-1, 1)).toBe(0);
  });
});

describe('multiply function', () => {
  it('should multiply two numbers correctly', () => {
    expect(multiply(2, 3)).toBe(6);
  });
});
