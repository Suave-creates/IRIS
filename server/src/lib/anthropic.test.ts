import { describe, expect, it } from 'vitest';
import { systemBlocks } from './anthropic.js';

describe('systemBlocks', () => {
  it('appends the no-emoji style rule to the persona and marks it cacheable', () => {
    const blocks = systemBlocks('You are IRIS.');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe('text');
    expect(blocks[0]!.text).toContain('You are IRIS.');
    expect(blocks[0]!.text.toLowerCase()).toContain('never use emojis');
    expect((blocks[0] as unknown as { cache_control?: unknown }).cache_control).toEqual({ type: 'ephemeral' });
  });

  it('adds a separate volatile context block when context is given', () => {
    const blocks = systemBlocks('Persona', 'CONTEXT BLOCK');
    expect(blocks).toHaveLength(2);
    expect(blocks[1]!.text).toBe('CONTEXT BLOCK');
    // The context block is volatile (not cache-marked).
    expect((blocks[1] as unknown as { cache_control?: unknown }).cache_control).toBeUndefined();
  });

  it('omits the context block when context is empty/undefined', () => {
    expect(systemBlocks('Persona')).toHaveLength(1);
    expect(systemBlocks('Persona', '')).toHaveLength(1);
  });
});
