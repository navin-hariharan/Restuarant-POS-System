import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BadgePercent, CircleDollarSign, Coins, Landmark, Receipt, ShoppingBag, TrendingUp, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import { useConfig, useT } from '@/providers/AppProviders';
import { Badge, PageHeader } from '@/components/ui';
import { FilterSelect, ReportFilters } from '@/components/reports/ReportFilters';
import { durationLabel, durationParams, emptyDuration, type DurationFilter } from '@/components/reports/duration';
import { ChartCard, ChartTooltip, KpiCard, ReportActions, ReportMeta, PrintTitle, compactNumber, useChartColors } from '@/components/reports/ReportKit';
import { LocalTable, type LocalColumn } from '@/components/reports/LocalTable';
import { downloadCsv } from '@/components/reports/export';
import { usePrintReport } from '@/components/reports/usePrintReport';

type SaleRow = {
  id: number;
  uuid: string;
  type: string | null;
  tracking: string;
  cart_total_price: number;
  cart_total_cost: number;
  payable_after_all: number;
  discount_rate: number;
  discount_amount: number;
  profit_after_all: number;
  tax_amount: number;
  customer: { name?: string; email?: string | null; phone?: string | null } | null;
  table: { id: number; title: string } | null;
  progress: number | string | null;
  created_at: string;
};

type SaleReport = {
  total_price_amount: number;
  total_cost_amount: number;
  total_discount_amount: number;
  total_payable_amount: number;
  /** (sic) backend key */
  totla_profit_amount: number;
  total_tax_amount: number;
  orders: number;
  list: SaleRow[];
};

type Person = { id: number; name: string };
type SaleFilters = {
  tables: { id: number; title: string }[];
  billers: Person[];
  takers: Person[];
  chefs: Person[];
  methods: { id: number; title: string }[];
};

const emptyExtra = { order_type: '', table: '', taker: '', chef: '', biller: '', payment_method: '' };

const num = (v: unknown) => Number(v) || 0;

