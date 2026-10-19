/** Pure helpers for the Database backups screen. */

export type BackupKind = 'manual' | 'uploaded' | 'pre-restore';
export type Backup = { uuid?: string; name: string; size: string; time: string; automatic?: boolean; kind?: BackupKind };
export type UploadResult = { message?: string; backups?: string[]; images?: number; languages?: number; skipped?: number };

/** Older servers did not send `kind`: automatic copies were the pre-restore ones. */
export function kindOf(b: Backup): BackupKind {
  if (b.kind === 'manual' || b.kind === 'uploaded' || b.kind === 'pre-restore') return b.kind;
  return b.automatic ? 'pre-restore' : 'manual';
}

/** "1.25MB" / "512 KB" / "2GB" -> bytes (0 when unreadable). */
export function sizeToBytes(size: string): number {
  const m = /^\s*([\d.]+)\s*([KMGT]?B)?\s*$/i.exec(size ?? '');
  if (!m) return 0;
  const units: Record<string, number> = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
  return parseFloat(m[1]) * (units[(m[2] ?? 'B').toUpperCase()] ?? 1);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

/** What an upload will be treated as, from its file name (null = not accepted). */
export function uploadKind(name: string): 'sql' | 'zip' | null {
  const n = name.toLowerCase();
  if (n.endsWith('.sql') || n.endsWith('.sql.gz')) return 'sql';
  if (n.endsWith('.zip')) return 'zip';
  return null;
}

/** Restoring needs the exact file name or the word RESTORE. */
export function restoreConfirmed(typed: string, name: string): boolean {
  const v = typed.trim();
  return v === name || v === 'RESTORE';
}

