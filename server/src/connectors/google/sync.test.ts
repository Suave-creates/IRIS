import { describe, expect, it } from 'vitest';
import { categorize, extractPlainText, type GmailPayload } from './sync.js';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

describe('categorize', () => {
  it('routes by keyword and defaults to fyi', () => {
    expect(categorize('Need your approval on the sign-off')).toBe('approvals');
    expect(categorize('Team standup meeting agenda')).toBe('meetings');
    expect(categorize('Q3 budget invoice and finance review')).toBe('finance');
    expect(categorize('just a friendly hello')).toBe('fyi');
  });
});

describe('extractPlainText', () => {
  it('prefers a text/plain part', () => {
    const payload: GmailPayload = {
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/html', body: { data: b64('<p>ignored</p>') } },
        { mimeType: 'text/plain', body: { data: b64('the plain body') } },
      ],
    };
    expect(extractPlainText(payload)).toBe('the plain body');
  });

  it('falls back to stripped HTML when there is no plain part', () => {
    const payload: GmailPayload = {
      mimeType: 'text/html',
      body: { data: b64('<p>Hi <b>there</b></p><script>evil()</script>') },
    };
    const text = extractPlainText(payload);
    expect(text).toContain('there');
    expect(text).not.toContain('<');
    expect(text).not.toContain('evil()'); // script contents removed
  });

  it('reads a top-level body and returns empty for nothing', () => {
    expect(extractPlainText({ mimeType: 'text/plain', body: { data: b64('top level') } })).toBe('top level');
    expect(extractPlainText(undefined)).toBe('');
    expect(extractPlainText({ mimeType: 'multipart/mixed', parts: [] })).toBe('');
  });
});
