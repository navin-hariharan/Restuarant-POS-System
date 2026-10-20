import { useQueryClient } from '@tanstack/react-query';
import { DoorClosed, KeyRound, Printer, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button, Modal, Spinner, useConfirm } from '@/components/ui';
import { QrCode } from '@/components/catalog/QrCode';
import { useConfig, useT } from '@/providers/AppProviders';
import { posKeys } from './queries';

type Seat = { pin: string | null; started_at: string | null; is_open: boolean };
export type SeatingTable = { id: number; title: string };

/** Lists that show whether a table is open. */
const LISTS = [posKeys.tables, ['admin/service-tables'], ['digital-menu/tables']];

/** Digital menu link for a table, without the cache-busting stamp. */
function menuLink(base: string, id: number) {
  try {
    return new URL(`dm?t=${id}`, base.endsWith('/') ? base : `${base}/`).toString();
  } catch {
    return `${window.location.origin}/dm?t=${id}`;
  }
}

/**
 * Open a table for digital-menu ordering and show its PIN in large type, so a
 * server can read it out or print it on a slip. Opening an open table shows
 * the PIN it already has.
 */
export function SeatingDialog({ table, onClose }: { table: SeatingTable | null; onClose: () => void }) {
  const t = useT();
  const { config } = useConfig();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const qrRef = useRef<HTMLDivElement>(null);
  const [seat, setSeat] = useState<Seat | null>(null);
  const [busy, setBusy] = useState<'open' | 'regenerate' | 'close' | null>(null);

  const refresh = () => LISTS.forEach((queryKey) => qc.invalidateQueries({ queryKey }));

  useEffect(() => {
    if (!table) return;
    let live = true;
    setSeat(null);
    setBusy('open');
    api
      .post<Seat>(`pos/tables/${table.id}/seat`)
      .then((r) => {
        if (!live) return;
        setSeat(r.data);
        refresh();
      })
      .catch(() => live && onClose())
      .finally(() => live && setBusy(null));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table?.id]);

  if (!table) return null;
  const link = menuLink(config.url, table.id);

  const regenerate = async () => {
    setBusy('regenerate');
    try {
      setSeat((await api.post<Seat>(`pos/tables/${table.id}/pin/regenerate`)).data);
      refresh();
      toast.success(t('New table code ready'));
    } finally {
      setBusy(null);
    }
  };

  const close = async () => {
    const ok = await confirm({
      title: t('Close table'),
      message: t('Guests at this table will no longer be able to order until it is opened again.'),
      confirmText: t('Close table'),
      danger: true,
    });
    if (!ok) return;
    setBusy('close');
    try {
      await api.post(`pos/tables/${table.id}/close`);
      refresh();
      toast.success(t('Table closed'));
      onClose();
    } finally {
      setBusy(null);
    }
  };

  const print = () => {
    if (!seat?.pin) return;
    const svg = qrRef.current?.querySelector('svg')?.outerHTML ?? '';
    const w = window.open('', '_blank', 'width=420,height=640');
    if (!w) return;
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(table.title)}</title>
<style>body{font-family:system-ui,sans-serif;text-align:center;margin:24px;color:#111}h1{font-size:24px;margin:0 0 4px}
p{margin:4px 0;color:#444}.pin{font:700 44px/1.1 ui-monospace,monospace;letter-spacing:.25em;margin:12px 0 4px;color:#111}
svg{width:48mm;height:48mm;margin:12px auto;display:block}</style>
</head><body><p>${esc(config.name ?? '')}</p><h1>${esc(table.title)}</h1><p>${esc(t('Table code'))}</p><div class="pin">${esc(seat.pin)}</div>${svg}<p>${esc(
      t('Scan the code, choose your food and enter the table code to order.'),
    )}</p></body></html>`);
    w.document.close();
    // Printed from here: the content security policy allows no inline script in the new window.
    w.focus();
    w.print();
    setTimeout(() => w.close(), 300);
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={`${t('Table code')} — ${table.title}`}
      footer={
        <>
          <Button variant="danger" icon={<DoorClosed className="h-4 w-4" />} onClick={close} loading={busy === 'close'} disabled={!seat || !!busy}>
            {t('Close table')}
          </Button>
          <Button icon={<RefreshCw className="h-4 w-4" />} onClick={regenerate} loading={busy === 'regenerate'} disabled={!seat || !!busy}>
            {t('Regenerate')}
          </Button>
          <Button variant="primary" icon={<Printer className="h-4 w-4" />} onClick={print} disabled={!seat?.pin || !!busy}>
            {t('Print slip')}
          </Button>
        </>
      }
    >
      {!seat ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 text-center">
          <KeyRound className="h-6 w-6 text-brand-600" aria-hidden="true" />
          <p className="text-sm text-slate-500">{t('Tell the guests this code. They need it to order from the digital menu.')}</p>
          <p className="my-2 select-all font-mono text-6xl font-bold tabular-nums tracking-[0.2em] text-slate-900 dark:text-white" aria-live="polite" data-testid="seating-pin">
            {seat.pin}
          </p>
          {seat.started_at && (
            <p className="text-xs text-slate-500">
              {t('Opened at')} {new Date(seat.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
          {/* Rendered for the printed slip only. */}
          <div ref={qrRef} className="hidden" aria-hidden="true">
            <QrCode value={link} size={160} title={`${t('Digital Menu')}: ${table.title}`} />
          </div>
        </div>
      )}
    </Modal>
  );
}
