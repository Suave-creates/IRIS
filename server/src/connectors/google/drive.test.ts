import { describe, expect, it } from 'vitest';
import { isXlsxMime, parseDriveGid, parseDriveRef } from './drive.js';

const ID = '1fwz1A_FAjkubE4JfX9lwMomEjbWDNDBP57FbzVbDX94';

describe('parseDriveRef', () => {
  it('extracts the id from spreadsheet/doc/presentation/file URLs', () => {
    expect(parseDriveRef(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`)).toBe(ID);
    expect(parseDriveRef(`https://docs.google.com/document/d/${ID}/edit`)).toBe(ID);
    expect(parseDriveRef(`https://docs.google.com/presentation/d/${ID}/edit`)).toBe(ID);
    expect(parseDriveRef(`https://drive.google.com/file/d/${ID}/view`)).toBe(ID);
  });

  it('handles account-scoped /u/N/ links (multi-account browser URLs)', () => {
    expect(parseDriveRef(`https://docs.google.com/spreadsheets/u/0/d/${ID}/edit`)).toBe(ID);
    expect(parseDriveRef(`https://docs.google.com/document/u/1/d/${ID}/edit`)).toBe(ID);
  });

  it('extracts folder ids and ?id= forms', () => {
    expect(parseDriveRef(`https://drive.google.com/drive/folders/${ID}`)).toBe(ID);
    expect(parseDriveRef(`https://drive.google.com/open?id=${ID}`)).toBe(ID);
  });

  it('accepts a bare id', () => {
    expect(parseDriveRef(ID)).toBe(ID);
    expect(parseDriveRef(`  ${ID}  `)).toBe(ID);
  });

  it('rejects junk and non-Drive input (no injection of arbitrary strings)', () => {
    expect(parseDriveRef('')).toBeNull();
    expect(parseDriveRef('   ')).toBeNull();
    expect(parseDriveRef('hello world')).toBeNull();
    expect(parseDriveRef('https://example.com/not-a-drive-link')).toBeNull();
    expect(parseDriveRef('short')).toBeNull(); // below the bare-id length floor
  });
});

describe('parseDriveGid', () => {
  it('extracts gid from #gid= and query forms', () => {
    expect(parseDriveGid(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=1937180792`)).toBe('1937180792');
    expect(parseDriveGid(`https://docs.google.com/spreadsheets/d/${ID}/edit?gid=42#gid=42`)).toBe('42');
  });
  it('returns null when no gid is present', () => {
    expect(parseDriveGid(`https://docs.google.com/spreadsheets/d/${ID}/edit`)).toBeNull();
    expect(parseDriveGid(ID)).toBeNull();
  });
});

describe('isXlsxMime', () => {
  it('recognizes uploaded Excel types, not Google Sheets', () => {
    expect(isXlsxMime('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(true);
    expect(isXlsxMime('application/vnd.ms-excel')).toBe(true);
    expect(isXlsxMime('application/vnd.google-apps.spreadsheet')).toBe(false);
    expect(isXlsxMime(null)).toBe(false);
    expect(isXlsxMime(undefined)).toBe(false);
  });
});
