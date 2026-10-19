import clsx from 'clsx';
import { useId, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Archive,
  CheckCircle2,
  Clock,
  Database,
  DatabaseBackup,
  Download,
  FileUp,
  HardDrive,
  History,
  Info,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import { api, downloadBlob, errorMessage } from '@/lib/api';
import { setAuthNotice } from '@/lib/authNotice';
import { useAuth, useT } from '@/providers/AppProviders';
import { Badge, Button, EmptyState, Modal, PageHeader, Skeleton, useConfirm, type Tone } from '@/components/ui';

import { formatBytes, kindOf, restoreConfirmed, sizeToBytes, uploadKind, type Backup, type BackupKind, type UploadResult } from './backups';

const kindTone: Record<BackupKind, Tone> = { manual: 'blue', uploaded: 'purple', 'pre-restore': 'amber' };

function KindBadge({ kind }: { kind: BackupKind }) {
  const t = useT();
  const label = kind === 'manual' ? t('Manual') : kind === 'uploaded' ? t('Uploaded') : t('Safety copy');
  return <Badge tone={kindTone[kind]}>{label}</Badge>;
}

export default function Backups() {
  const t = useT();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can } = useAuth();
  const allowed = can('database_backup');
  const [restoring, setRestoring] = useState<Backup | null>(null);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState<Record<string, number>>({});
  // Backups stored by the last upload, highlighted in the list.
  const [fresh, setFresh] = useState<string[]>([]);

  const q = useQuery({
    queryKey: ['backups'],
    queryFn: async () => (await api.get<{ list: Backup[] }>('admin/backups')).data.list ?? [],
  });
  const rows = q.data ?? [];
  const totalBytes = rows.reduce((s, b) => s + sizeToBytes(b.size), 0);

  const create = useMutation({
    mutationFn: async () => (await api.post<{ message: string }>('admin/backups', null, { silent: true })).data,
    onSuccess: (d) => {
      toast.success(d?.message || t('Backup created successfully'));
      qc.invalidateQueries({ queryKey: ['backups'] });
    },
    // Includes the server's limit message when too many manual backups exist.
    onError: (e) => toast.error(errorMessage(e) || t('Something went wrong try again !'), { duration: 8000 }),
  });

  const remove = useMutation({
    mutationFn: async (b: Backup) => (await api.post<{ message: string }>(`admin/backups/${encodeURIComponent(b.name)}/remove`)).data,
    onSuccess: (d) => {
      toast.success(d?.message || t('Backup removed successfully'));
      qc.invalidateQueries({ queryKey: ['backups'] });
    },
  });

  const download = async (b: Backup) => {
    setDownloading((s) => ({ ...s, [b.name]: 0 }));
    try {
      const res = await api.get<Blob>(`admin/backups/${encodeURIComponent(b.name)}/download`, {
        responseType: 'blob',
        onDownloadProgress: (e) => {
          if (e.total) setDownloading((s) => ({ ...s, [b.name]: Math.round((e.loaded / e.total!) * 100) }));
        },
      });
      downloadBlob(res.data, b.name);
    } catch {
      /* the API layer already showed the error */
    } finally {
      setDownloading(({ [b.name]: _, ...rest }) => rest);
    }
  };

  const askDelete = async (b: Backup) => {
    const ok = await confirm({
      title: t('Delete backup'),
      message: (
        <>
          {t('Are you sure you want to delete backup file from storage ?')}
          <span className="mt-2 block break-all font-mono text-xs">{b.name}</span>
        </>
      ),
      confirmText: t('Delete'),
    });
    if (ok) remove.mutate(b);
  };

  const actions = (b: Backup) => {
    const dl = downloading[b.name];
    return (
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          size="sm"
          onClick={() => download(b)}
          loading={dl !== undefined}
          icon={<Download className="h-4 w-4" />}
          aria-label={`${t('Download')} ${b.name}`}
        >
          {dl !== undefined && dl > 0 ? `${dl}%` : t('Download')}
        </Button>
        {allowed && (
          <Button size="sm" onClick={() => setRestoring(b)} icon={<History className="h-4 w-4" />} aria-label={`${t('Restore')} ${b.name}`}>
            {t('Restore')}
          </Button>
        )}
        {allowed && (
          <Button
            size="sm"
            variant="ghost"
            aria-label={`${t('Delete')} ${b.name}`}
            title={t('Delete')}
            className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
            loading={remove.isPending && remove.variables?.name === b.name}
            icon={<Trash2 className="h-4 w-4" />}
            onClick={() => askDelete(b)}
          />
        )}
      </div>
    );
  };

  return (
    <div>
      <PageHeader
        title={t('Database backups')}
        description={t('Create, upload, download and restore copies of the database.')}
        actions={
          <>
            <Button variant="ghost" size="icon" onClick={() => q.refetch()} aria-label={t('Refresh')} title={t('Refresh')} className="btn-icon">
              <RefreshCw className={clsx('h-4 w-4', q.isFetching && 'animate-spin')} />
            </Button>
            {allowed && (
              <Button onClick={() => setUploading(true)} icon={<Upload className="h-4 w-4" />}>
                {t('Upload backup')}
              </Button>
            )}
            {allowed && (
              <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()} icon={<DatabaseBackup className="h-4 w-4" />}>
                {t('Create backup')}
              </Button>
            )}
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <InfoTile icon={<Database className="h-4 w-4" />} label={t('Backups')} value={q.isLoading ? '—' : String(rows.length)} />
        <InfoTile icon={<HardDrive className="h-4 w-4" />} label={t('Storage used')} value={q.isLoading ? '—' : formatBytes(totalBytes)} />
        <InfoTile icon={<Clock className="h-4 w-4" />} label={t('Latest backup')} value={rows[0]?.time ?? '—'} />
      </div>

      <HowItWorks />

      {/* Narrow screens: one card per backup */}
      <ul className="space-y-3 md:hidden" aria-label={t('Backups')}>
        {q.isLoading
          ? Array.from({ length: 3 }).map((_, i) => (
              <li key={i} className="card p-4">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="mt-2 h-3 w-1/2" />
              </li>
            ))
          : rows.map((b) => (
              <li key={b.name} className={clsx('card p-4', fresh.includes(b.name) && 'ring-2 ring-brand-500')}>
                <div className="flex items-start gap-3">
                  <span className="rounded-lg bg-slate-100 p-2 text-slate-500 dark:bg-slate-800" aria-hidden>
                    <Database className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="break-all font-mono text-sm font-medium">{b.name}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      <KindBadge kind={kindOf(b)} />
                      {fresh.includes(b.name) && <Badge tone="green">{t('New')}</Badge>}
                      <span className="tabular-nums">{b.size}</span>
                      <span>{b.time}</span>
                    </div>
                  </div>
                </div>
                <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">{actions(b)}</div>
              </li>
            ))}
      </ul>

      {/* Wider screens: a table */}
      <div className="card hidden overflow-hidden md:block">
        <div className="relative overflow-x-auto">
          <table className="table-base">
            <thead className="bg-slate-50 dark:bg-slate-900/60">
              <tr>
                <th>{t('Backup')}</th>
                <th>{t('Type')}</th>
                <th className="text-end">{t('Size')}</th>
                <th>{t('Created')}</th>
                <th>
                  <span className="sr-only">{t('Actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {q.isLoading
                ? Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 5 }).map((__, j) => (
                        <td key={j}>
                          <Skeleton className="h-4 w-full max-w-40" />
                        </td>
                      ))}
                    </tr>
                  ))
                : rows.map((b) => (
                    <tr key={b.name} className={clsx(fresh.includes(b.name) && 'bg-brand-50 dark:bg-brand-950/40')}>
                      <td className="max-w-md">
                        <div className="flex items-center gap-3">
                          <span className="rounded-lg bg-slate-100 p-2 text-slate-500 dark:bg-slate-800" aria-hidden>
                            <Database className="h-4 w-4" />
                          </span>
                          <span className="break-all font-mono text-sm font-medium">{b.name}</span>
                        </div>
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1.5">
                          <KindBadge kind={kindOf(b)} />
                          {fresh.includes(b.name) && <Badge tone="green">{t('New')}</Badge>}
                        </div>
                      </td>
                      <td className="whitespace-nowrap text-end tabular-nums">{b.size}</td>
                      <td className="whitespace-nowrap text-slate-500">{b.time}</td>
                      <td>{actions(b)}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>

      {!q.isLoading && !rows.length && (
        <div className="card mt-3">
          <EmptyState
            icon={<DatabaseBackup className="h-6 w-6" />}
            title={t('No backups yet')}
            description={t('Create your first backup, or upload one from your previous server.')}
          />
        </div>
      )}

      <UploadModal
        open={uploading}
        onClose={() => setUploading(false)}
        onUploaded={(names) => {
          setFresh(names);
          qc.invalidateQueries({ queryKey: ['backups'] });
        }}
        onRestore={(name) => {
          setUploading(false);
          setRestoring(rows.find((r) => r.name === name) ?? { name, size: '', time: '', kind: 'uploaded' });
        }}
      />
      <RestoreModal backup={restoring} onClose={() => setRestoring(null)} />
    </div>
  );
}

