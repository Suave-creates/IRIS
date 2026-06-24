import { describe, expect, it } from 'vitest';
import { id, requestId } from './ids.js';

describe('id', () => {
  it('produces a prefixed, url-safe id', () => {
    const v = id('usr');
    expect(v).toMatch(/^usr_[0-9a-z]+$/);
    expect(v.length).toBeGreaterThan(4);
  });
  it('is collision-resistant across calls', () => {
    const set = new Set(Array.from({ length: 1000 }, () => id('t')));
    expect(set.size).toBe(1000);
  });
});

describe('requestId', () => {
  it('is a 21-char unprefixed token', () => {
    expect(requestId()).toMatch(/^[0-9a-z]{21}$/);
  });
});
