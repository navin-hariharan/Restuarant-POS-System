import clsx from 'clsx';
import { ArrowDownRight, ArrowUpRight, FileSpreadsheet, Minus, Printer, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTheme, useT } from '@/providers/AppProviders';
import { Button, type Tone } from '@/components/ui';

/* ------------------------------------------------------------------ colors */

/** Fixed-order categorical palette (validated light/dark steps). Never cycle past 8: fold into "Other". */
const SERIES_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const SERIES_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

export function useChartColors() {
  const { theme } = useTheme();
  const dark = theme === 'dark';
  return {
    series: dark ? SERIES_DARK : SERIES_LIGHT,
    primary: dark ? SERIES_DARK[0] : SERIES_LIGHT[0],
    /** Muted ink for the comparison ("previous period") series. */
    previous: dark ? '#64748b' : '#cbd5e1',
    grid: dark ? '#1e293b' : '#e2e8f0',
    axis: dark ? '#94a3b8' : '#64748b',
    surface: dark ? '#0f172a' : '#ffffff',
    good: '#0ca30c',
    critical: '#d03b3b',
  };
}

/** Compact axis ticks: 1.2k, 3.4M. */
export function compactNumber(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

/** Tooltip body for recharts (`<Tooltip content={<ChartTooltip format={money} />} />`). */
export function ChartTooltip({
  active,
  payload,
  label,
  format = (v) => String(v),
}: {
  active?: boolean;
  payload?: { name?: string; value?: number | string; color?: string; payload?: any; dataKey?: string | number }[];
  label?: ReactNode;
  format?: (v: unknown) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900">
      {label !== undefined && label !== '' && <p className="mb-1 font-semibold text-slate-800 dark:text-slate-100">{label}</p>}
      <ul className="space-y-0.5">
        {payload.map((p, i) => (
          <li key={i} className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color ?? p.payload?.fill }} aria-hidden />
            <span className="truncate">{p.name}</span>
            <span className="ms-auto ps-3 font-medium tabular-nums text-slate-900 dark:text-white">{format(p.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Legend rendered as HTML (keeps text in text colors, works in RTL). */
export function ChartLegend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-xs" style={{ background: i.color }} aria-hidden />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/* --------------------------------------------------------------- layout */

export function ChartCard({
  title,
  subtitle,
  actions,
  children,
  className,
  height = 'h-72',
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  height?: string;
}) {
  return (
    <section className={clsx('card p-4', className)}>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
        </div>
        {actions}
      </header>
      <div className={clsx('w-full', height)}>{children}</div>
    </section>
  );
}

/** Export/print/refresh buttons used in every report header. */
export function ReportActions({
  onCsv,
  onPrint,
  onRefresh,
  refreshing,
  disabled,
  children,
}: {
  onCsv?: () => void;
  onPrint?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-2 no-print">
      {children}
      {onRefresh && (
        <Button
          size="icon"
          variant="ghost"
          onClick={onRefresh}
          aria-label={t('Refresh')}
          title={t('Refresh')}
          icon={<RefreshCw className={clsx('h-4 w-4', refreshing && 'animate-spin')} />}
        />
      )}
      {onCsv && (
        <Button onClick={onCsv} disabled={disabled} icon={<FileSpreadsheet className="h-4 w-4" />}>
          {t('Export CSV')}
        </Button>
      )}
      {onPrint && (
        <Button onClick={onPrint} icon={<Printer className="h-4 w-4" />}>
          {t('Print')}
        </Button>
      )}
    </div>
  );
}

/** Percentage change, null when it can't be computed (no previous value). */
export function pctChange(current: unknown, previous: unknown): number | null {
  const c = Number(current) || 0;
  const p = Number(previous) || 0;
  if (p === 0) return c === 0 ? 0 : null;
  return ((c - p) / Math.abs(p)) * 100;
}

const toneBg: Record<Tone, string> = {
  gray: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  blue: 'bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300',
  green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  amber: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  red: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
  purple: 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
};

/**
 * KPI tile with an optional change-vs-previous indicator.
 * `lowerIsBetter` flips the good/bad coloring (e.g. expenses, discounts).
 */
export function KpiCard({
  label,
  value,
  icon,
  tone = 'blue',
  delta,
  previous,
  lowerIsBetter,
  hint,
  loading,
}: {
  label: ReactNode;
  value: ReactNode;
  icon?: ReactNode;
  tone?: Tone;
  /** Percent change; undefined hides the indicator, null means "new" (no previous data). */
  delta?: number | null;
  previous?: ReactNode;
  lowerIsBetter?: boolean;
  hint?: ReactNode;
  loading?: boolean;
}) {
  const t = useT();
  let indicator: ReactNode = null;
  if (delta !== undefined) {
    const up = delta === null || delta > 0.05;
    const down = delta !== null && delta < -0.05;
    const good = lowerIsBetter ? down : up;
    const bad = lowerIsBetter ? up : down;
    const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
    indicator = (
      <span
        className={clsx(
          'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums',
          good && 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
          bad && 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
          !good && !bad && 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
        )}
      >
        <Icon className="h-3 w-3" aria-hidden />
        {delta === null ? t('New') : `${Math.abs(delta).toFixed(Math.abs(delta) < 10 ? 1 : 0)}%`}
        <span className="sr-only">{up ? t('increase') : down ? t('decrease') : t('no change')}</span>
      </span>
    );
  }
  return (
    <div className="card flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
        {icon && <span className={clsx('rounded-lg p-2', toneBg[tone])}>{icon}</span>}
      </div>
      {loading ? (
        <span className="h-7 w-28 animate-pulse rounded-sm bg-slate-200 dark:bg-slate-800" />
      ) : (
        <p className="text-xl font-semibold tabular-nums tracking-tight wrap-anywhere sm:text-2xl">{value}</p>
      )}
      {(indicator || previous || hint) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
          {indicator}
          {previous}
          {hint}
        </div>
      )}
    </div>
  );
}

/** "Generated at" + period line shown on screen and on paper. */
export function ReportMeta({ period, generatedAt }: { period: ReactNode; generatedAt?: Date | number }) {
  const t = useT();
  return (
    <p className="text-xs text-slate-500 dark:text-slate-400">
      <span className="font-medium text-slate-700 dark:text-slate-300">{period}</span>
      {generatedAt ? (
        <>
          {' · '}
          {t('Generated at')} {new Date(generatedAt).toLocaleString()}
        </>
      ) : null}
    </p>
  );
}

/** Title block used inside the printable area (hidden on screen, the PageHeader covers it). */
export function PrintTitle({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="mb-4 hidden print:block">
      <h1 className="text-lg font-semibold">{title}</h1>
      {subtitle}
    </div>
  );
}
