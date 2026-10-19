import { Fragment, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChevronDown, ChevronsDownUp, ChevronsUpDown, Crown, Layers, Package, Wallet } from 'lucide-react';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { useConfig, useT } from '@/providers/AppProviders';
import { Button, EmptyState, PageHeader, SearchInput, Skeleton, useDebounced } from '@/components/ui';
import { FilterSelect, ReportFilters } from '@/components/reports/ReportFilters';
import { durationLabel, durationParams, emptyDuration, type DurationFilter } from '@/components/reports/duration';
import { ChartCard, ChartTooltip, KpiCard, PrintTitle, ReportActions, ReportMeta, compactNumber, useChartColors } from '@/components/reports/ReportKit';
import { downloadCsv } from '@/components/reports/export';
import { usePrintReport } from '@/components/reports/usePrintReport';

type CategoryItem = { item_name: string; total_sold_qty: number; unit_price: number; total: number; last_sold_at: string | null };
type CategoryRow = {
  category_id: number | null;
  category_name: string | null;
  items: CategoryItem[];
  total_amount: number;
  total_sold_items: number;
};

const num = (v: unknown) => Number(v) || 0;

export default function CategoryReport() {
  const t = useT();
  const { money } = useConfig();
  const colors = useChartColors();
  const [duration, setDuration] = useState<DurationFilter>(emptyDuration);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 350);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const params = { ...durationParams(duration), category: category || undefined, search: debounced || undefined };

  const catsQ = useQuery({
    queryKey: ['food-categories-list'],
    queryFn: async () => (await api.get<{ id: number; name: string }[]>('admin/food-categories-list')).data,
  });
  const q = useQuery({
    queryKey: ['overall-category-report', params],
    queryFn: async () => (await api.get<CategoryRow[]>('admin/overall-category-report', { params })).data,
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => [...(q.data ?? [])].sort((a, b) => num(b.total_amount) - num(a.total_amount)), [q.data]);
  const title = t('Category based report');
  const { ref, printing, print } = usePrintReport(title);
  const period = durationLabel(duration, t);

  const total = rows.reduce((s, r) => s + num(r.total_amount), 0);
  const qty = rows.reduce((s, r) => s + num(r.total_sold_items), 0);
  const top = rows[0];
  const keyOf = (r: CategoryRow) => String(r.category_id ?? 'none');
  const allOpen = rows.length > 0 && rows.every((r) => open.has(keyOf(r)));
  const toggle = (k: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const chartData = useMemo(() => {
    const named = rows.map((r) => ({ name: r.category_name ?? t('Uncategorized'), amount: num(r.total_amount) }));
    if (named.length <= 8) return named;
    const head = named.slice(0, 7);
    head.push({ name: t('Other'), amount: named.slice(7).reduce((s, x) => s + x.amount, 0) });
    return head;
  }, [rows, t]);

  const exportCsv = () =>
    downloadCsv(
      'category_report',
      [t('Category'), t('Item'), t('Sold quantity'), t('Unit price'), t('Total'), t('Last sold at')],
      rows.flatMap((r) => r.items.map((i) => [r.category_name ?? '', i.item_name, i.total_sold_qty, i.unit_price, i.total, i.last_sold_at ?? ''])),
    );

  return (
    <div>
      <PageHeader
        title={title}
        description={t('Revenue and quantities sold, grouped by food category.')}
        actions={<ReportActions onRefresh={() => q.refetch()} refreshing={q.isFetching} disabled={!rows.length} onCsv={exportCsv} onPrint={print} />}
      />
      <ReportFilters value={duration} onChange={setDuration} extraActive={!!category || !!search} onResetExtra={() => { setCategory(''); setSearch(''); }}>
        <FilterSelect label={t('Category')} value={category} onChange={setCategory} options={(catsQ.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        <div>
          <span className="label">{t('Item name')}</span>
          <SearchInput value={search} onChange={setSearch} placeholder={t('Search items')} />
        </div>
      </ReportFilters>

      <div ref={ref} className="space-y-5">
        <PrintTitle title={title} subtitle={<ReportMeta period={period} generatedAt={q.dataUpdatedAt} />} />
        <div className="no-print">
          <ReportMeta period={period} generatedAt={q.dataUpdatedAt || undefined} />
        </div>
        <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 xl:grid-cols-4">
          <KpiCard loading={q.isLoading} label={t('Total revenue')} value={money(total)} icon={<Wallet className="h-4 w-4" />} tone="green" />
          <KpiCard loading={q.isLoading} label={t('Items sold')} value={qty.toLocaleString()} icon={<Package className="h-4 w-4" />} />
          <KpiCard loading={q.isLoading} label={t('Categories')} value={rows.length} icon={<Layers className="h-4 w-4" />} tone="gray" />
          <KpiCard
            loading={q.isLoading}
            label={t('Top category')}
            value={<span className="block truncate text-lg">{top?.category_name ?? '—'}</span>}
            icon={<Crown className="h-4 w-4" />}
            tone="amber"
            hint={top && total ? `${money(top.total_amount)} · ${((num(top.total_amount) / total) * 100).toFixed(0)}%` : undefined}
          />
        </div>

        {rows.length > 0 && (
          <ChartCard title={t('Revenue by category')} height={chartData.length > 4 ? 'h-80' : 'h-56'}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid horizontal={false} stroke={colors.grid} />
                <XAxis type="number" tickFormatter={compactNumber} tick={{ fontSize: 11, fill: colors.axis }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: colors.axis }} tickLine={false} axisLine={false} width={110} />
                <Tooltip cursor={{ fill: colors.grid, opacity: 0.5 }} content={<ChartTooltip format={money} />} />
                <Bar dataKey="amount" name={t('Revenue')} radius={[0, 4, 4, 0]} maxBarSize={26} isAnimationActive={!printing}>
                  {chartData.map((_, i) => (
                    <Cell key={i} fill={colors.series[i]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        )}

        <section className="card overflow-hidden">
          <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <h2 className="text-sm font-semibold">{t('Categories')}</h2>
            {rows.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="no-print"
                icon={allOpen ? <ChevronsDownUp className="h-4 w-4" /> : <ChevronsUpDown className="h-4 w-4" />}
                onClick={() => setOpen(allOpen ? new Set() : new Set(rows.map(keyOf)))}
              >
                {allOpen ? t('Collapse all') : t('Expand all')}
              </Button>
            )}
          </header>
          {q.isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : !rows.length ? (
            <EmptyState description={t('No sales were found for the selected filters.')} />
          ) : (
            <div className="relative overflow-x-auto">
              <table className="table-base">
                <thead className="bg-slate-50 dark:bg-slate-900/60">
                  <tr>
                    <th>{t('Category')} / {t('Item')}</th>
                    <th className="text-end">{t('Sold quantity')}</th>
                    <th className="text-end">{t('Unit price')}</th>
                    <th className="text-end">{t('Total')}</th>
                    <th className="text-end">{t('Share')}</th>
                    <th>{t('Last sold at')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {rows.map((r) => {
                    const k = keyOf(r);
                    const isOpen = open.has(k) || printing;
                    const share = total ? (num(r.total_amount) / total) * 100 : 0;
                    return (
                      <Fragment key={k}>
                        <tr className="bg-slate-50/50 dark:bg-slate-900/30">
                          <td>
                            <button
                              type="button"
                              className="tap flex items-center gap-2 font-semibold"
                              aria-expanded={isOpen}
                              onClick={() => toggle(k)}
                            >
                              <ChevronDown className={clsx('h-4 w-4 transition no-print', !isOpen && '-rotate-90 rtl:rotate-90')} />
                              {r.category_name ?? t('Uncategorized')}
                              <span className="chip bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{r.items.length}</span>
                            </button>
                          </td>
                          <td className="text-end font-semibold tabular-nums">{num(r.total_sold_items).toLocaleString()}</td>
                          <td />
                          <td className="text-end font-semibold tabular-nums">{money(r.total_amount)}</td>
                          <td className="text-end">
                            <div className="flex items-center justify-end gap-2">
                              <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700 sm:block" aria-hidden>
                                <div className="h-full rounded-full bg-brand-500" style={{ width: `${share}%` }} />
                              </div>
                              <span className="tabular-nums text-slate-500">{share.toFixed(1)}%</span>
                            </div>
                          </td>
                          <td />
                        </tr>
                        {isOpen &&
                          [...r.items]
                            .sort((a, b) => num(b.total) - num(a.total))
                            .map((i, idx) => (
                              <tr key={`${k}-${idx}`}>
                                <td className="ps-10">{i.item_name}</td>
                                <td className="text-end tabular-nums">{num(i.total_sold_qty).toLocaleString()}</td>
                                <td className="text-end tabular-nums">{money(i.unit_price)}</td>
                                <td className="text-end tabular-nums">{money(i.total)}</td>
                                <td />
                                <td className="whitespace-nowrap text-slate-500">{i.last_sold_at ?? '—'}</td>
                              </tr>
                            ))}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-200 font-semibold dark:border-slate-800">
                    <td className="px-3 py-2.5">{t('Total')}</td>
                    <td className="px-3 py-2.5 text-end tabular-nums">{qty.toLocaleString()}</td>
                    <td />
                    <td className="px-3 py-2.5 text-end tabular-nums">{money(total)}</td>
                    <td />
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
