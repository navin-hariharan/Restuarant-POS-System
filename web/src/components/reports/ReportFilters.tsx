import clsx from 'clsx';
import { CalendarRange, FilterX } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { useT } from '@/providers/AppProviders';
import { DURATION_PRESETS, emptyDuration, type DurationFilter, type DurationValue } from './duration';

const QUICK: DurationValue[] = ['today', 'last_seven_days', 'monthly', 'yearly'];

/**
 * Shared filter bar for reports: quick duration chips, the full preset list, a custom
 * date/time range (sent as starting_date/starting_time/ending_date/ending_time) and an
 * optional slot for report-specific filters.
 */
export function ReportFilters({
  value,
  onChange,
  children,
  extraActive,
  onResetExtra,
  className,
}: {
  value: DurationFilter;
  onChange: (v: DurationFilter) => void;
  /** Report-specific filter controls (rendered in the same grid). */
  children?: ReactNode;
  /** Whether any report-specific filter is set (shows the reset button). */
  extraActive?: boolean;
  onResetExtra?: () => void;
  className?: string;
}) {
  const t = useT();
  const id = useId();
  const set = (patch: Partial<DurationFilter>) => onChange({ ...value, ...patch });
  const active = !!value.duration || !!extraActive;
  const preset = DURATION_PRESETS.find((p) => p.value === value.duration);

  return (
    <section aria-label={t('Filters')} className={clsx('card mb-5 p-4 no-print', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <CalendarRange className="h-4 w-4 text-slate-400" aria-hidden />
        <div role="group" aria-label={t('Select Duration')} className="flex flex-wrap gap-1.5">
          <QuickChip active={!value.duration} onClick={() => onChange({ ...emptyDuration })}>
            {t('All time')}
          </QuickChip>
          {QUICK.map((q) => (
            <QuickChip key={q} active={value.duration === q} onClick={() => set({ duration: q })}>
              {t(DURATION_PRESETS.find((p) => p.value === q)!.label)}
            </QuickChip>
          ))}
          <QuickChip active={value.duration === 'custom'} onClick={() => set({ duration: 'custom' })}>
            {t('Custom')}
          </QuickChip>
        </div>
        {active && (
          <button
            type="button"
            className="btn-ghost btn-sm ms-auto"
            onClick={() => {
              onChange({ ...emptyDuration });
              onResetExtra?.();
            }}
          >
            <FilterX className="h-4 w-4" />
            {t('Reset filters')}
          </button>
        )}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label" htmlFor={`${id}-dur`}>
            {t('Duration')}
          </label>
          <select
            id={`${id}-dur`}
            className="input"
            value={value.duration}
            onChange={(e) => set({ duration: e.target.value as DurationValue })}
            aria-describedby={preset ? `${id}-hint` : undefined}
          >
            <option value="">{t('All time')}</option>
            {DURATION_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {t(p.label)}
              </option>
            ))}
          </select>
          {preset && (
            <p id={`${id}-hint`} className="help">
              {t(preset.hint)}
            </p>
          )}
        </div>
        {children}
      </div>

      {value.duration === 'custom' && (
        <div className="mt-3 grid gap-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/40 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label" htmlFor={`${id}-sd`}>
              {t('Starting date')}
            </label>
            <input
              id={`${id}-sd`}
              type="date"
              className="input"
              value={value.starting_date}
              max={value.ending_date || undefined}
              onChange={(e) => set({ starting_date: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor={`${id}-st`}>
              {t('Starting time')}
            </label>
            <input
              id={`${id}-st`}
              type="time"
              className="input"
              value={value.starting_time}
              disabled={!value.starting_date}
              onChange={(e) => set({ starting_time: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor={`${id}-ed`}>
              {t('Ending date')}
            </label>
            <input
              id={`${id}-ed`}
              type="date"
              className="input"
              value={value.ending_date}
              min={value.starting_date || undefined}
              onChange={(e) => set({ ending_date: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor={`${id}-et`}>
              {t('Ending time')}
            </label>
            <input
              id={`${id}-et`}
              type="time"
              className="input"
              value={value.ending_time}
              disabled={!value.ending_date}
              onChange={(e) => set({ ending_time: e.target.value })}
            />
          </div>
        </div>
      )}
    </section>
  );
}

function QuickChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={clsx(
        'rounded-full border px-3 py-1 text-xs font-medium transition pointer-coarse:min-h-10 pointer-coarse:px-4',
        active
          ? 'border-brand-600 bg-brand-600 text-white'
          : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
      )}
    >
      {children}
    </button>
  );
}

/** Small labelled select for report-specific filters, sized for the filter grid. */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string | number; label: string }[];
  allLabel?: string;
}) {
  const t = useT();
  const id = useId();
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{allLabel ?? t('All')}</option>
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
