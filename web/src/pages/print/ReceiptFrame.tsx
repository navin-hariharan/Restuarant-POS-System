import clsx from 'clsx';
import { ArrowLeft, FileText, Printer, Ruler } from 'lucide-react';
import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { BrandIcon, Button, Input, Spinner } from '@/components/ui';
import { textLines } from '@/lib/format';
import { useConfig, useT } from '@/providers/AppProviders';

const STYLE_ID = 'receipt-page-size';

function setPageSize(width?: string, height?: string) {
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  const size = [width, height].filter((v) => v && String(v).trim()).join(' ');
  el.textContent = `@page { margin: 0; ${size ? `size: ${size};` : ''} }
@media print {
  html, body, #root { height: auto !important; background: #fff !important; }
  [data-sonner-toaster] { display: none !important; }
  .receipt-paper { width: 100% !important; max-width: none !important; box-shadow: none !important; margin: 0 !important; border: 0 !important; }
}`;
}

export function safeColor(c?: string | null): string {
  if (!c) return '#000';
  try {
    return typeof CSS !== 'undefined' && CSS.supports('color', c) ? c : '#000';
  } catch {
    return '#000';
  }
}

export const px = (v: unknown, fallback: number) => {
  const n = Number(v);
  return `${Number.isFinite(n) && n > 0 ? n : fallback}px`;
};

/**
 * Shared shell for thermal receipts: toolbar (hidden when printing), paper sized
 * from the printer settings, `@page` size and optional auto print.
 */
export function ReceiptFrame({
  ready,
  loading,
  title,
  toolbar,
  children,
}: {
  ready: boolean;
  loading: boolean;
  title?: string;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  const t = useT();
  const navigate = useNavigate();
  const { config } = useConfig();
  const printer = config.printer;
  const [width, setWidth] = useState(printer.printer_width || '80mm');
  const [height, setHeight] = useState(printer.printer_height || '');
  const [editSize, setEditSize] = useState(false);
  const printed = useRef(false);

  useEffect(() => {
    if (title) document.title = title;
  }, [title]);

  useEffect(() => {
    setPageSize(width, height);
  }, [width, height]);

  useEffect(
    () => () => {
      document.getElementById(STYLE_ID)?.remove();
    },
    [],
  );

  useEffect(() => {
    if (!ready || !printer.print_auto || printed.current) return;
    printed.current = true;
    const id = setTimeout(() => window.print(), 800);
    return () => clearTimeout(id);
  }, [ready, printer.print_auto]);

  const printA4 = () => {
    setPageSize('210mm', '297mm');
    window.print();
    setPageSize(width, height);
  };

  const back = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/admin/pos');
  };

  const paperStyle: CSSProperties = {
    width,
    maxWidth: '100%',
    fontFamily: printer.print_font_family || 'monospace',
    color: safeColor(printer.print_font_color),
  };

  return (
    <div className="min-h-full bg-slate-100 pb-10 dark:bg-slate-950 print:bg-white print:p-0">
      <div className="no-print sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/90">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 px-3 py-2">
          <Button className="h-11" icon={<ArrowLeft className="h-4 w-4 rtl:rotate-180" />} onClick={back}>
            {t('Back')}
          </Button>
          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
            {toolbar}
            <Button className="h-11" variant="ghost" icon={<Ruler className="h-4 w-4" />} onClick={() => setEditSize((v) => !v)} aria-pressed={editSize}>
              <span className="hidden sm:inline">{t('Printer width')}</span>
            </Button>
            <Button className="h-11" icon={<FileText className="h-4 w-4" />} onClick={printA4} disabled={!ready}>
              {t('A4')}
            </Button>
            <Button className="h-11" variant="primary" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()} disabled={!ready}>
              {t('Print')}
            </Button>
          </div>
        </div>
        {editSize && (
          <div className="mx-auto flex max-w-5xl flex-wrap items-end gap-3 px-3 pb-3">
            <Input label={t('Printer width')} value={width} onChange={(e) => setWidth(e.target.value)} wrapperClassName="w-36" placeholder="80mm" />
            <Input label={t('Printer height')} value={height} onChange={(e) => setHeight(e.target.value)} wrapperClassName="w-36" placeholder="auto" />
            <p className="pb-2 text-xs text-slate-500">{t('Use CSS units, e.g. 80mm, 3in. Leave height empty for continuous paper.')}</p>
          </div>
        )}
      </div>

      {loading || !ready ? (
        <div className="no-print flex justify-center py-20 text-brand-600">
          {loading ? <Spinner className="h-8 w-8" /> : <p className="text-sm text-slate-500">{t('No data found')}</p>}
        </div>
      ) : (
        <article
          className={clsx('receipt-paper mx-auto mt-4 bg-white p-3 shadow-md print:mt-0 print:p-2 print:shadow-none')}
          style={{ ...paperStyle, printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' } as CSSProperties}
        >
          {children}
        </article>
      )}
    </div>
  );
}

/** Logo + shop name/address block positioned per printer settings. */
export function ReceiptHeader({ heading }: { heading?: ReactNode }) {
  const { config } = useConfig();
  const p = config.printer;
  const pos = p.print_name_address_position;
  const align = pos === 'left' ? 'start' : pos === 'right' ? 'end' : 'center';
  return (
    <header style={{ textAlign: align as CSSProperties['textAlign'] }}>
      {p.display_logo && config.icon && (
        <div className={clsx('mb-1 flex', align === 'start' ? 'justify-start' : align === 'end' ? 'justify-end' : 'justify-center')}>
          <BrandIcon src={config.icon} className="h-16 w-16 object-contain" />
        </div>
      )}
      <div className="my-2 font-bold" style={{ fontSize: px(p.print_name_address_size, 16) }}>
        {heading ?? (
          <>
            <p className="uppercase tracking-wider">{config.name}</p>
            <div className="text-[0.7em] font-normal normal-case">
              {config.phone && <p>{config.phone}</p>}
              {config.address && (
                <p>
                  {textLines(config.address).map((line, i) => (
                    <Fragment key={i}>
                      {i > 0 && <br />}
                      {line}
                    </Fragment>
                  ))}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </header>
  );
}

export function KV({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={clsx('flex justify-between gap-3', className)}>
      <span className="shrink-0 font-bold uppercase">{label}:</span>
      <span className="text-end">{children}</span>
    </div>
  );
}

export function ReceiptFooter() {
  const t = useT();
  const { config } = useConfig();
  const p = config.printer;
  if (!p.terms_conditions && !p.signature_required) return null;
  return (
    <div className="pt-2" style={{ fontSize: px(p.print_terms_conditions_font_size, 9) }}>
      {p.terms_conditions && (
        <>
          <strong>{t('Terms and conditions')}</strong>
          <div className="whitespace-pre-line">{p.terms_conditions}</div>
        </>
      )}
      {p.signature_required && (
        <div className="mt-6 flex items-end justify-between gap-2">
          <span className="font-bold">{t('Signature')}</span>
          <span className="flex-1 border-b border-dashed border-current" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}
