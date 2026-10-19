import clsx from 'clsx';
import { BellRing, Check, CheckCheck, Clock, MessageSquareText, Printer, StickyNote } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { CartItem } from '@/lib/cart';
import { useConfig, useT } from '@/providers/AppProviders';
import { checkedModifiers, OrderTypeChip, ProgressBar, serverEpoch } from '@/components/sales/saleUtils';

export type KitchenOrder = {
  id: number;
  uuid: string;
  tracking: string | number;
  items: CartItem[];
  table: { id: number; title: string } | null;
  customer: { id: number; name: string; phone?: string | null } | null;
  chef_id: number | null;
  order_type: string;
  took_at: string | null;
  note_for_chef: string | null;
  created_at: string;
  updated_at: string;
  pickup_point?: { place_title?: string } | null;
  shipping_address?: string | null;
  guest_room_reservation?: { room?: { title?: string }; room_title?: string } | null;
};

export type Chef = { id: number; name: string };

/** Background presets kept compatible with the old `orders_bg` values. */
export const ticketBackgrounds: Record<string, { label: string; className: string; swatch: string }> = {
  'bg-white': { label: 'White', className: 'bg-white dark:bg-slate-900', swatch: 'bg-white' },
  'bg-blue-50': { label: 'Blue 50', className: 'bg-blue-50 dark:bg-blue-950/40', swatch: 'bg-blue-50' },
  'bg-blue-100': { label: 'Blue 100', className: 'bg-blue-100 dark:bg-blue-950/60', swatch: 'bg-blue-100' },
  'bg-blue-200': { label: 'Blue 200', className: 'bg-blue-200 dark:bg-blue-900/60', swatch: 'bg-blue-200' },
  'bg-yellow-50': { label: 'Yellow 50', className: 'bg-yellow-50 dark:bg-yellow-950/40', swatch: 'bg-yellow-50' },
  'bg-yellow-100': { label: 'Yellow 100', className: 'bg-yellow-100 dark:bg-yellow-950/60', swatch: 'bg-yellow-100' },
  'bg-yellow-200': { label: 'Yellow 200', className: 'bg-yellow-200 dark:bg-yellow-900/50', swatch: 'bg-yellow-200' },
  'bg-purple-50': { label: 'Purple 50', className: 'bg-purple-50 dark:bg-purple-950/40', swatch: 'bg-purple-50' },
  'bg-purple-100': { label: 'Purple 100', className: 'bg-purple-100 dark:bg-purple-950/60', swatch: 'bg-purple-100' },
  'bg-purple-200': { label: 'Purple 200', className: 'bg-purple-200 dark:bg-purple-900/50', swatch: 'bg-purple-200' },
};

/** Elapsed-time escalation: fresh < 10 min, warning 10–20 min, late > 20 min. */
export function urgency(minutes: number | null): 'fresh' | 'warn' | 'late' {
  if (minutes === null) return 'fresh';
  if (minutes > 20) return 'late';
  if (minutes > 10) return 'warn';
  return 'fresh';
}

function elapsedLabel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function targetOf(order: KitchenOrder): string | null {
  if (order.table?.title) return order.table.title;
  if (order.pickup_point?.place_title) return order.pickup_point.place_title;
  const room = order.guest_room_reservation?.room?.title ?? order.guest_room_reservation?.room_title;
  if (room) return room;
  return null;
}

