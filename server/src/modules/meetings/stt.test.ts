import { describe, expect, it } from 'vitest';
import { mapPreviewSpeaker, mergeChannelSegments, parseSttOutput, UNKNOWN_SPEAKER } from './stt.js';

describe('parseSttOutput', () => {
  const CONTRACT = JSON.stringify({
    engine: 'whisper-large-v3',
    language: 'en',
    durationSecs: 12.4,
    segments: [
      { start: 0.0, end: 3.2, text: ' Quick agenda for today. ' },
      { start: 3.4, end: 7.9, text: 'ASRS picks are up 8% week over week.' },
    ],
  });

  it('parses the transcribe.py contract into sanitized segments', () => {
    const out = parseSttOutput(CONTRACT);
    expect(out?.engine).toBe('whisper-large-v3');
    expect(out?.segments).toEqual([
      { start: 0, end: 3.2, text: 'Quick agenda for today.' },
      { start: 3.4, end: 7.9, text: 'ASRS picks are up 8% week over week.' },
    ]);
  });

  it('returns null for non-JSON, non-object, or segment-less output', () => {
    expect(parseSttOutput('model loading...')).toBeNull();
    expect(parseSttOutput('[]')).toBeNull();
    expect(parseSttOutput('"whisper"')).toBeNull();
    expect(parseSttOutput('{"engine":"whisper-large-v3"}')).toBeNull();
  });

  it('drops malformed segments and clamps negative timestamps to zero', () => {
    const out = parseSttOutput(
      JSON.stringify({
        engine: 'whisper-large-v3',
        segments: [
          { start: -1.2, end: 0.5, text: 'clamped' },
          { start: 'x', end: 1, text: 'dropped' },
          { start: 1, end: 2, text: '   ' },
          { start: 2, end: 3 },
          null,
          { start: 3, end: 4, text: 'kept' },
        ],
      }),
    );
    expect(out?.segments).toEqual([
      { start: 0, end: 0.5, text: 'clamped' },
      { start: 3, end: 4, text: 'kept' },
    ]);
  });

  it('derives a whisper engine label when the field is missing', () => {
    const out = parseSttOutput(JSON.stringify({ segments: [{ start: 0, end: 1, text: 'hi' }] }));
    expect(out?.engine).toMatch(/^whisper-/);
  });
});

describe('mergeChannelSegments', () => {
  it('speaks mic as the executive and call as the unknown-speaker placeholder, interleaved by time', () => {
    const lines = mergeChannelSegments(
      'Arya Khadgi',
      [
        { start: 0.2, end: 3, text: 'Quick agenda for today.' },
        { start: 9.6, end: 12, text: 'Agreed, lock it in.' },
      ],
      [{ start: 4.5, end: 9, text: 'Putaway is still the bottleneck on line 3.' }],
    );
    expect(lines).toEqual([
      { tsSecs: 0, speaker: 'Arya Khadgi', text: 'Quick agenda for today.' },
      { tsSecs: 5, speaker: UNKNOWN_SPEAKER, text: 'Putaway is still the bottleneck on line 3.' },
      { tsSecs: 10, speaker: 'Arya Khadgi', text: 'Agreed, lock it in.' },
    ]);
  });

  it('never emits MIC/CALL channel labels', () => {
    const lines = mergeChannelSegments('Arya Khadgi', [{ start: 0, end: 1, text: 'a' }], [{ start: 2, end: 3, text: 'b' }]);
    expect(lines.map((l) => l.speaker)).toEqual(['Arya Khadgi', 'Unknown Speaker']);
  });

  it('handles a mic-only recording and a blank user name', () => {
    expect(mergeChannelSegments('  ', [{ start: 1.2, end: 2, text: 'solo note' }], [])).toEqual([
      { tsSecs: 1, speaker: 'You', text: 'solo note' },
    ]);
    expect(mergeChannelSegments('Arya', [], [])).toEqual([]);
  });
});

describe('mapPreviewSpeaker', () => {
  it('maps the executive channels to the real name and everything else to the placeholder', () => {
    expect(mapPreviewSpeaker('You', 'Arya Khadgi')).toBe('Arya Khadgi');
    expect(mapPreviewSpeaker('mic', 'Arya Khadgi')).toBe('Arya Khadgi');
    expect(mapPreviewSpeaker('Mic', 'Arya Khadgi')).toBe('Arya Khadgi');
    expect(mapPreviewSpeaker('Call', 'Arya Khadgi')).toBe(UNKNOWN_SPEAKER);
    expect(mapPreviewSpeaker('Speaker 2', 'Arya Khadgi')).toBe(UNKNOWN_SPEAKER);
    expect(mapPreviewSpeaker('Raj Pandey', 'Arya Khadgi')).toBe(UNKNOWN_SPEAKER);
  });
});
