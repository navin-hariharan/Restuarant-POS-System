import { describe, expect, it } from 'vitest';
import { formatBytes, kindOf, restoreConfirmed, sizeToBytes, uploadKind } from './backups';

describe('backups helpers', () => {
  it('reads the kind, falling back to the automatic flag', () => {
    expect(kindOf({ name: 'a.sql', size: '1MB', time: '', kind: 'uploaded' })).toBe('uploaded');
    expect(kindOf({ name: 'a.sql', size: '1MB', time: '', automatic: true })).toBe('pre-restore');
    expect(kindOf({ name: 'a.sql', size: '1MB', time: '' })).toBe('manual');
  });

  it('parses sizes', () => {
    expect(sizeToBytes('1.25MB')).toBe(1.25 * 1024 * 1024);
    expect(sizeToBytes('512 KB')).toBe(512 * 1024);
    expect(sizeToBytes('2GB')).toBe(2 * 1024 ** 3);
    expect(sizeToBytes('oops')).toBe(0);
    expect(formatBytes(1536)).toBe('1.50 KB');
    expect(formatBytes(200 * 1024 * 1024)).toBe('200 MB');
  });

  it('accepts only .sql, .sql.gz and .zip uploads', () => {
    expect(uploadKind('dump.SQL')).toBe('sql');
    expect(uploadKind('dump.sql.gz')).toBe('sql');
    expect(uploadKind('old-server-files.zip')).toBe('zip');
    expect(uploadKind('photo.gz')).toBeNull();
    expect(uploadKind('notes.txt')).toBeNull();
  });

  it('needs the exact file name or RESTORE', () => {
    expect(restoreConfirmed('backup-1.sql', 'backup-1.sql')).toBe(true);
    expect(restoreConfirmed(' RESTORE ', 'backup-1.sql')).toBe(true);
    expect(restoreConfirmed('restore', 'backup-1.sql')).toBe(false);
    expect(restoreConfirmed('backup-1', 'backup-1.sql')).toBe(false);
  });
});