export function KitchenTicket({
  order,
  visibleItems,
  chefs,
  chefId,
  now,
  isNew,
  busy,
  bg,
  compact,
  onToggleItem,
  onMarkAll,
  onChef,
  onAcknowledge,
}: {
  order: KitchenOrder;
  /** Items shown in this view (kitchen/bar filter, not_display removed), with their index in order.items. */
  visibleItems: { item: CartItem; index: number }[];
  chefs: Chef[];
  chefId: number | null;
  now: number;
  isNew: boolean;
  busy: boolean;
  bg: string;
  compact: boolean;
  onToggleItem: (index: number) => void;
  onMarkAll: () => void;
  onChef: (id: number) => void;
  onAcknowledge: () => void;
}) {
  const t = useT();
  const { config } = useConfig();
  const started = serverEpoch(order.took_at, config.app_timezone);
  const ms = started ? now - started : 0;
  const level = urgency(started ? Math.floor(ms / 60000) : null);
  const ready = visibleItems.filter((v) => v.item.is_ready).length;
  const allReady = ready === visibleItems.length;
  const progress = visibleItems.length ? (ready / visibleItems.length) * 100 : 0;
  const target = targetOf(order);

  return (
    <article
      aria-label={`${t('Order #')}${order.tracking}`}
      className={clsx(
        'flex flex-col overflow-hidden rounded-2xl border-2 shadow-xs transition',
        ticketBackgrounds[bg]?.className ?? ticketBackgrounds['bg-white'].className,
        level === 'fresh' && 'border-slate-200 dark:border-slate-700',
        level === 'warn' && 'border-amber-400 dark:border-amber-500',
        level === 'late' && 'border-red-500',
        isNew && 'ring-4 ring-brand-400/60',
      )}
    >
      {/* Header */}
      <header
        className={clsx(
          'flex items-start justify-between gap-2 px-3 py-2.5',
          level === 'fresh' && 'bg-slate-900 text-white dark:bg-slate-800',
          level === 'warn' && 'bg-amber-400 text-amber-950',
          level === 'late' && 'bg-red-600 text-white',
        )}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold tabular-nums leading-tight">#{order.tracking}</h2>
            {isNew && (
              <span className="inline-flex animate-flash items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-bold uppercase text-brand-700">
                <BellRing className="h-3 w-3" />
                {t('New')}
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <OrderTypeChip type={order.order_type} className="bg-white/90! text-slate-800!" />
            {target && <span className="truncate text-sm font-semibold">{target}</span>}
          </div>
          {order.customer?.name && <p className="mt-0.5 truncate text-xs opacity-80">{order.customer.name}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end">
          <span className={clsx('flex items-center gap-1 font-mono text-xl font-bold tabular-nums', level === 'late' && 'animate-flash')} title={t('Elapsed time')}>
            <Clock className="h-4 w-4" />
            {started ? elapsedLabel(ms) : '--:--'}
          </span>
          {order.took_at && <span className="text-[11px] opacity-75">{order.took_at.slice(11, 16)}</span>}
        </div>
      </header>

      {order.note_for_chef && (
        <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-100 px-3 py-2 text-sm font-medium text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="whitespace-pre-line">{order.note_for_chef}</p>
        </div>
      )}

      {/* Items */}
      <ul className="flex-1 divide-y divide-slate-200/70 dark:divide-slate-700/70">
        {visibleItems.map(({ item, index }) => {
          const mods = checkedModifiers(item.modifiers);
          return (
            <li key={item.cart_uuid ?? index}>
              <button
                type="button"
                role="checkbox"
                aria-checked={!!item.is_ready}
                disabled={busy}
                onClick={() => onToggleItem(index)}
                className={clsx(
                  'flex w-full items-start gap-3 px-3 text-start transition hover:bg-black/5 disabled:cursor-wait dark:hover:bg-white/5',
                  compact ? 'min-h-[44px] py-2' : 'min-h-[56px] py-3',
                )}
              >
                <span
                  className={clsx(
                    'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 transition',
                    item.is_ready ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-400 bg-white dark:border-slate-500 dark:bg-slate-800',
                  )}
                  aria-hidden="true"
                >
                  {item.is_ready && <Check className="h-5 w-5" strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={clsx('flex items-baseline gap-2', item.is_ready && 'text-slate-400 line-through dark:text-slate-500')}>
                    <span className="shrink-0 rounded-md bg-slate-900 px-1.5 text-sm font-bold tabular-nums text-white dark:bg-slate-100 dark:text-slate-900">
                      {item.qty}×
                    </span>
                    <span className={clsx('font-semibold leading-snug', compact ? 'text-sm' : 'text-base')}>{item.name}</span>
                    {item.is_bar_type && (
                      <span className="chip shrink-0 bg-sky-100 text-sky-800 no-underline dark:bg-sky-950 dark:text-sky-300">{t('Bar')}</span>
                    )}
                  </span>
                  {mods.length > 0 && (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {mods.map((m) => (
                        <span key={m.id} className="rounded-sm bg-violet-100 px-1.5 py-0.5 text-xs font-medium text-violet-800 dark:bg-violet-950 dark:text-violet-300">
                          + {Number(m.qty) > 1 ? `${m.qty}× ` : ''}
                          {m.title}
                        </span>
                      ))}
                    </span>
                  )}
                  {item.note && (
                    <span className="mt-1 flex items-start gap-1 rounded-sm bg-yellow-100 px-1.5 py-1 text-xs font-medium text-yellow-900 dark:bg-yellow-950 dark:text-yellow-200">
                      <StickyNote className="mt-px h-3.5 w-3.5 shrink-0" />
                      {item.note}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* Footer */}
      <footer className="space-y-2 border-t border-slate-200/70 px-3 py-3 dark:border-slate-700/70">
        <div className="flex items-center gap-2">
          <ProgressBar value={progress} className="h-2!" />
          <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-600 dark:text-slate-300">
            {ready}/{visibleItems.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor={`chef-${order.id}`}>
            {t('Chef')}
          </label>
          <select
            id={`chef-${order.id}`}
            className="input h-11 min-w-0 flex-1 py-0"
            value={chefId ?? ''}
            disabled={busy}
            onChange={(e) => onChef(Number(e.target.value))}
          >
            {!chefs.length && <option value="">{t('Chef')}</option>}
            {chefs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <Link
            to={`/print/sale/${order.uuid}?k_portal=true`}
            className="btn-secondary h-11 w-11 shrink-0 p-0!"
            aria-label={t('Print')}
            title={t('Print')}
          >
            <Printer className="h-5 w-5" />
          </Link>
        </div>
        <div className="flex gap-2">
          {isNew && (
            <button type="button" className="btn-secondary h-12 flex-1" onClick={onAcknowledge}>
              <BellRing className="h-4 w-4" />
              {t('Acknowledge')}
            </button>
          )}
          <button
            type="button"
            className={clsx('h-12 flex-2', allReady ? 'btn-secondary' : 'btn-success')}
            disabled={busy || allReady}
            onClick={onMarkAll}
          >
            <CheckCheck className="h-5 w-5" />
            {allReady ? t('All ready') : t('Mark all ready')}
          </button>
        </div>
      </footer>
    </article>
  );
}
