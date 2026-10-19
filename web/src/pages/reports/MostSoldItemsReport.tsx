import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Medal } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useConfig, useT } from '@/providers/AppProviders';
import { DataTable, EmptyState, PageHeader, Pagination, SearchInput, useDebounced, type Column } from '@/components/ui';
import { FilterSelect, ReportFilters } from '@/components/reports/ReportFilters';
import { durationLabel, durationParams, emptyDuration, type DurationFilter } from '@/components/reports/duration';
import { ChartCard, ChartTooltip, PrintTitle, ReportActions, ReportMeta, useChartColors } from '@/components/reports/ReportKit';
import { downloadCsv } from '@/components/reports/export';
import { usePrintReport } from '@/components/reports/usePrintReport';

type Item = { food_item_id: number; sold_qty: number | string; price: number | string; item_name: string; image: string | null };
type Resp = { list: Item[]; pagination: { current_page: number; last_page: number; per_page: number; total: number } };

const num = (v: unknown) => Number(v) || 0;
const medal = ['text-amber-500', 'text-slate-400', 'text-orange-700'];

export default function MostSoldItemsReport() {
  const t = useT();
  const { money } = useConfig();
  const colors = useChartColors();
  const [duration, setDuration] = useState<DurationFilter>(emptyDuration);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 350);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [exporting, setExporting] = useState(false);
  const filters = { ...durationParams(duration), category: category || undefined, search: debounced || undefined };
  const params = { ...filters, page, per_page: perPage };

  const catsQ = useQuery({
    queryKey: ['food-categories-list'],
    queryFn: async () => (await api.get<{ id: number; name: string }[]>('admin/food-categories-list')).data,
  });
  const q = useQuery({
    queryKey: ['most-sold-items.report', params],
    queryFn: async () => (await api.get<Resp>('admin/most-sold-items.report', { params })).data,
    placeholderData: keepPreviousData,
  });
  const list = q.data?.list ?? [];
  const pg = q.data?.pagination;
  const offset = ((pg?.current_page ?? page) - 1) * (pg?.per_page ?? perPage);
  const title = t('Most sold items report');
  const { ref, printing, print } = usePrintReport(title);
  const period = durationLabel(duration, t);
  const resetPage = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };

  const columns: Column<Item>[] = [
    {
      key: 'rank',
      header: '#',
      cell: (i) => {
        const rank = offset + list.indexOf(i) + 1;
        return rank <= 3 ? (
          <span className="inline-flex items-center gap-1 font-semibold">
            <Medal className={`h-4 w-4 ${medal[rank - 1]}`} aria-hidden />
            {rank}
          </span>
        ) : (
          <span className="text-slate-500 tabular-nums">{rank}</span>
        );
      },
    },
    {
      key: 'item_name',
      header: t('Item'),
      cell: (i) => (
        <div className="flex items-center gap-3">
          {i.image ? <img src={i.image} alt="" className="h-9 w-9 rounded-lg object-cover" loading="lazy" /> : <span className="h-9 w-9 rounded-lg bg-slate-100 dark:bg-slate-800" />}
          <span className="font-medium">{i.item_name}</span>
        </div>
      ),
    },
    { key: 'price', header: t('Price'), cell: (i) => money(i.price), className: 'text-end tabular-nums', headerClassName: 'text-end' },
    { key: 'sold_qty', header: t('Sold quantity'), cell: (i) => <span className="font-semibold">{num(i.sold_qty).toLocaleString()}</span>, className: 'text-end tabular-nums', headerClassName: 'text-end' },
    {
      key: 'value',
      header: t('Estimated value'),
      cell: (i) => money(num(i.price) * num(i.sold_qty)),
      className: 'text-end tabular-nums text-slate-600 dark:text-slate-300',
      headerClassName: 'text-end',
    },
  ];

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all = (await api.get<Resp>('admin/most-sold-items.report', { params: { ...filters, page: 1, per_page: 100000 } })).data.list;
      if (!all.length) {
        toast.info(t('No data to export!'));
        return;
      }
      downloadCsv(
        'most_sold_items',
        [t('Rank'), t('Item ID'), t('Item'), t('Price'), t('Sold quantity')],
        all.map((i, idx) => [idx + 1, i.food_item_id, i.item_name, i.price, i.sold_qty]),
      );
    } finally {
      setExporting(false);
    }
  };

  const chart = list.slice(0, 10).map((i) => ({ name: i.item_name, qty: num(i.sold_qty) }));

  return (
    <div>
      <PageHeader
        title={title}
        description={t('Food items ranked by quantity sold.')}
        actions={
          <ReportActions onRefresh={() => q.refetch()} refreshing={q.isFetching || exporting} disabled={!list.length || exporting} onCsv={exportCsv} onPrint={print} />
        }
      />
      <ReportFilters
        value={duration}
        onChange={resetPage(setDuration)}
        extraActive={!!category || !!search}
        onResetExtra={() => {
          setCategory('');
          setSearch('');
        }}
      >
        <FilterSelect label={t('Category')} value={category} onChange={resetPage(setCategory)} options={(catsQ.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        <div>
          <span className="label">{t('Item name')}</span>
          <SearchInput value={search} onChange={resetPage(setSearch)} placeholder={t('Search items')} />
        </div>
      </ReportFilters>

      <div ref={ref} className="space-y-5">
        <PrintTitle title={title} subtitle={<ReportMeta period={period} generatedAt={q.dataUpdatedAt} />} />
        <div className="no-print">
          <ReportMeta period={period} generatedAt={q.dataUpdatedAt || undefined} />
        </div>
        {page === 1 && list.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-3">
            {list.slice(0, 3).map((i, idx) => (
              <div key={i.food_item_id} className="card flex items-center gap-3 p-4">
                {i.image ? <img src={i.image} alt="" className="h-14 w-14 rounded-xl object-cover" /> : <span className="h-14 w-14 rounded-xl bg-slate-100 dark:bg-slate-800" />}
                <div className="min-w-0">
                  <p className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                    <Medal className={`h-3.5 w-3.5 ${medal[idx]}`} aria-hidden /> #{idx + 1}
                  </p>
                  <p className="truncate font-semibold">{i.item_name}</p>
                  <p className="text-sm text-slate-500">
                    <span className="font-semibold tabular-nums text-slate-900 dark:text-white">{num(i.sold_qty).toLocaleString()}</span> {t('sold')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
        {chart.length > 1 && (
          <ChartCard title={t('Top items')} subtitle={t('Sold quantity')} height={chart.length > 5 ? 'h-80' : 'h-56'}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid horizontal={false} stroke={colors.grid} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: colors.axis }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: colors.axis }} tickLine={false} axisLine={false} width={120} />
                <Tooltip cursor={{ fill: colors.grid, opacity: 0.5 }} content={<ChartTooltip format={(v) => num(v).toLocaleString()} />} />
                <Bar dataKey="qty" name={t('Sold quantity')} fill={colors.primary} radius={[0, 4, 4, 0]} maxBarSize={24} isAnimationActive={!printing} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        )}
        <DataTable
          columns={columns}
          rows={list}
          rowKey={(i) => i.food_item_id}
          loading={q.isLoading}
          empty={<EmptyState description={t('No sales were found for the selected filters.')} />}
          footer={
            pg && pg.total > 0 ? (
              <div className="border-t border-slate-200 no-print dark:border-slate-800">
                <Pagination
                  page={pg.current_page}
                  totalPages={pg.last_page}
                  total={pg.total}
                  perPage={perPage}
                  onPage={setPage}
                  onPerPage={(n) => {
                    setPerPage(n);
                    setPage(1);
                  }}
                />
              </div>
            ) : null
          }
        />
      </div>
    </div>
  );
}