function InfoTile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="card flex items-center gap-3 p-4">
      <span className="rounded-lg bg-brand-50 p-2 text-brand-700 dark:bg-brand-950 dark:text-brand-300">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
        <p className="font-semibold tabular-nums wrap-anywhere">{value}</p>
      </div>
    </div>
  );
}

function HowItWorks() {
  const t = useT();
  const items: { icon: ReactNode; text: string }[] = [
    {
      icon: <KindBadge kind="manual" />,
      text: t('Created here with Create backup. The server keeps a limited number of them: delete old ones to make room.'),
    },
    {
      icon: <KindBadge kind="uploaded" />,
      text: t('A .sql or .sql.gz database dump you uploaded, for example from your previous server. It is only stored until you restore it.'),
    },
    {
      icon: <KindBadge kind="pre-restore" />,
      text: t('Taken automatically just before every restore. Restore it to undo a restore.'),
    },
    {
      icon: <Badge tone="gray">.zip</Badge>,
      text: t('A files archive from the old server: images go to the uploads folder, translation files (lang/*.json) to Languages, and any .sql or .sql.gz inside is stored as an uploaded backup.'),
    },
  ];
  return (
    <section className="card mb-5 p-4" aria-labelledby="backups-how">
      <h2 id="backups-how" className="flex items-center gap-2 text-sm font-semibold">
        <Info className="h-4 w-4 text-brand-600" aria-hidden />
        {t('How backups work')}
      </h2>
      <div className="mt-2 flex items-start gap-2 rounded-lg bg-brand-50 p-3 text-sm text-brand-900 dark:bg-brand-950/60 dark:text-brand-100">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>
          {t('Nothing is ever imported automatically. To bring data over from an old server, upload its backup here and then restore it.')}
        </p>
      </div>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 2xl:grid-cols-4">
        {items.map((it, i) => (
          <div key={i} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <dt>{it.icon}</dt>
            <dd className="mt-1.5 text-slate-600 dark:text-slate-400">{it.text}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* ------------------------------------------------------------------ upload */

function UploadModal({
  open,
  onClose,
  onUploaded,
  onRestore,
}: {
  open: boolean;
  onClose: () => void;
  onUploaded: (names: string[]) => void;
  onRestore: (name: string) => void;
}) {
  const t = useT();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const kind = file ? uploadKind(file.name) : null;
  const busy = !!progress;

  const reset = () => {
    setFile(null);
    setProgress(null);
    setProcessing(false);
    setResult(null);
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  };
  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };
  const pick = (f: File | null | undefined) => {
    setResult(null);
    setError('');
    if (!f) return setFile(null);
    if (!uploadKind(f.name)) {
      setFile(null);
      setError(t('Choose a .sql, .sql.gz or .zip file.'));
      return;
    }
    setFile(f);
  };

  const send = async () => {
    if (!file || !kind) return;
    const fd = new FormData();
    fd.append('file', file);
    abort.current = new AbortController();
    setError('');
    setProgress({ loaded: 0, total: file.size });
    try {
      const res = await api.post<UploadResult>('admin/backups/upload', fd, {
        silent: true,
        signal: abort.current.signal,
        onUploadProgress: (e) => {
          setProgress({ loaded: e.loaded, total: e.total ?? file.size });
          if (e.total && e.loaded >= e.total) setProcessing(true);
        },
      });
      const data = res.data;
      // Anything but the server's answer (e.g. a page from a proxy) is not a confirmation.
      if (!data || typeof data !== 'object' || !Array.isArray(data.backups)) {
        setError(t('The server did not confirm the upload. Try again.'));
        return;
      }
      setResult(data);
      if (data.backups.length) toast.success(data.message || t('Backup uploaded successfully'));
      onUploaded(data.backups);
    } catch (e: any) {
      if (e?.code === 'ERR_CANCELED') setError(t('Upload cancelled.'));
      else setError(errorMessage(e) || t('Something went wrong try again !'));
    } finally {
      abort.current = null;
      setProgress(null);
      setProcessing(false);
    }
  };

  const pct = progress && progress.total ? Math.min(100, Math.round((progress.loaded / progress.total) * 100)) : 0;

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title={t('Upload backup')}
      description={t('Upload a database dump or a files archive from your previous server.')}
      footer={
        result ? (
          <>
            <Button onClick={reset}>{t('Upload another')}</Button>
            <Button variant="primary" onClick={close}>
              {t('Done')}
            </Button>
          </>
        ) : (
          <>
            {busy ? (
              <Button onClick={() => abort.current?.abort()} disabled={processing}>
                {t('Cancel upload')}
              </Button>
            ) : (
              <Button onClick={close}>{t('Cancel')}</Button>
            )}
            <Button variant="primary" disabled={!file || !kind} loading={busy} onClick={send} icon={<Upload className="h-4 w-4" />}>
              {t('Upload')}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3" role="status">
          <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <p className="font-medium">{result.message || t('Backup uploaded successfully')}</p>
          </div>
          {!result.backups?.length && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
              <p>
                {t('This archive had no database backup (.sql or .sql.gz), so there is nothing new to restore. Upload the database dump itself to restore it.')}
                {!!result.skipped && ` ${t(':count files in the archive were not used.', { count: result.skipped })}`}
              </p>
            </div>
          )}
          <dl className="grid gap-2 text-sm sm:grid-cols-3">
            <ResultItem label={t('Database backups stored')} value={String(result.backups?.length ?? 0)} />
            <ResultItem label={t('Images copied')} value={String(result.images ?? 0)} />
            <ResultItem label={t('Languages added')} value={String(result.languages ?? 0)} />
          </dl>
          {!!result.backups?.length && (
            <ul className="space-y-1 text-sm">
              {result.backups.map((n) => (
                <li key={n} className="flex flex-wrap items-center justify-between gap-2 rounded-sm bg-slate-100 px-2 py-1 dark:bg-slate-800">
                  <span className="min-w-0 break-all font-mono text-xs">{n}</span>
                  <Button size="sm" variant="primary" onClick={() => onRestore(n)} icon={<History className="h-4 w-4" />} aria-label={`${t('Restore now')} ${n}`}>
                    {t('Restore now')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {!!result.backups?.length && (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {t('Uploaded database backups are not applied yet. Press Restore now, or use Restore in the list when you are ready.')}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <label
            htmlFor={inputId}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (!busy) pick(e.dataTransfer.files?.[0]);
            }}
            className={clsx(
              'flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition',
              dragging ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/40' : 'border-slate-300 hover:border-brand-400 dark:border-slate-700',
              busy && 'pointer-events-none opacity-60',
            )}
          >
            <FileUp className="h-8 w-8 text-brand-600" aria-hidden />
            <span className="text-sm font-medium">{file ? file.name : t('Choose a file or drop it here')}</span>
            <span className="text-xs text-slate-500">{file ? formatBytes(file.size) : '.sql · .sql.gz · .zip'}</span>
            <input
              ref={inputRef}
              id={inputId}
              type="file"
              className="sr-only"
              accept=".sql,.gz,.zip,application/sql,application/gzip,application/zip"
              disabled={busy}
              onChange={(e) => pick(e.target.files?.[0])}
            />
          </label>

          {error && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          )}

          {file && kind && (
            <div className="flex items-start gap-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
              {kind === 'sql' ? <Database className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <Archive className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
              <p>
                {kind === 'sql'
                  ? t('Database dump: it will be stored as an uploaded backup and listed here. Your current data does not change until you restore it.')
                  : t('Files archive: images are copied to the uploads folder, lang/*.json translations to Languages, and any .sql or .sql.gz inside is stored as an uploaded backup (not restored).')}
              </p>
            </div>
          )}

          {progress && (
            <div>
              <div className="mb-1 flex justify-between gap-2 text-xs text-slate-600 dark:text-slate-400">
                <span>{processing ? t('Processing on the server…') : t('Uploading…')}</span>
                <span className="tabular-nums">
                  {formatBytes(progress.loaded)} / {formatBytes(progress.total)} · {pct}%
                </span>
              </div>
              <div
                className="h-2.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
                aria-label={t('Upload progress')}
              >
                <div className={clsx('h-full rounded-full bg-brand-600 transition-[width]', processing && 'animate-pulse')} style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function ResultItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/* ----------------------------------------------------------------- restore */

/** Restoring overwrites the whole database, so it needs the file name (or RESTORE) typed out. */
function RestoreModal({ backup, onClose }: { backup: Backup | null; onClose: () => void }) {
  const t = useT();
  const id = useId();
  const nav = useNavigate();
  const { logout } = useAuth();
  const [typed, setTyped] = useState('');
  const restore = useMutation({
    mutationFn: async (b: Backup) =>
      (await api.patch<{ message: string; safety_backup?: string }>(`admin/backups/${encodeURIComponent(b.name)}/restore`, null, { silent: true }))
        .data,
    onSuccess: async (d) => {
      // The restored database has its own accounts and sign-in tokens: start over at the sign-in page.
      setAuthNotice({ kind: 'restored', message: d?.message, safety: d?.safety_backup });
      await logout();
      nav('/auth/login', { replace: true });
    },
  });
  const close = () => {
    if (restore.isPending) return;
    setTyped('');
    restore.reset();
    onClose();
  };
  const ok = !!backup && restoreConfirmed(typed, backup.name);

  return (
    <Modal
      open={!!backup}
      onClose={close}
      size="md"
      title={t('Restore database')}
      footer={
        <>
          <Button onClick={close} disabled={restore.isPending}>
            {t('Cancel')}
          </Button>
          <Button variant="danger" disabled={!ok} loading={restore.isPending} onClick={() => backup && restore.mutate(backup)} icon={<History className="h-4 w-4" />}>
            {t('Restore')}
          </Button>
        </>
      }
    >
      {backup && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (ok && !restore.isPending) restore.mutate(backup);
          }}
        >
          <div className="flex gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden />
            <div className="space-y-1.5">
              <p className="font-semibold">{t('This replaces all current data with the content of this backup.')}</p>
              <p>{t('Orders, users and settings created after the backup will be gone. A safety copy of the current data is taken first, so you can go back by restoring it.')}</p>
              <p>{t('You will be signed out afterwards. Sign in with an account that exists in the restored backup.')}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">{t('Backup')}:</span>
            <span className="select-all break-all rounded-sm bg-slate-100 px-2 py-1 font-mono text-xs dark:bg-slate-800">{backup.name}</span>
            <KindBadge kind={kindOf(backup)} />
          </div>
          <div>
            <label htmlFor={id} className="label">
              {t('Type the backup file name or RESTORE to confirm')}
            </label>
            <input
              id={id}
              className="input font-mono"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={typed}
              disabled={restore.isPending}
              onChange={(e) => setTyped(e.target.value)}
              aria-invalid={typed.length > 0 && !ok ? true : undefined}
            />
          </div>
          {restore.isPending && (
            <div role="status" className="space-y-1.5">
              <p className="text-sm text-slate-600 dark:text-slate-400">{t('Restoring… this can take a few minutes. Keep this page open.')}</p>
              <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                <div className="h-full w-1/3 animate-pulse rounded-full bg-red-500" />
              </div>
            </div>
          )}
          {restore.isError && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {errorMessage(restore.error) || t('Something went wrong try again !')}
            </p>
          )}
        </form>
      )}
    </Modal>
  );
}
