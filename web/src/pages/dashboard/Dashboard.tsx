import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  ArrowRight, BadgePercent, CalendarX, Coins, CreditCard, HandCoins, Landmark, PiggyBank, Receipt, RefreshCw, ShoppingCart,
  TrendingUp, TriangleAlert, Wallet,
} from 'lucide-react';
import { api } from '@/lib/api';
import { storage } from '@/lib/format';
import { useAuth, useConfig, useT } from '@/providers/AppProviders';
import { Button, Card, EmptyState, PageHeader, Skeleton, Tabs } from '@/components/ui';
import { ChartCard, ChartLegend, ChartTooltip, KpiCard, compactNumber, pctChange, useChartColors } from '@/components/reports/ReportKit';
import { MONTH_KEYS } from '@/components/reports/duration';

type Duration = 'day' | 'month' | 'year';

type SoldItem = {
  id: number;
  item_name: string;
  price: number;
  quantity: number;
  total_amount: number;
  category: { id: number; name: string } | null;
  image: string | null;
  created_at: string;
};

type States = {
  total_price_amount: number;
  last_total_price_amount: number;
  total_cost_amount: number;
  last_total_cost_amount: number;
  total_discount_amount: number;
  last_total_discount_amount: number;
  total_payable_amount: number;
  last_total_payable_amount: number;
  total_profit_amount: number;
  last_total_profit_amount: number;
  total_tax_amount: number;
  last_total_tax_amount: number;
  total_tip_amount: number;
  last_total_tip_amount: number;
  expense_amount: number;
  last_expense_amount: number;
  chart: number[];
  last_chart: number[];
  last_sold_items: SoldItem[];
};

const num = (v: unknown) => Number(v) || 0;
const DURATION_KEY = 'dashboard_duration';

function useStates(duration: Duration, enabled = true) {
  return useQuery({
    queryKey: ['dashboard-states', duration],
    queryFn: async () => (await api.get<States>('admin/dashboard-states', { params: { is_duration: duration } })).data,
    placeholderData: keepPreviousData,
    enabled,
    refetchInterval: 60_000,
  });
}

