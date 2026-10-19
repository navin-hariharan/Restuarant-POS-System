import { useId, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalendarDays, CalendarRange, Sigma, TrendingUp } from 'lucide-react';
import { api } from '@/lib/api';
import { useConfig, useT } from '@/providers/AppProviders';
import { Checkbox, PageHeader } from '@/components/ui';
import { ChartCard, ChartLegend, ChartTooltip, KpiCard, PrintTitle, ReportActions, ReportMeta, compactNumber, pctChange, useChartColors } from './ReportKit';
import { MONTH_KEYS } from './duration';
import { downloadCsv } from './export';
import { usePrintReport } from './usePrintReport';

const num = (v: unknown) => Number(v) || 0;
const FIRST_YEAR = 2020;

/**
 * Twelve-month report for endpoints that take `{year, ...filters}` (POST) and return
 * an array of 12 monthly sums (report-tax, report-expense).
 */
export function AnnualReport({
  endpoint,
  title,
  description,
  seriesLabel,
  fileName,
  filters,
  filterControls,
  colorIndex = 0,
  lowerIsBetter,
}: {
  endpoint: string;
  title: string;
  description: string;
  seriesLabel: string;
  fileName: string;
  filters?: Record<string, string | undefined>;
  filterControls?: ReactNode;
  colorIndex?: number;
  lowerIsBetter?: boolean;
}) {
  const t = useT();
  const { money } = useConfig();
  const colors = useChartColors();
  const id = useId();
  const now = new Date().getFullYear();
  const [year, setYear] = useState(now);
  const [compare, setCompare] = useState(true);
  const years = Array.from({ length: now - FIRST_YEAR + 1 }, (_, i) => now - i);
  const clean = Object.fromEntries(Object.entries(filters ?? {}).filter(([, v]) => v));

  const fetchYear = async (y: number) => (await api.post<number[]>(endpoint, { ...clean, year: y })).data;
  const q = useQuery({ queryKey: [endpoint, year, clean], queryFn: () => fetchYear(year), placeholderData: keepPreviousData });
  const prevQ = useQuery({ queryKey: [endpoint, year - 1, clean], queryFn: () => fetchYear(year - 1), enabled: compare, placeholderData: keepPreviousData });

  const cur = (q.data ?? []).map(num);
  const prev = (prevQ.data ?? []).map(num);
  const total = cur.reduce((s, v) => s + v, 0);
  const prevTotal = prev.reduce((s, v) => s + v, 0);
  // Average over elapsed months for the current year, all 12 otherwise.
  const months = year === now ? new Date().getMonth() + 1 : 12;
  const avg = total / months;
  const peakIdx = cur.length ? cur.indexOf(Math.max(...cur)) : -1;
  const data = MONTH_KEYS.map((m, i) => ({ month: t(m), current: cur[i] ?? 0, previous: prev[i] ?? 0 }));
  const color = colors.series[colorIndex];
  const { ref, printing, print } = usePrintReport(`${title} ${year}`);

  const exportCsv = () =>
    downloadCsv(
      `${fileName}_${year}`,
      compare ? [t('Month'), String(year), String(year - 1), t('Change')] : [t('Month'), String(year)],
      data.map((d) => {
        const ch = pctChange(d.current, d.previous);
        return compare ? [d.month, d.current, d.previous, ch === null ? '' : `${ch.toFixed(1)}%`] : [d.month, d.current];
      }),
    );

  return (
    <div>
      <PageHeader
        title={title}
        description={description}
        actions={<ReportActions onRefresh={() => { q.refetch(); if (compare) prevQ.refetch(); }} refreshing={q.isFetching} onCsv={exportCsv} onPrint={print} />}
      />
      <section aria-label={t('Filters')} className="card mb-5 p-4 no-print">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label" htmlFor={`${id}-y`}>
              {t('Year')}
            </label>
            <select id={`${id}-y`} className="input" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          {filterControls}
          <div className="flex items-end pb-2">
            <Checkbox checked={compare} onChange={setCompare} label={t('Compare with :year', { year: year - 1 })} />
          </div>
        </div>
      </section>

      <div ref={ref} className="space-y-5">
        <PrintTitle title={`${title} — ${year}`} subtitle={<ReportMeta period={String(year)} generatedAt={q.dataUpdatedAt} />} />
        <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            loading={q.isLoading}
            label={t('Total')}
            value={money(total)}
            icon={<Sigma className="h-4 w-4" />}
            tone={lowerIsBetter ? 'red' : 'amber'}
            delta={compare && prevQ.data ? pctChange(total, prevTotal) : undefined}
            lowerIsBetter={lowerIsBetter}
            previous={compare && prevQ.data ? `${t('vs')} ${money(prevTotal)}` : undefined}
          />
          <KpiCard loading={q.isLoading} label={t('Monthly average')} value={money(avg)} icon={<CalendarDays className="h-4 w-4" />} tone="blue" />
          <KpiCard
            loading={q.isLoading}
            label={t('Highest month')}
            value={peakIdx >= 0 && cur[peakIdx] > 0 ? t(MONTH_KEYS[peakIdx]) : '—'}
            hint={peakIdx >= 0 && cur[peakIdx] > 0 ? money(cur[peakIdx]) : undefined}
            icon={<TrendingUp className="h-4 w-4" />}
            tone="purple"
          />
          <KpiCard loading={q.isLoading} label={t('This month')} value={year === now ? money(cur[new Date().getMonth()]) : '—'} icon={<CalendarRange className="h-4 w-4" />} tone="gray" />
        </div>

        <ChartCard
          title={`${seriesLabel} — ${year}`}
          actions={
            compare ? (
              <ChartLegend items={[{ label: String(year), color }, { label: String(year - 1), color: colors.previous }]} />
            ) : undefined
          }
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barGap={2}>
              <CartesianGrid vertical={false} stroke={colors.grid} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: colors.axis }} tickLine={false} axisLine={{ stroke: colors.grid }} />
              <YAxis tickFormatter={compactNumber} tick={{ fontSize: 11, fill: colors.axis }} tickLine={false} axisLine={false} width={48} />
              <Tooltip cursor={{ fill: colors.grid, opacity: 0.5 }} content={<ChartTooltip format={money} />} />
              {compare && <Bar dataKey="previous" name={String(year - 1)} fill={colors.previous} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={!printing} />}
              <Bar dataKey="current" name={String(year)} fill={color} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={!printing} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <section className="card overflow-hidden">
          <div className="relative overflow-x-auto">
            <table className="table-base">
              <thead className="bg-slate-50 dark:bg-slate-900/60">
                <tr>
                  <th>{t('Month')}</th>
                  <th className="text-end">{year}</th>
                  {compare && <th className="text-end">{year - 1}</th>}
                  {compare && <th className="text-end">{t('Change')}</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.map((d) => {
                  const ch = pctChange(d.current, d.previous);
                  const good = ch !== null && (lowerIsBetter ? ch < 0 : ch > 0);
                  const bad = ch !== null && (lowerIsBetter ? ch > 0 : ch < 0);
                  return (
                    <tr key={d.month}>
                      <td className="font-medium">{d.month}</td>
                      <td className="text-end tabular-nums">{money(d.current)}</td>
                      {compare && <td className="text-end tabular-nums text-slate-500">{money(d.previous)}</td>}
                      {compare && (
                        <td className={`text-end tabular-nums ${good ? 'text-emerald-600 dark:text-emerald-400' : bad ? 'text-red-600 dark:text-red-400' : 'text-slate-500'}`}>
                          {ch === null ? t('New') : `${ch > 0 ? '+' : ''}${ch.toFixed(1)}%`}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 font-semibold dark:border-slate-800">
                  <td className="px-3 py-2.5">{t('Total')}</td>
                  <td className="px-3 py-2.5 text-end tabular-nums">{money(total)}</td>
                  {compare && <td className="px-3 py-2.5 text-end tabular-nums">{money(prevTotal)}</td>}
                  {compare && <td className="px-3 py-2.5 text-end tabular-nums">{(() => { const c = pctChange(total, prevTotal); return c === null ? t('New') : `${c > 0 ? '+' : ''}${c.toFixed(1)}%`; })()}</td>}
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
