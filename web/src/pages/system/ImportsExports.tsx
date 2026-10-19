import { useId, useRef, useState, type DragEvent } from 'react';
import { toast } from 'sonner';
import {
  BedDouble, BookOpen, CheckCircle2, CircleAlert, CreditCard, Download, FileDown, FileSpreadsheet, FileUp, Globe, LayoutGrid,
  ListChecks, MapPin, Salad, Layers, Tags, Upload, Users, UtensilsCrossed, Wallet, X, type LucideIcon,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import { api, downloadBlob } from '@/lib/api';
import { useConfig, useT } from '@/providers/AppProviders';
import { Badge, Button, Menu, MenuItem, Modal, PageHeader, SearchInput } from '@/components/ui';
import { fileStamp } from '@/components/reports/export';

type Resource = {
  key: string;
  label: string;
  icon: LucideIcon;
  /** CSV columns the importer reads (same as the export headings). */
  columns: string[];
  required: string[];
  notes?: string;
  rooms?: boolean;
};

/** Mirrors App\Services\ImportService / ExportService and the App\Imports rules. */
const RESOURCES: Resource[] = [
  { key: 'products', label: 'Food items', icon: UtensilsCrossed, columns: ['sku', 'name', 'price', 'cost', 'food_category_id', 'description', 'is_bar_type', 'tax_id', 'expiry_date'], required: ['name', 'price', 'cost'], notes: 'food_category_id and tax_id must be existing IDs; sku is generated when empty.' },
  { key: 'categories', label: 'Food categories', icon: LayoutGrid, columns: ['name'], required: ['name'] },
  { key: 'modifiers', label: 'Modifiers', icon: Layers, columns: ['title', 'price', 'cost', 'food_category_id'], required: ['title', 'price', 'cost', 'food_category_id'] },
  { key: 'ingredients', label: 'Ingredients', icon: Salad, columns: ['name', 'price', 'cost', 'unit', 'quantity', 'alert_quantity', 'description'], required: ['name', 'price', 'cost', 'quantity', 'alert_quantity'] },
  { key: 'customers', label: 'Customers', icon: Users, columns: ['name', 'phone', 'email', 'address'], required: ['name'] },
  { key: 'expenses', label: 'Expenses', icon: CreditCard, columns: ['title', 'amount', 'description', 'expense_type_id'], required: ['title', 'amount', 'expense_type_id'] },
  { key: 'expensetypes', label: 'Expense types', icon: Tags, columns: ['title'], required: ['title'] },
  { key: 'servicetables', label: 'Service tables', icon: BookOpen, columns: ['title'], required: ['title'] },
  { key: 'paymentmethods', label: 'Payment methods', icon: Wallet, columns: ['title'], required: ['title'] },
  { key: 'pickuppoints', label: 'Pickup points', icon: MapPin, columns: ['place_title', 'person_name', 'phone', 'address'], required: ['place_title'] },
  { key: 'guestrooms', label: 'Guest rooms', icon: BedDouble, columns: ['room_name', 'capactity', 'per_hour_charges'], required: ['room_name'], rooms: true },
  { key: 'bookingsources', label: 'Booking sources', icon: Globe, columns: ['title'], required: ['title'], rooms: true },
  { key: 'reservationstatuses', label: 'Reservation statuses', icon: ListChecks, columns: ['title'], required: ['title'], rooms: true },
];

const FORMATS = [
  { value: 'csv', label: 'CSV' },
  { value: 'xlsx', label: 'XLSX' },
  { value: 'xls', label: 'XLS' },
  { value: 'html', label: 'HTML' },
];

/** Read an error out of a blob response (exports use responseType: blob). */
async function blobError(err: unknown): Promise<string> {
  const data = (err as AxiosError<any>)?.response?.data;
  try {
    if (data instanceof Blob) {
      const json = JSON.parse(await data.text());
      return json?.message || '';
    }
  } catch {
    /* not JSON */
  }
  return (data as any)?.message || (err as Error)?.message || '';
}

function filenameFrom(header: string | undefined, fallback: string) {
  const m = header && /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  return m ? decodeURIComponent(m[1]) : fallback;
}

export default function ImportsExports() {
  const t = useT();
  const { config } = useConfig();
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [importing, setImporting] = useState<Resource | null>(null);
  const resources = RESOURCES.filter((r) => !r.rooms || config.modes.room_reservations_enabled).filter((r) =>
    `${t(r.label)} ${r.key}`.toLowerCase().includes(search.trim().toLowerCase()),
  );

  const exportResource = async (r: Resource, format: string) => {
    setBusy(`${r.key}:${format}`);
    try {
      const res = await api.post('admin/exports', { resource: r.key, format }, { responseType: 'blob', silent: true });
      const name = filenameFrom(res.headers['content-disposition'] as string | undefined, `${r.key}.${format}`);
      const stamped = name.replace(/(\.[a-z0-9]+)$/i, `_${fileStamp()}$1`);
      downloadBlob(res.data as Blob, stamped);
      toast.success(t('Exported :name', { name: t(r.label) }));
    } catch (e) {
      toast.error((await blobError(e)) || t('Something went wrong try again !'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader
        title={t('Imports and exports')}
        description={t('Download your data as CSV, Excel or HTML, or bulk-import records from a CSV file.')}
        actions={<SearchInput className="w-full sm:w-64" value={search} onChange={setSearch} placeholder={t('Search')} />}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {resources.map((r) => (
          <article key={r.key} className="card flex flex-col p-4">
            <div className="flex items-start gap-3">
              <span className="rounded-lg bg-brand-50 p-2.5 text-brand-700 dark:bg-brand-950 dark:text-brand-300">
                <r.icon className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold">{t(r.label)}</h2>
                <p className="mt-0.5 truncate font-mono text-xs text-slate-500" title={r.columns.join(', ')}>
                  {r.columns.join(', ')}
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Menu
                align="start"
                trigger={({ toggle, open }) => (
                  <Button
                    size="sm"
                    onClick={toggle}
                    aria-haspopup="menu"
                    aria-expanded={open}
                    loading={busy?.startsWith(`${r.key}:`)}
                    icon={<FileDown className="h-4 w-4" />}
                  >
                    {t('Export')}
                  </Button>
                )}
              >
                {(close) =>
                  FORMATS.map((f) => (
                    <MenuItem
                      key={f.value}
                      icon={<FileSpreadsheet className="h-4 w-4" />}
                      onClick={() => {
                        close();
                        exportResource(r, f.value);
                      }}
                    >
                      {t(f.label)}
                    </MenuItem>
                  ))
                }
              </Menu>
              <Button size="sm" variant="primary" onClick={() => setImporting(r)} icon={<FileUp className="h-4 w-4" />}>
                {t('Import')}
              </Button>
            </div>
          </article>
        ))}
      </div>
      {!resources.length && <p className="py-12 text-center text-sm text-slate-500">{t('No data found')}</p>}
      <ImportModal resource={importing} onClose={() => setImporting(null)} onExport={(r) => exportResource(r, 'csv')} />
    </div>
  );
}

type Result = { ok: boolean; message: string; errors: string[] };

function ImportModal({ resource, onClose, onExport }: { resource: Resource | null; onClose: () => void; onExport: (r: Resource) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const close = () => {
    setFile(null);
    setResult(null);
    onClose();
  };
  const pick = (f: File | undefined | null) => {
    setResult(null);
    if (!f) return;
    if (!/\.(csv|txt)$/i.test(f.name)) {
      toast.error(t('Please choose a .csv file'));
      return;
    }
    setFile(f);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    pick(e.dataTransfer.files?.[0]);
  };
  const template = () => {
    if (!resource) return;
    const blob = new Blob(['﻿' + resource.columns.join(',') + '\r\n'], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, `${resource.key}_template.csv`);
  };
  const submit = async () => {
    if (!resource || !file) return;
    setLoading(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('resource', resource.key);
      fd.append('file', file);
      const res = await api.post<{ message: string }>('admin/imports', fd, { silent: true });
      setResult({ ok: true, message: res.data?.message || t('Data imported successfully'), errors: [] });
      setFile(null);
      if (input.current) input.current.value = '';
      qc.invalidateQueries();
      toast.success(res.data?.message || t('Data imported successfully'));
    } catch (e) {
      const data = (e as AxiosError<any>)?.response?.data;
      const raw = data?.errors;
      const errors: string[] = Array.isArray(raw)
        ? raw.flat().map(String)
        : raw && typeof raw === 'object'
          ? Object.values(raw).flat().map(String)
          : [];
      setResult({ ok: false, message: data?.message || (e as Error).message || t('Something went wrong try again !'), errors });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={!!resource}
      onClose={close}
      size="lg"
      title={resource ? `${t('Import')} — ${t(resource.label)}` : ''}
      description={t('Upload a CSV file whose first row contains the column names below.')}
      footer={
        <>
          <Button onClick={close}>{t('Close')}</Button>
          <Button variant="primary" onClick={submit} disabled={!file} loading={loading} icon={<Upload className="h-4 w-4" />}>
            {t('Import')}
          </Button>
        </>
      }
    >
      {resource && (
        <div className="space-y-4">
          <div>
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">{t('Columns')}</p>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={template} icon={<Download className="h-4 w-4" />}>
                  {t('Download template')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onExport(resource)} icon={<FileDown className="h-4 w-4" />}>
                  {t('Export current data')}
                </Button>
              </div>
            </div>
            <ul className="flex flex-wrap gap-1.5">
              {resource.columns.map((c) => (
                <li key={c}>
                  <Badge tone={resource.required.includes(c) ? 'blue' : 'gray'} className="font-mono">
                    {c}
                    {resource.required.includes(c) && <span aria-label={t('required')}>*</span>}
                  </Badge>
                </li>
              ))}
            </ul>
            <p className="help">
              * {t('required')}. {t('Rows that fail validation stop the import; fix them and upload again.')}
              {resource.notes ? ` ${t(resource.notes)}` : ''}
            </p>
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
            className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition ${
              drag ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/40' : 'border-slate-300 dark:border-slate-700'
            }`}
          >
            <FileUp className="h-8 w-8 text-slate-400" aria-hidden />
            {file ? (
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium">{file.name}</span>
                <span className="text-slate-500">({(file.size / 1024).toFixed(1)} KB)</span>
                <button
                  type="button"
                  className="btn-ghost p-1!"
                  aria-label={t('Remove')}
                  onClick={() => {
                    setFile(null);
                    if (input.current) input.current.value = '';
                  }}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <p className="text-sm text-slate-500">{t('Drag and drop a CSV file here, or')}</p>
            )}
            <label htmlFor={id} className="btn-secondary btn-sm cursor-pointer">
              {t('Choose file')}
            </label>
            <input id={id} ref={input} type="file" accept=".csv,text/csv,.txt" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
          </div>

          {result && (
            <div
              role="status"
              className={`rounded-lg border p-3 text-sm ${
                result.ok
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'
                  : 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200'
              }`}
            >
              <p className="flex items-center gap-2 font-medium">
                {result.ok ? <CheckCircle2 className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}
                {result.ok ? result.message : t('Import failed')}
              </p>
              {!result.ok && (
                <ul className="mt-2 max-h-48 list-disc space-y-0.5 overflow-y-auto ps-5 text-xs">
                  {(result.errors.length ? result.errors : [result.message]).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
