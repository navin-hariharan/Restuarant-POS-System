import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowUpWideNarrow, Calculator, CreditCard, Hash } from 'lucide-react';
import { api } from '@/lib/api';
import { useConfig, useT } from '@/providers/AppProviders';
import { PageHeader } from '@/components/ui';
import { FilterSelect, ReportFilters } from '@/components/reports/ReportFilters';
import { durationLabel, durationParams, emptyDuration, type DurationFilter } from '@/components/reports/duration';
import { ChartCard, ChartTooltip, KpiCard, PrintTitle, ReportActions, ReportMeta, compactNumber, useChartColors } from '@/components/reports/ReportKit';
import { LocalTable, type LocalColumn } from '@/components/reports/LocalTable';
import { downloadCsv } from '@/components/reports/export';
import { usePrintReport } from '@/components/reports/usePrintReport';

type ExpenseRow = { id: number; title: string; amount: number; created_at: string; updated_at: string };
type ExpenseReport = { total_amount: number; orders: number; list: ExpenseRow[] };

const num = (v: unknown) => Number(v) || 0;

export default function OverallExpenseReport() {
  const t = useT();
  const { money } = useConfig();
  const colors = useChartColors();
  const [duration, setDuration] = useState<DurationFilter>(emptyDuration);
  const [category, setCategory] = useState('');
  const params = { ...durationParams(duration), category: category || undefined };

  const typesQ = useQuery({
    queryKey: ['expense-types.list'],
    queryFn: async () => (await api.get<{ id: number; title: string }[]>('admin/expense-types.list')).data,
  });
  const q = useQuery({
    queryKey: ['overall-expenses-report', params],
    queryFn: async () => (await api.get<ExpenseReport>('admin/overall-expenses-report', { params })).data,
    placeholderData: keepPreviousData,
  });
  const r = q.data;
  const list = r?.list ?? [];
  const title = t('Overall expense report');
  const { ref, printing, print } = usePrintReport(title);
  const period = durationLabel(duration, t);
  const typeName = typesQ.data?.find((x) => String(x.id) === category)?.title;

  const byDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of list) {
      const day = String(e.created_at ?? '').split(/[ ,T]/)[0];
      m.set(day, (m.get(day) ?? 0) + num(e.amount));
    }
    return [...m.entries()].map(([day, amount]) => ({ day, amount }));
  }, [list]);
  const largest = list.reduce<ExpenseRow | null>((m, e) => (!m || num(e.amount) > num(m.amount) ? e : m), null);
  const avg = list.length ? num(r?.total_amount) / list.length : 0;

  const columns: LocalColumn<ExpenseRow>[] = [
    { key: 'id', header: t('ID'), sortValue: (e) => e.id, cell: (e) => <span className="text-slate-500">#{e.id}</span> },
    { key: 'title', header: t('Title'), sortValue: (e) => e.title, cell: (e) => <span className="font-medium">{e.title}</span> },
    { key: 'amount', header: t('Amount'), sortValue: (e) => num(e.amount), cell: (e) => money(e.amount), className: 'text-end tabular-nums', headerClassName: 'text-end' },
    { key: 'created_at', header: t('Date'), sortValue: (e) => e.id, cell: (e) => <span className="whitespace-nowrap text-slate-500">{e.created_at}</span> },
  ];

  return (
    <div>
      <PageHeader
        title={title}
        description={t('All recorded expenses for the selected period.')}
        actions={
          <ReportActions
            onRefresh={() => q.refetch()}
            refreshing={q.isFetching}
            disabled={!list.length}
            onCsv={() => downloadCsv('expense_report', [t('ID'), t('Title'), t('Amount'), t('Created at')], list.map((e) => [e.id, e.title, e.amount, e.created_at]))}
            onPrint={print}
          />
        }
      />
      <ReportFilters value={duration} onChange={setDuration} extraActive={!!category} onResetExtra={() => setCategory('')}>
        <FilterSelect label={t('Expense type')} value={category} onChange={setCategory} options={(typesQ.data ?? []).map((x) => ({ value: x.id, label: x.title }))} />
      </ReportFilters>

      <div ref={ref} className="space-y-5">
        <PrintTitle title={title} subtitle={<ReportMeta period={`${period}${typeName ? ` · ${typeName}` : ''}`} generatedAt={q.dataUpdatedAt} />} />
        <div className="no-print">
          <ReportMeta period={`${period}${typeName ? ` · ${typeName}` : ''}`} generatedAt={q.dataUpdatedAt || undefined} />
        </div>
        <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 xl:grid-cols-4">
          <KpiCard loading={q.isLoading} label={t('Total Expenses')} value={money(r?.total_amount)} icon={<CreditCard className="h-4 w-4" />} tone="red" />
          <KpiCard loading={q.isLoading} label={t('Records')} value={r?.orders ?? 0} icon={<Hash className="h-4 w-4" />} tone="gray" />
          <KpiCard loading={q.isLoading} label={t('Average')} value={money(avg)} icon={<Calculator className="h-4 w-4" />} tone="blue" />
          <KpiCard loading={q.isLoading} label={t('Largest expense')} value={money(largest?.amount)} icon={<ArrowUpWideNarrow className="h-4 w-4" />} tone="amber" hint={largest?.title} />
        </div>
        {list.length > 0 && (
          <ChartCard title={t('Expense trend')} subtitle={t('Expense amount per day')}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byDay} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={colors.grid} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: colors.axis }} tickLine={false} axisLine={{ stroke: colors.grid }} minTickGap={16} />
                <YAxis tickFormatter={compactNumber} tick={{ fontSize: 11, fill: colors.axis }} tickLine={false} axisLine={false} width={48} />
                <Tooltip cursor={{ fill: colors.grid, opacity: 0.5 }} content={<ChartTooltip format={money} />} />
                <Bar dataKey="amount" name={t('Expense amount')} fill={colors.series[1]} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={!printing} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        )}
        <LocalTable
          rows={list}
          columns={columns}
          rowKey={(e) => e.id}
          loading={q.isLoading}
          printAll={printing}
          searchText={(e) => e.title}
          initialSort={{ column: 'created_at', order: 'desc' }}
          footer={
            list.length ? (
              <div className="flex justify-between border-t border-slate-200 px-3 py-2.5 text-sm font-semibold dark:border-slate-800">
                <span>{t('Total')}</span>
                <span className="tabular-nums">{money(r?.total_amount)}</span>
              </div>
            ) : null
          }
        />
      </div>
    </div>
  );
}
