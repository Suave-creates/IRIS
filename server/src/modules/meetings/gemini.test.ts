import { describe, expect, it } from 'vitest';
import { coalesceSegments, parseGeminiTranscript } from './gemini.js';

/** Wraps a JSON transcript string the way the Gemini API nests candidate text. */
function response(text: string): unknown {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

describe('parseGeminiTranscript', () => {
  it('parses a well-formed structured transcript into ordered segments', () => {
    const payload = response(
      JSON.stringify({
        language: 'hi-en',
        segments: [
          { start: 0, speaker: 'Arya', text: 'हेलो, let us start.' },
          { start: 6.4, speaker: 'Speaker 2', text: 'Haan bilkul.' },
        ],
      }),
    );
    const result = parseGeminiTranscript(payload, 'gemini-2.5-flash');
    expect(result).not.toBeNull();
    expect(result!.engine).toBe('gemini-2.5-flash');
    expect(result!.segments).toEqual([
      { start: 0, end: 0, text: 'हेलो, let us start.' },
      { start: 6.4, end: 6.4, text: 'Haan bilkul.' },
    ]);
  });

  it('drops segments missing a start or text, keeping the rest', () => {
    const payload = response(
      JSON.stringify({
        segments: [
          { speaker: 'X', text: 'no start' },
          { start: 3, text: '' },
          { start: 5, text: 'kept' },
        ],
      }),
    );
    const result = parseGeminiTranscript(payload, 'gemini-2.5-flash');
    expect(result!.segments).toEqual([{ start: 5, end: 5, text: 'kept' }]);
  });

  it('returns an empty-segment result when the model heard nothing', () => {
    const result = parseGeminiTranscript(response(JSON.stringify({ segments: [] })), 'gemini-2.5-flash');
    expect(result).toEqual({ engine: 'gemini-2.5-flash', segments: [] });
  });

  it('returns null when the candidate text is not JSON', () => {
    expect(parseGeminiTranscript(response('sorry, I cannot do that'), 'gemini-2.5-flash')).toBeNull();
  });

  it('returns null when segments is missing or not an array', () => {
    expect(parseGeminiTranscript(response(JSON.stringify({ language: 'en' })), 'gemini-2.5-flash')).toBeNull();
    expect(parseGeminiTranscript(response(JSON.stringify({ segments: 'nope' })), 'gemini-2.5-flash')).toBeNull();
  });

  it('returns null for an empty or malformed API envelope', () => {
    expect(parseGeminiTranscript({}, 'gemini-2.5-flash')).toBeNull();
    expect(parseGeminiTranscript({ candidates: [] }, 'gemini-2.5-flash')).toBeNull();
    expect(parseGeminiTranscript(null, 'gemini-2.5-flash')).toBeNull();
  });

  it('clamps negative starts and truncates very long text', () => {
    const long = 'x'.repeat(2500);
    const payload = response(JSON.stringify({ segments: [{ start: -3, text: long }] }));
    const result = parseGeminiTranscript(payload, 'gemini-2.5-flash');
    expect(result!.segments[0]!.start).toBe(0);
    expect(result!.segments[0]!.text.length).toBe(2000);
  });

  it('coalesces choppy fragments into clean sentence lines', () => {
    const payload = response(
      JSON.stringify({
        segments: [
          { start: 0, text: 'I am just testing your' },
          { start: 2, text: 'whether this' },
          { start: 4, text: 'looks fine.' },
          { start: 6, text: 'This is better now.' },
        ],
      }),
    );
    const result = parseGeminiTranscript(payload, 'gemini-2.5-flash');
    expect(result!.segments).toEqual([
      { start: 0, end: 4, text: 'I am just testing your whether this looks fine.' },
      { start: 6, end: 6, text: 'This is better now.' },
    ]);
  });
});

describe('coalesceSegments', () => {
  it('merges fragments up to a sentence boundary, keeping the first start', () => {
    const out = coalesceSegments([
      { start: 0, end: 0, text: 'Hello' },
      { start: 1, end: 1, text: 'everyone,' },
      { start: 3, end: 3, text: 'how are you?' },
    ]);
    expect(out).toEqual([{ start: 0, end: 3, text: 'Hello everyone, how are you?' }]);
  });

  it('splits on each sentence end', () => {
    const out = coalesceSegments([
      { start: 0, end: 0, text: 'One sentence.' },
      { start: 2, end: 2, text: 'Another one.' },
    ]);
    expect(out).toHaveLength(2);
  });

  it('flushes on the Hindi danda', () => {
    const out = coalesceSegments([
      { start: 0, end: 0, text: 'नमस्ते।' },
      { start: 2, end: 2, text: 'How are you?' },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.text).toBe('नमस्ते।');
  });

  it('flushes a runaway segment with no punctuation at the length cap', () => {
    const out = coalesceSegments([{ start: 0, end: 0, text: 'word '.repeat(60).trim() }]);
    expect(out).toHaveLength(1);
    expect(out[0]!.text.length).toBeGreaterThanOrEqual(240);
  });
});
