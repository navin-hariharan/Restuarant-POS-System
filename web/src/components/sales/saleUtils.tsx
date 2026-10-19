import clsx from 'clsx';
import type { ReactNode } from 'react';
import { Badge, type Tone } from '@/components/ui';
import type { AppConfig } from '@/lib/types';
import type { CartItem, CartModifier } from '@/lib/cart';
import { useConfig, useT } from '@/providers/AppProviders';

/* ------------------------------------------------------------------ types */

export type StaffRef = { id: number; name: string; email?: string; avatar?: string | null; gravatar?: string } | null;
export type CustomerRef = { id: number; uuid?: string; name: string; email?: string | null; phone?: string | null; address?: string | null } | null;
export type TableRef = { id: number; title: string; is_booked?: boolean } | null;

/** Row of GET admin/sales (SaleResource) — optional fields are read when the API provides them. */
export type SaleRow = {
  id: number;
  uuid: string;
  tracking: string | number;
  cart_total_cost: number | string;
  cart_total_price: number | string;
  tax_amount: number | string;
  order_type: string;
  progress: number | null;
  customer: CustomerRef;
  table: TableRef;
  took_at: string | null;
  prepared_at: string | null;
  completed_at: string | null;
  is_cancelled: boolean;
  created_at: string;
  updated_at: string;
  payable_after_all?: number | string;
  discount_amount?: number | string;
  tip_amount?: number | string | null;
  is_preparing?: boolean;
  [key: string]: any;
};

export type SaleStatus = 'submitted' | 'preparing' | 'ready' | 'completed' | 'cancelled';

/* ------------------------------------------------------------------ helpers */

/** Parse "YYYY-MM-DD HH:mm:ss" (server, no zone) reliably in every browser. */
export function parseServerDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const v = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value) ? value.replace(' ', 'T') : value;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Epoch ms for a server wall-clock time ("YYYY-MM-DD HH:mm:ss" in the app timezone),
 * so timers stay right when the device runs in another timezone.
 */
export function serverEpoch(value: string | null | undefined, timeZone?: string | null): number | null {
  const d = parseServerDate(value);
  if (!d) return null;
  const m = value && /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!m || !timeZone) return d.getTime();
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(asUtc));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const tzWall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    return asUtc - (tzWall - asUtc);
  } catch {
    return d.getTime();
  }
}

export function formatDateTime(value: string | null | undefined, locale?: string): string {
  const d = parseServerDate(value);
  if (!d) return value ?? '';
  return d.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

export function saleStatus(sale: Partial<SaleRow>): SaleStatus {
  if (sale.is_cancelled) return 'cancelled';
  if (sale.completed_at) return 'completed';
  const progress = Number(sale.progress ?? 0);
  if (sale.prepared_at || progress >= 100) return 'ready';
  if (progress > 0 || sale.is_preparing) return 'preparing';
  return 'submitted';
}

const statusMeta: Record<SaleStatus, { label: string; tone: Tone }> = {
  submitted: { label: 'Submitted', tone: 'blue' },
  preparing: { label: 'Preparing', tone: 'amber' },
  ready: { label: 'Ready', tone: 'purple' },
  completed: { label: 'Completed', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'red' },
};

export function StatusBadge({ status, className }: { status: SaleStatus; className?: string }) {
  const t = useT();
  const meta = statusMeta[status];
  return (
    <Badge tone={meta.tone} className={className}>
      <span className={clsx('h-1.5 w-1.5 rounded-full bg-current', status === 'preparing' && 'animate-pulse')} aria-hidden="true" />
      {t(meta.label)}
    </Badge>
  );
}

const fallbackTypes: Record<string, string> = {
  dining: 'Dining',
  pickup: 'Pickup',
  dilivery: 'Delivery',
  roomservice: 'Room Service',
};

export function orderTypeLabel(config: Pick<AppConfig, 'order_types'>, key: string | null | undefined): string {
  if (!key) return '';
  return config.order_types?.find((o) => o.key === key)?.title ?? fallbackTypes[key] ?? key;
}

/** All order types known to the shop (config list + room service when enabled). */
export function orderTypeOptions(config: AppConfig): { value: string; label: string }[] {
  const list = (config.order_types ?? []).map((o) => ({ value: o.key, label: o.title }));
  if (config.modes.room_reservations_enabled && !list.some((o) => o.value === 'roomservice')) {
    list.push({ value: 'roomservice', label: fallbackTypes.roomservice });
  }
  return list;
}

const typeTones: Record<string, string> = {
  dining: 'bg-lime-100 text-lime-800 dark:bg-lime-950 dark:text-lime-300',
  pickup: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300',
  dilivery: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  roomservice: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300',
};

export function OrderTypeChip({ type, children, className }: { type: string; children?: ReactNode; className?: string }) {
  const { config } = useConfig();
  const t = useT();
  return (
    <span className={clsx('chip', typeTones[type] ?? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300', className)}>
      {t(orderTypeLabel(config, type))}
      {children}
    </span>
  );
}

/** Checked modifiers in the order they were picked (same as the old UI). */
export function checkedModifiers(modifiers: CartModifier[] | undefined | null): CartModifier[] {
  return (modifiers ?? [])
    .filter((m) => m.is_checked)
    .sort((a, b) => (a.selected_at || 0) - (b.selected_at || 0));
}

export function itemsOf(value: unknown): CartItem[] {
  if (Array.isArray(value)) return value as CartItem[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Can this sale be reopened in the POS? */
export function canEditInPos(sale: Partial<SaleRow>, allowEditChecked: boolean): boolean {
  if (sale.is_cancelled) return false;
  if (sale.completed_at) return allowEditChecked;
  return true;
}

export function ProgressBar({ value, className, tone }: { value: number; className?: string; tone?: string }) {
  const v = Math.max(0, Math.min(100, Math.round(value || 0)));
  return (
    <div
      className={clsx('h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800', className)}
      role="progressbar"
      aria-valuenow={v}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={clsx('h-full rounded-full transition-[width]', tone ?? (v >= 100 ? 'bg-emerald-500' : 'bg-brand-500'))} style={{ width: `${v}%` }} />
    </div>
  );
}
