import clsx from 'clsx';
import { ChevronLeft, ChevronRight, Inbox, Search, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '@/providers/AppProviders';

export function Card({ children, className, title, actions, bodyClassName }: { children?: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode; bodyClassName?: string }) {
  return (
    <section className={clsx('card', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={clsx(bodyClassName ?? 'p-4')}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions, children }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const tones = {
  gray: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  blue: 'bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300',
  green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  amber: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  red: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
  purple: 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
};
export type Tone = keyof typeof tones;

export function Badge({ tone = 'gray', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={clsx('chip', tones[tone], className)}>{children}</span>;
}

export function EmptyState({ title, description, icon, action }: { title?: ReactNode; description?: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="rounded-full bg-slate-100 p-3 text-slate-400 dark:bg-slate-800">{icon ?? <Inbox className="h-6 w-6" />}</div>
      <p className="text-sm font-medium">{title ?? t('No data found')}</p>
      {description && <p className="max-w-sm text-sm text-slate-500">{description}</p>}
      {action}
    </div>
  );
}

export function useDebounced<T>(value: T, delay = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return v;
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
  autoFocus,
  inputRef,
  onEnter,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
  onEnter?: (v: string) => void;
}) {
  const t = useT();
  return (
    <div className={clsx('relative', className)}>
      <Search className="pointer-events-none absolute inset-s-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        ref={inputRef}
        type="search"
        autoFocus={autoFocus}
        className="input ps-9 pe-8"
        placeholder={placeholder ?? t('Search')}
        aria-label={placeholder ?? t('Search')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onEnter?.((e.target as HTMLInputElement).value);
        }}
      />
      {value && (
        <button
          type="button"
          className="absolute inset-e-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-slate-400 hover:text-slate-600"
          onClick={() => onChange('')}
          aria-label="Clear"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { value: T; label: ReactNode; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={clsx('flex gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1 dark:bg-slate-800/70', className)}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          role="tab"
          type="button"
          aria-selected={value === tab.value}
          onClick={() => onChange(tab.value)}
          className={clsx(
            'flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition pointer-coarse:min-h-10',
            value === tab.value
              ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white'
              : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
          )}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className="rounded-full bg-slate-200 px-1.5 text-xs dark:bg-slate-700">{tab.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
  perPage,
  onPage,
  onPerPage,
}: {
  page: number;
  totalPages: number;
  total?: number;
  perPage?: number;
  onPage: (p: number) => void;
  onPerPage?: (n: number) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-slate-600 dark:text-slate-400">
      <div className="flex items-center gap-2">
        {onPerPage && (
          <>
            <label htmlFor="per-page">{t('Per page')}</label>
            <select
              id="per-page"
              className="input w-auto py-1"
              value={perPage}
              onChange={(e) => onPerPage(Number(e.target.value))}
            >
              {[10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </>
        )}
        {total !== undefined && (
          <span>
            {total} {t('Total').toLowerCase()}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button className="btn-ghost btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t('Previous')}>
          <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
        </button>
        <span className="px-2 tabular-nums">
          {page} / {Math.max(totalPages, 1)}
        </span>
        <button className="btn-ghost btn-sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label={t('Next')}>
          <ChevronRight className="h-4 w-4 rtl:rotate-180" />
        </button>
      </div>
    </div>
  );
}

/** Simple click-to-open popover menu. */
export function Menu({ trigger, children, align = 'end' }: { trigger: (p: { open: boolean; toggle: () => void }) => ReactNode; children: ReactNode | ((close: () => void) => ReactNode); align?: 'start' | 'end' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div className="relative" ref={ref}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          role="menu"
          className={clsx(
            'absolute z-40 mt-1 min-w-48 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900',
            align === 'end' ? 'inset-e-0' : 'inset-s-0',
          )}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ children, onClick, danger, icon }: { children: ReactNode; onClick?: () => void; danger?: boolean; icon?: ReactNode }) {
  return (
    <button
      role="menuitem"
      type="button"
      onClick={onClick}
      className={clsx(
        'flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-slate-100 dark:hover:bg-slate-800',
        danger ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-200',
      )}
    >
      {icon}
      {children}
    </button>
  );
}