export default function Dashboard() {
  const t = useT();
  const { money, config } = useConfig();
  const { user, can } = useAuth();
  const colors = useChartColors();
  const [duration, setDurationState] = useState<Duration>(() => storage.get<Duration>(DURATION_KEY, 'month'));
  const setDuration = (d: Duration) => {
    storage.set(DURATION_KEY, d);
    setDurationState(d);
  };

  const q = useStates(duration);
  // The monthly chart always shows the whole year, whatever period the KPIs use.
  const yearQ = useStates('year');
  const s = q.data;
  const loading = q.isLoading;

  const prevLabel = duration === 'day' ? t('Yesterday') : duration === 'month' ? t('Last month') : t('Last year');
  const periodLabel = duration === 'day' ? t('Today') : duration === 'month' ? t('This month') : t('This year');
  const vs = (v: unknown) => `${t('vs')} ${money(v)}`;

  const netProfit = num(s?.total_profit_amount) - num(s?.expense_amount);
  const lastNetProfit = num(s?.last_total_profit_amount) - num(s?.last_expense_amount);
  const showTips = config.modes.customer_tip_collection || num(s?.total_tip_amount) > 0 || num(s?.last_total_tip_amount) > 0;

  const thisYear = new Date().getFullYear();
  const monthly = useMemo(
    () =>
      MONTH_KEYS.map((m, i) => ({
        month: t(m),
        current: num(yearQ.data?.chart?.[i]),
        previous: num(yearQ.data?.last_chart?.[i]),
      })),
    [yearQ.data, t],
  );
  const hasMonthly = monthly.some((m) => m.current || m.previous);

  const breakdown = useMemo(() => {
    if (!s) return [];
    const parts = [
      { name: t('Cost'), value: num(s.total_cost_amount), color: colors.series[1] },
      { name: t('Profit'), value: num(s.total_profit_amount), color: colors.series[2] },
      { name: t('Tax'), value: num(s.total_tax_amount), color: colors.series[3] },
      { name: t('Tip'), value: num(s.total_tip_amount), color: colors.series[6] },
    ];
    return parts.filter((p) => p.value > 0);
  }, [s, t, colors]);

  const stockQ = useQuery({
    queryKey: ['stock-alerts'],
    queryFn: async () => (await api.get<unknown[]>('admin/stock-alerts', { silent: true })).data,
    enabled: can('stock_alerts'),
  });
  const expiryEnabled = config.modes.allow_expiry_date && can('expiry_alerts');
  const expiryQ = useQuery({
    queryKey: ['expiry-alerts'],
    queryFn: async () => (await api.get<{ is_expired: boolean }[]>('admin/expiry-alerts', { silent: true })).data,
    enabled: expiryEnabled,
  });

  const hour = new Date().getHours();
  const greeting = hour < 12 ? t('Good morning') : hour < 18 ? t('Good afternoon') : t('Good evening');

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('Dashboard')}
        description={user ? `${greeting}, ${user.name.split(' ')[0]}` : undefined}
        actions={
          <>
            <Tabs<Duration>
              value={duration}
              onChange={setDuration}
              tabs={[
                { value: 'day', label: t('Today') },
                { value: 'month', label: t('This month') },
                { value: 'year', label: t('This year') },
              ]}
            />
            <Button
              size="icon"
              variant="ghost"
              aria-label={t('Refresh')}
              title={t('Refresh')}
              onClick={() => {
                q.refetch();
                yearQ.refetch();
              }}
              icon={<RefreshCw className={`h-4 w-4 ${q.isFetching ? 'animate-spin' : ''}`} />}
            />
          </>
        }
      />

      {/* Alerts strip */}
      {((stockQ.data?.length ?? 0) > 0 || (expiryQ.data?.length ?? 0) > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {(stockQ.data?.length ?? 0) > 0 && (
            <AlertLink
              to="/admin/stock-alerts"
              icon={<TriangleAlert className="h-5 w-5" />}
              title={t(':count ingredients are running low', { count: stockQ.data!.length })}
              text={t('Review stock alerts')}
            />
          )}
          {(expiryQ.data?.length ?? 0) > 0 && (
            <AlertLink
              to="/admin/expiry-alerts"
              icon={<CalendarX className="h-5 w-5" />}
              title={t(':count food items expired or expiring', { count: expiryQ.data!.length })}
              text={t('Review expiry alerts')}
            />
          )}
        </div>
      )}

      {/* Headline KPIs */}
      <section aria-label={t('Key figures')} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          loading={loading}
          label={t('Sales amount')}
          value={money(s?.total_payable_amount)}
          icon={<Wallet className="h-4 w-4" />}
          tone="blue"
          delta={s ? pctChange(s.total_payable_amount, s.last_total_payable_amount) : undefined}
          previous={s ? `${prevLabel}: ${money(s.last_total_payable_amount)}` : undefined}
        />
        <KpiCard
          loading={loading}
          label={t('Profit')}
          value={money(s?.total_profit_amount)}
          icon={<TrendingUp className="h-4 w-4" />}
          tone="green"
          delta={s ? pctChange(s.total_profit_amount, s.last_total_profit_amount) : undefined}
          previous={s ? vs(s.last_total_profit_amount) : undefined}
        />
        <KpiCard
          loading={loading}
          label={t('Total Expenses')}
          value={money(s?.expense_amount)}
          icon={<CreditCard className="h-4 w-4" />}
          tone="red"
          lowerIsBetter
          delta={s ? pctChange(s.expense_amount, s.last_expense_amount) : undefined}
          previous={s ? vs(s.last_expense_amount) : undefined}
        />
        <KpiCard
          loading={loading}
          label={t('Profit after expenses')}
          value={<span className={netProfit < 0 ? 'text-red-600 dark:text-red-400' : undefined}>{money(netProfit)}</span>}
          icon={<PiggyBank className="h-4 w-4" />}
          tone="purple"
          delta={s ? pctChange(netProfit, lastNetProfit) : undefined}
          previous={s ? vs(lastNetProfit) : undefined}
        />
      </section>

      {/* Secondary KPIs */}
      <section aria-label={t('Details')} className={`grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 md:grid-cols-3 ${showTips ? 'xl:grid-cols-5' : 'xl:grid-cols-4'}`}>
        <MiniStat loading={loading} icon={<Receipt className="h-4 w-4" />} label={t('Cart Total Price')} value={money(s?.total_price_amount)} delta={s && pctChange(s.total_price_amount, s.last_total_price_amount)} />
        <MiniStat loading={loading} icon={<Coins className="h-4 w-4" />} label={t('Cart Total Cost')} value={money(s?.total_cost_amount)} delta={s && pctChange(s.total_cost_amount, s.last_total_cost_amount)} lowerIsBetter />
        <MiniStat loading={loading} icon={<BadgePercent className="h-4 w-4" />} label={t('Discount')} value={money(s?.total_discount_amount)} delta={s && pctChange(s.total_discount_amount, s.last_total_discount_amount)} lowerIsBetter />
        <MiniStat loading={loading} icon={<Landmark className="h-4 w-4" />} label={t('Tax')} value={money(s?.total_tax_amount)} delta={s && pctChange(s.total_tax_amount, s.last_total_tax_amount)} />
        {showTips && <MiniStat loading={loading} icon={<HandCoins className="h-4 w-4" />} label={t('Customer tip amount')} value={money(s?.total_tip_amount)} delta={s && pctChange(s.total_tip_amount, s.last_total_tip_amount)} />}
      </section>

      {/* Charts */}
      <div className="grid gap-5 lg:grid-cols-3">
        <ChartCard
          className="lg:col-span-2"
          title={t('Sales by month')}
          subtitle={t('Completed orders, payable amount')}
          actions={<ChartLegend items={[{ label: String(thisYear), color: colors.primary }, { label: String(thisYear - 1), color: colors.previous }]} />}
        >
          {yearQ.isLoading ? (
            <Skeleton className="h-full w-full" />
          ) : !hasMonthly ? (
            <EmptyState icon={<ShoppingCart className="h-6 w-6" />} title={t('No sales yet')} description={t('Completed orders will appear here.')} />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthly} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barGap={2}>
                <CartesianGrid vertical={false} stroke={colors.grid} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: colors.axis }} tickLine={false} axisLine={{ stroke: colors.grid }} />
                <YAxis tickFormatter={compactNumber} tick={{ fontSize: 11, fill: colors.axis }} tickLine={false} axisLine={false} width={48} />
                <Tooltip cursor={{ fill: colors.grid, opacity: 0.5 }} content={<ChartTooltip format={money} />} />
                <Bar dataKey="previous" name={String(thisYear - 1)} fill={colors.previous} radius={[4, 4, 0, 0]} maxBarSize={20} />
                <Bar dataKey="current" name={String(thisYear)} fill={colors.primary} radius={[4, 4, 0, 0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title={t('Revenue breakdown')} subtitle={periodLabel} height="h-72">
          {loading ? (
            <Skeleton className="h-full w-full" />
          ) : !breakdown.length ? (
            <EmptyState title={t('No data found')} description={t('Nothing sold in this period.')} />
          ) : (
            <div className="flex h-full flex-col">
              <div className="relative min-h-0 flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={breakdown} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="90%" paddingAngle={2} stroke={colors.surface} strokeWidth={2}>
                      {breakdown.map((b) => (
                        <Cell key={b.name} fill={b.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip format={money} />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className="text-xs text-slate-500">{t('Sales amount')}</span>
                  <span className="text-base font-semibold tabular-nums">{money(s?.total_payable_amount)}</span>
                </div>
              </div>
              <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                {breakdown.map((b) => (
                  <li key={b.name} className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-xs" style={{ background: b.color }} aria-hidden />
                    <span className="text-slate-600 dark:text-slate-300">{b.name}</span>
                    <span className="ms-auto font-medium tabular-nums">{money(b.value)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </ChartCard>
      </div>

      {/* Recent items + shortcuts */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card
          className="lg:col-span-2"
          title={t('Last sold items')}
          bodyClassName="p-0"
          actions={
            can('manage_sales') ? (
              <Link to="/admin/sales" className="inline-flex items-center gap-1 text-xs font-medium pointer-coarse:min-h-10 text-brand-700 hover:underline dark:text-brand-300">
                {t('View all')} <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" />
              </Link>
            ) : undefined
          }
        >
          {loading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !s?.last_sold_items?.length ? (
            <EmptyState icon={<ShoppingCart className="h-6 w-6" />} title={t('No sales yet')} />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {s.last_sold_items.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-4 py-2.5">
                  {i.image ? (
                    <img src={i.image} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" loading="lazy" />
                  ) : (
                    <span className="h-10 w-10 shrink-0 rounded-lg bg-slate-100 dark:bg-slate-800" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{i.item_name}</p>
                    <p className="truncate text-xs text-slate-500">
                      {i.category?.name ? `${i.category.name} · ` : ''}
                      {i.created_at}
                    </p>
                  </div>
                  <div className="text-end">
                    <p className="text-sm font-semibold tabular-nums">{money(i.total_amount)}</p>
                    <p className="text-xs text-slate-500 tabular-nums">
                      {num(i.quantity)} × {money(i.price)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={t('Shortcuts')}>
          <ul className="space-y-1">
            {[
              { to: '/admin/pos', label: 'Point of sale', gate: 'pos_portal' },
              { to: '/admin/overall-sale-report', label: 'Sales report', gate: 'overall_sale_report' },
              { to: '/admin/most-sold-items-report', label: 'Most sold items', gate: 'most_sold_items_report' },
              { to: '/admin/category-based-report', label: 'Category report', gate: 'category_based_report' },
              { to: '/admin/overall-expense-report', label: 'Expense summary', gate: 'overall_expense_report' },
              { to: '/admin/tax-report', label: 'Tax report', gate: 'tax_report' },
              { to: '/admin/expenses', label: 'Expenses', gate: 'manage_expenses' },
            ]
              .filter((l) => can(l.gate))
              .map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className="flex items-center justify-between rounded-lg px-3 py-2 text-sm pointer-coarse:min-h-10 hover:bg-slate-100 dark:hover:bg-slate-800">
                    {t(l.label)}
                    <ArrowRight className="h-4 w-4 text-slate-400 rtl:rotate-180" />
                  </Link>
                </li>
              ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function MiniStat({
  icon,
  label,
  value,
  delta,
  lowerIsBetter,
  loading,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  delta?: number | null | undefined;
  lowerIsBetter?: boolean;
  loading?: boolean;
}) {
  const t = useT();
  const up = delta === null || (delta !== undefined && delta > 0.05);
  const down = delta !== undefined && delta !== null && delta < -0.05;
  const good = lowerIsBetter ? down : up;
  const bad = lowerIsBetter ? up : down;
  return (
    <div className="card flex items-center gap-3 p-3">
      <span className="rounded-lg bg-slate-100 p-2 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs leading-tight text-slate-500 dark:text-slate-400">{label}</p>
        {loading ? <Skeleton className="mt-1 h-5 w-20" /> : <p className="font-semibold tabular-nums wrap-anywhere">{value}</p>}
      </div>
      {delta !== undefined && !loading && (
        <span className={`ms-auto text-xs font-medium tabular-nums ${good ? 'text-emerald-600 dark:text-emerald-400' : bad ? 'text-red-600 dark:text-red-400' : 'text-slate-400'}`}>
          {delta === null ? t('New') : `${delta > 0 ? '+' : ''}${delta.toFixed(0)}%`}
        </span>
      )}
    </div>
  );
}

function AlertLink({ to, icon, title, text }: { to: string; icon: ReactNode; title: string; text: string }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 transition hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950/70"
    >
      {icon}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{title}</p>
        <p className="text-xs opacity-80">{text}</p>
      </div>
      <ArrowRight className="h-4 w-4 rtl:rotate-180" />
    </Link>
  );
}