export default function OverallSaleReport() {
  const t = useT();
  const { money, config } = useConfig();
  const colors = useChartColors();
  const [duration, setDuration] = useState<DurationFilter>(emptyDuration);
  const [extra, setExtra] = useState(emptyExtra);
  const params = { ...durationParams(duration), ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v)) };

  const filtersQ = useQuery({
    queryKey: ['sale.filters'],
    queryFn: async () => (await api.get<SaleFilters>('admin/sale.filters')).data,
  });
  const q = useQuery({
    queryKey: ['overall-sales-report', params],
    queryFn: async () => (await api.get<SaleReport>('admin/overall-sales-report', { params })).data,
    placeholderData: keepPreviousData,
  });
  const r = q.data;
  const list = r?.list ?? [];
  const title = t('Overall sale report');
  const { ref, printing, print } = usePrintReport(title);
  const period = durationLabel(duration, t);

  const byType = useMemo(() => {
    const m = new Map<string, { name: string; amount: number; orders: number }>();
    for (const s of list) {
      const k = s.type || t('Other');
      const e = m.get(k) ?? { name: k, amount: 0, orders: 0 };
      e.amount += num(s.payable_after_all);
      e.orders += 1;
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.amount - a.amount);
  }, [list, t]);

  const byDay = useMemo(() => {
    // created_at is formatted with the shop's date format; group on its date part.
    const m = new Map<string, number>();
    for (const s of list) {
      const day = String(s.created_at ?? '').split(/[ ,T]/)[0];
      m.set(day, (m.get(day) ?? 0) + num(s.payable_after_all));
    }
    return [...m.entries()].map(([day, amount]) => ({ day, amount }));
  }, [list]);

  const avg = r && r.orders ? num(r.total_payable_amount) / r.orders : 0;
  const margin = r && num(r.total_payable_amount) ? (num(r.totla_profit_amount) / num(r.total_payable_amount)) * 100 : 0;

  const columns: LocalColumn<SaleRow>[] = [
    {
      key: 'tracking',
      header: t('Tracking'),
      sortValue: (s) => s.tracking,
      cell: (s) => (
        <Link to={`/admin/sales/${s.uuid}/view`} className="font-medium text-brand-700 hover:underline dark:text-brand-300">
          #{s.tracking}
        </Link>
      ),
    },
    {
      key: 'type',
      header: t('Type'),
      sortValue: (s) => s.type ?? '',
      cell: (s) => (
        <span className="whitespace-nowrap">
          {s.type}
          {s.table ? <span className="text-slate-500"> · {s.table.title}</span> : null}
        </span>
      ),
    },
    { key: 'customer', header: t('Customer'), sortValue: (s) => s.customer?.name ?? '', cell: (s) => s.customer?.name ?? <span className="text-slate-400">{t('Walk-in')}</span> },
    { key: 'cart_total_price', header: t('Price'), sortValue: (s) => num(s.cart_total_price), cell: (s) => money(s.cart_total_price), className: 'text-end tabular-nums', headerClassName: 'text-end' },
    { key: 'cart_total_cost', header: t('Cost'), sortValue: (s) => num(s.cart_total_cost), cell: (s) => money(s.cart_total_cost), className: 'text-end tabular-nums', headerClassName: 'text-end' },
    { key: 'discount_amount', header: t('Discount'), sortValue: (s) => num(s.discount_amount), cell: (s) => money(s.discount_amount), className: 'text-end tabular-nums', headerClassName: 'text-end' },
    { key: 'tax_amount', header: t('Tax'), sortValue: (s) => num(s.tax_amount), cell: (s) => money(s.tax_amount), className: 'text-end tabular-nums', headerClassName: 'text-end' },
    { key: 'payable_after_all', header: t('Payable'), sortValue: (s) => num(s.payable_after_all), cell: (s) => <span className="font-medium">{money(s.payable_after_all)}</span>, className: 'text-end tabular-nums', headerClassName: 'text-end' },
    {
      key: 'profit_after_all',
      header: t('Profit'),
      sortValue: (s) => num(s.profit_after_all),
      cell: (s) => <span className={num(s.profit_after_all) < 0 ? 'text-red-600 dark:text-red-400' : ''}>{money(s.profit_after_all)}</span>,
      className: 'text-end tabular-nums',
      headerClassName: 'text-end',
    },
    { key: 'created_at', header: t('Date'), sortValue: (s) => s.id, cell: (s) => <span className="whitespace-nowrap text-slate-500">{s.created_at}</span> },
  ];

  const exportCsv = () =>
    downloadCsv(
      'sales_report',
      [t('ID'), t('Tracking'), t('Type'), t('Cart Total Price'), t('Cart Total Cost'), t('Payable After All'), t('Discount Rate'), t('Discount Amount'), t('Profit After All'), t('Tax Amount'), t('Customer Name'), t('Customer Email'), t('Customer Phone'), t('Progress'), t('Created at')],
      list.map((s) => [
        s.id,
        s.tracking,
        `${s.type ?? ''}${s.table ? ` (${s.table.title})` : ''}`,
        s.cart_total_price,
        s.cart_total_cost,
        s.payable_after_all,
        s.discount_rate,
        s.discount_amount,
        s.profit_after_all,
        s.tax_amount,
        s.customer?.name ?? '',
        s.customer?.email ?? '',
        s.customer?.phone ?? '',
        s.progress,
        s.created_at,
      ]),
    );

  const f = filtersQ.data;
  const people = (xs?: Person[]) => (xs ?? []).map((p) => ({ value: p.id, label: p.name }));
  const extraActive = Object.values(extra).some(Boolean);
  const setX = (k: keyof typeof emptyExtra) => (v: string) => setExtra((e) => ({ ...e, [k]: v }));

  return (
    <div>
      <PageHeader
        title={title}
        description={t('Completed (not cancelled) orders with totals, costs, taxes and profit.')}
        actions={<ReportActions onRefresh={() => q.refetch()} refreshing={q.isFetching} onCsv={exportCsv} disabled={!list.length} onPrint={print} />}
      />
      <ReportFilters value={duration} onChange={setDuration} extraActive={extraActive} onResetExtra={() => setExtra(emptyExtra)}>
        <FilterSelect label={t('Order type')} value={extra.order_type} onChange={setX('order_type')} options={(config.order_types ?? []).map((o) => ({ value: o.key, label: t(o.title) }))} />
        <FilterSelect label={t('Service table')} value={extra.table} onChange={setX('table')} options={(f?.tables ?? []).map((x) => ({ value: x.id, label: x.title }))} />
        <FilterSelect label={t('Payment method')} value={extra.payment_method} onChange={setX('payment_method')} options={(f?.methods ?? []).map((x) => ({ value: x.id, label: x.title }))} />
        <FilterSelect label={t('Order taker')} value={extra.taker} onChange={setX('taker')} options={people(f?.takers)} />
        <FilterSelect label={t('Chef')} value={extra.chef} onChange={setX('chef')} options={people(f?.chefs)} />
        <FilterSelect label={t('Biller')} value={extra.biller} onChange={setX('biller')} options={people(f?.billers)} />
      </ReportFilters>

      <div ref={ref} className="space-y-5">
        <PrintTitle title={title} subtitle={<ReportMeta period={period} generatedAt={q.dataUpdatedAt} />} />
        <div className="no-print">
          <ReportMeta period={period} generatedAt={q.dataUpdatedAt || undefined} />
        </div>
        <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 xl:grid-cols-4">
          <KpiCard loading={q.isLoading} label={t('Orders')} value={r?.orders ?? 0} icon={<ShoppingBag className="h-4 w-4" />} hint={r?.orders ? `${t('Avg.')} ${money(avg)}` : undefined} />
          <KpiCard loading={q.isLoading} label={t('Total Payable')} value={money(r?.total_payable_amount)} icon={<Wallet className="h-4 w-4" />} tone="green" />
          <KpiCard loading={q.isLoading} label={t('Profit')} value={money(r?.totla_profit_amount)} icon={<TrendingUp className="h-4 w-4" />} tone="purple" hint={r?.orders ? `${t('Margin')} ${margin.toFixed(1)}%` : undefined} />
          <KpiCard loading={q.isLoading} label={t('Total Tax')} value={money(r?.total_tax_amount)} icon={<Landmark className="h-4 w-4" />} tone="amber" />
          <KpiCard loading={q.isLoading} label={t('Cart Total Price')} value={money(r?.total_price_amount)} icon={<Receipt className="h-4 w-4" />} tone="gray" />
          <KpiCard loading={q.isLoading} label={t('Cart Total Cost')} value={money(r?.total_cost_amount)} icon={<Coins className="h-4 w-4" />} tone="gray" />
          <KpiCard loading={q.isLoading} label={t('Discount Amount')} value={money(r?.total_discount_amount)} icon={<BadgePercent className="h-4 w-4" />} tone="red" />
          <KpiCard loading={q.isLoading} label={t('Average order value')} value={money(avg)} icon={<CircleDollarSign className="h-4 w-4" />} tone="blue" />
        </div>

        {list.length > 0 && (
          <div className="grid gap-5 lg:grid-cols-3">
            <ChartCard className="lg:col-span-2" title={t('Sales trend')} subtitle={t('Payable amount per day')}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byDay} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={colors.grid} />
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: colors.axis }} tickLine={false} axisLine={{ stroke: colors.grid }} minTickGap={16} />
                  <YAxis tickFormatter={compactNumber} tick={{ fontSize: 11, fill: colors.axis }} tickLine={false} axisLine={false} width={48} />
                  <Tooltip cursor={{ fill: colors.grid, opacity: 0.5 }} content={<ChartTooltip format={money} />} />
                  <Bar dataKey="amount" name={t('Sales')} fill={colors.primary} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={!printing} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title={t('By order type')} subtitle={t('Payable amount')}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byType} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid horizontal={false} stroke={colors.grid} />
                  <XAxis type="number" tickFormatter={compactNumber} tick={{ fontSize: 11, fill: colors.axis }} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: colors.axis }} tickLine={false} axisLine={false} width={88} />
                  <Tooltip cursor={{ fill: colors.grid, opacity: 0.5 }} content={<ChartTooltip format={money} />} />
                  <Bar dataKey="amount" name={t('Sales')} radius={[0, 4, 4, 0]} maxBarSize={28} isAnimationActive={!printing}>
                    {byType.map((_, i) => (
                      <Cell key={i} fill={colors.series[i % colors.series.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        )}

        <LocalTable
          rows={list}
          columns={columns}
          rowKey={(s) => s.id}
          loading={q.isLoading}
          printAll={printing}
          searchText={(s) => `${s.tracking} ${s.customer?.name ?? ''} ${s.type ?? ''} ${s.table?.title ?? ''}`}
          searchPlaceholder={t('Search by tracking or customer')}
          initialSort={{ column: 'created_at', order: 'desc' }}
          toolbar={list.length ? <Badge tone="blue">{list.length} {t('Orders').toLowerCase()}</Badge> : undefined}
        />
      </div>
    </div>
  );
}
