import { Copy, ExternalLink, KeyRound, Printer, QrCode as QrIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { CrudPage } from '@/components/crud/CrudPage';
import { useAuth, useConfig, useT } from '@/providers/AppProviders';
import { Badge, Button, Modal } from '@/components/ui';
import { QrCode } from '@/components/catalog/QrCode';
import { SeatingDialog } from '@/components/pos/SeatingDialog';

type TableRow = { id: number; title: string; digital_menu: string; is_open?: boolean; created_at: string; updated_at: string };

/** The resource appends `&stamp=<now>`; drop it so printed codes stay stable. */
const menuLink = (url: string) => {
  try {
    const u = new URL(url, window.location.origin);
    u.searchParams.delete('stamp');
    return u.toString();
  } catch {
    return url;
  }
};

async function copy(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(done);
  } catch {
    window.prompt('', text);
  }
}

function QrModal({ table, onClose }: { table: TableRow | null; onClose: () => void }) {
  const t = useT();
  const { config } = useConfig();
  const ref = useRef<HTMLDivElement>(null);
  if (!table) return null;
  const link = menuLink(table.digital_menu);

  const print = () => {
    const svg = ref.current?.querySelector('svg')?.outerHTML ?? '';
    const w = window.open('', '_blank', 'width=480,height=640');
    if (!w) return;
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(table.title)}</title>
<style>body{font-family:system-ui,sans-serif;text-align:center;margin:32px;color:#111}h1{font-size:28px;margin:0 0 4px}
p{margin:4px 0;color:#444}svg{width:72mm;height:72mm;margin:16px auto;display:block}small{word-break:break-all;color:#666}</style>
</head><body><p>${esc(config.name ?? '')}</p><h1>${esc(table.title)}</h1>${svg}<p>${esc(t('Scan to view the menu and order'))}</p><small>${esc(link)}</small></body></html>`);
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
      title={`${t('Table QR code for digital menu')} — ${table.title}`}
      footer={
        <>
          <Button icon={<Copy className="h-4 w-4" />} onClick={() => copy(link, t('Link copied'))}>
            {t('Copy link')}
          </Button>
          <Button variant="primary" icon={<Printer className="h-4 w-4" />} onClick={print}>
            {t('Print')}
          </Button>
        </>
      }
    >
      <div ref={ref} className="flex flex-col items-center gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-700">
          <QrCode value={link} size={240} title={`${t('Digital Menu')}: ${table.title}`} />
        </div>
        <a href={link} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 break-all text-center text-sm text-brand-600 hover:underline">
          {link} <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        </a>
      </div>
    </Modal>
  );
}

export default function ServiceTables() {
  const t = useT();
  const { config } = useConfig();
  const { can } = useAuth();
  const allowed = can('manage_service_tables');
  const [qr, setQr] = useState<TableRow | null>(null);
  const [seating, setSeating] = useState<TableRow | null>(null);
  const dm = config.modes.digital_menu;
  const pins = dm && !!config.modes.digital_menu_pin;

  return (
    <>
      <CrudPage<TableRow>
        title="Service tables"
        singular="Service table"
        description={dm ? 'Dining tables. Each table has its own QR code that opens the digital menu.' : 'Dining tables used for dine-in orders.'}
        url="admin/service-tables"
        permission="manage_service_tables"
        canCreate={allowed}
        canEdit={allowed}
        canDelete={allowed}
        drawerWidth="max-w-md"
        toForm={(r) => ({ id: r.id, title: r.title ?? '' })}
        fields={[{ name: 'title', label: 'Title', required: true, full: true }]}
        columns={[
          {
            key: 'title',
            header: t('Title'),
            cell: (r) => (
              <span className="flex items-center gap-2">
                <span className="font-medium">{r.title}</span>
                {pins && r.is_open && <Badge tone="blue">{t('Open')}</Badge>}
              </span>
            ),
          },
          ...(pins
            ? [
                {
                  key: 'seating',
                  header: t('Table code'),
                  cell: (r: TableRow) => (
                    <div onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" variant={r.is_open ? 'secondary' : 'primary'} icon={<KeyRound className="h-4 w-4" />} onClick={() => setSeating(r)}>
                        {r.is_open ? t('Table code') : t('Open table')}
                      </Button>
                    </div>
                  ),
                },
              ]
            : []),
          ...(dm
            ? [
                {
                  key: 'digital_menu',
                  header: t('Digital Menu'),
                  cell: (r: TableRow) => (
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" variant="secondary" icon={<QrIcon className="h-4 w-4" />} onClick={() => setQr(r)} aria-label={`${t('QR code')} — ${r.title}`}>
                        {t('QR code')}
                      </Button>
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={() => copy(menuLink(r.digital_menu), t('Link copied'))}
                        aria-label={`${t('Copy link')} — ${r.title}`}
                        title={t('Copy link')}
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                      <a
                        href={menuLink(r.digital_menu)}
                        target="_blank"
                        rel="noreferrer"
                        className="btn-ghost btn-sm"
                        aria-label={`${t('Open')} — ${r.title}`}
                        title={t('Open')}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </div>
                  ),
                },
              ]
            : []),
          { key: 'created_at', header: t('Created at'), className: 'whitespace-nowrap text-slate-500' },
        ]}
      />
      <QrModal table={qr} onClose={() => setQr(null)} />
      <SeatingDialog table={seating} onClose={() => setSeating(null)} />
    </>
  );
}
