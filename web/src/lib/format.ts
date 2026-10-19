import type { AppConfig } from './types';

/** Format money the way the shop configured it (symbol position from settings). */
export function formatMoney(value: unknown, config?: Pick<AppConfig, 'currency_symbol' | 'currency_symbol_on_left'> | null): string {
  const n = Number(value);
  const amount = (Number.isFinite(n) ? n : 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const symbol = config?.currency_symbol ?? '';
  if (!symbol) return amount;
  return config?.currency_symbol_on_left ? `${symbol}${amount}` : `${amount}${symbol}`;
}

export function formatNumber(value: unknown, digits = 2): string {
  const n = Number(value);
  return (Number.isFinite(n) ? n : 0).toLocaleString(undefined, { maximumFractionDigits: digits });
}

/** yyyy-mm-dd for <input type="date"> */
export function toDateInput(d: Date = new Date()): string {
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function toTimeInput(d: Date = new Date()): string {
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Minutes elapsed since a date-like value, or null. */
export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Read/write JSON in localStorage, never throwing. */
export const storage = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};
