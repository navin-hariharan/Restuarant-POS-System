import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BadgePercent, Banknote, CreditCard, Landmark, LockKeyhole, LockKeyholeOpen, Package, ShoppingBag, TrendingUp, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth, useConfig, useT } from '@/providers/AppProviders';
import { Badge, EmptyState, PageHeader, Spinner } from '@/components/ui';
import { KpiCard, PrintTitle, ReportActions } from '@/components/reports/ReportKit';
import { LocalTable, type LocalColumn } from '@/components/reports/LocalTable';
import { downloadCsv } from '@/components/reports/export';
import { usePrintReport } from '@/components/reports/usePrintReport';
import type { Cashbook, CashbookOrder } from './types';

const num = (v: unknown) => Number(v) || 0;

export default function CashbookView() {
  const { uuid } = useParams();
  const t = useT();
  const { money } = useConfig();
  const { can } = useAuth();
  const q = useQuery({
    queryKey: ['cash-books', uuid],
    queryFn: async () => (await api.get<Cashbook>(`admin/cash-books/${uuid}`)).data,
    enabled: !!uuid,
  });
  const c = q.data;
  const title = c ? `${t('Cashbook details')} #${c.id}` : t('Cashbook details');
  const { ref, printing, print } = usePrintReport(title);

  if (q.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-brand-600">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }
  if (!c) {
    return (
      <EmptyState
        title={t('Cash register not found')}
        action={
          <Link to="/admin/cashbooks" className="btn-secondary mt-2">
            {t('Back')}
          </Link>
        }
      />
    );
  }

  const statusOf = (o: CashbookOrder) => (o.completed_at ? 'completed' : 'open');
  const total = c.sales || 0;
  const seg = (n: number) => (total ? `${(n / total) * 100}%` : '0%');

  const columns: LocalColumn<CashbookOrder>[] = [
    {
      key: 'tracking',
      header: t('Tracking'),
      sortValue: (o) => o.tracking,
      cell: (o) =>
        can('manage_sales') ? (
          <Link to={`/admin/sales/${o.uuid}/view`} className="font-medium text-brand-700 hover:underline dark:text-brand-300">
            #{o.tracking}
          </Link>
        ) : (
          <span className="font-medium">#{o.tracking}</span>
        ),
    },
    { key: 'customer', header: t('Customer'), sortValue: (o) => o.customer?.name ?? '', cell: (o) => o.customer?.name ?? <span className="text-slate-400">{t('Walk-in')}</span> },
    {
      key: 'status',
      header: t('Status'),
      sortValue: (o) => statusOf(o),
      cell: (o) => (o.completed_at ? <Badge tone="green">{t('Completed')}</Badge> : <Badge tone="amber">{t('In progress')}</Badge>),
    },
    { key: 'cart_total_price', header: t('Price'), sortValue: (o) => num(o.cart_total_price), cell: (o) => money(o.cart_total_price), className: 'text-end tabular-nums', headerClassName: 'text-end' },
    { key: 'discount_amount', header: t('Discount'), sortValue: (o) => num(o.discount_amount), cell: (o) => money(o.discount_amount), className: 'text-end tabular-nums', headerClassName: 'text-end' },
    { key: 'tax_amount', header: t('Tax'), sortValue: (o) => num(o.tax_amount), cell: (o) => money(o.tax_amount), className: 'text-end tabular-nums', headerClassName: 'text-end' },
    { key: 'payable_after_all', header: t('Payable'), sortValue: (o) => num(o.payable_after_all), cell: (o) => <span className="font-medium">{money(o.payable_after_all)}</span>, className: 'text-end tabular-nums', headerClassName: 'text-end' },
    { key: 'profit_after_all', header: t('Profit'), sortValue: (o) => num(o.profit_after_all), cell: (o) => money(o.profit_after_all), className: 'text-end tabular-nums', headerClassName: 'text-end' },
    { key: 'created_at', header: t('Date'), sortValue: (o) => o.id, cell: (o) => <span className="whitespace-nowrap text-slate-500">{o.created_at}</span> },
  ];

  return (
    <div>
      <div className="mb-2 no-print">
        <Link to="/admin/cashbooks" className="tap inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" /> {t('Cashbooks report')}
        </Link>
      </div>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {title}
            {c.closed ? (
              <Badge tone="gray">
                <LockKeyhole className="h-3 w-3" aria-hidden /> {t('Closed')}
              </Badge>
            ) : (
              <Badge tone="green">
                <LockKeyholeOpen className="h-3 w-3" aria-hidden /> {t('Open')}
              </Badge>
            )}
          </span>
        }
        description={
          <>
            {c.user} · {t('Opened at')} {c.created_at}
            {c.closed ? ` · ${t('Closed at')} ${c.updated_at}` : ''}
          </>
        }
        actions={
          <ReportActions
            onRefresh={() => q.refetch()}
            refreshing={q.isFetching}
            disabled={!c.orders.length}
            onCsv={() =>
              downloadCsv(
                `cashbook_${c.id}`,
                [t('ID'), t('Tracking'), t('Customer'), t('Status'), t('Cart Total Price'), t('Cart Total Cost'), t('Discount Amount'), t('Tax Amount'), t('Payable After All'), t('Profit After All'), t('Created at')],
                c.orders.map((o) => [o.id, o.tracking, o.customer?.name ?? '', o.completed_at ? t('Completed') : t('In progress'), o.cart_total_price, o.cart_total_cost, o.discount_amount, o.tax_amount, o.payable_after_all, o.profit_after_all, o.created_at]),
              )
            }
            onPrint={print}
          />
        }
      />

      <div ref={ref} className="space-y-5">
        <PrintTitle
          title={title}
          subtitle={
            <p className="text-xs">
              {c.user} · {t('Opened at')} {c.created_at}
              {c.closed ? ` · ${t('Closed at')} ${c.updated_at}` : ` · ${t('Open')}`}
            </p>
          }
        />

        {/* Cash flow: opening + sales - expenses = closing */}
        <section aria-label={t('Cash flow')} className="card grid divide-y divide-slate-200 dark:divide-slate-800 sm:grid-cols-4 sm:divide-x sm:divide-y-0 sm:rtl:divide-x-reverse">
          <Flow icon={<Banknote className="h-4 w-4" />} label={t('Opening amount')} value={money(c.opening_amount)} />
          <Flow icon={<Wallet className="h-4 w-4" />} label={t('Sales amount')} value={`+ ${money(c.sales_amount)}`} tone="text-emerald-700 dark:text-emerald-400" />
          <Flow icon={<CreditCard className="h-4 w-4" />} label={t('Expenses')} value={`− ${money(c.expenses_amount)}`} tone="text-red-600 dark:text-red-400" />
          <Flow icon={<Landmark className="h-4 w-4" />} label={c.closed ? t('Closing amount') : t('Expected in drawer')} value={money(c.final_amount)} strong />
        </section>

        <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 xl:grid-cols-4">
          <KpiCard label={t('Orders')} value={c.sales} icon={<ShoppingBag className="h-4 w-4" />} />
          <KpiCard label={t('Sold items')} value={num(c.sold_items).toLocaleString()} icon={<Package className="h-4 w-4" />} tone="gray" />
          <KpiCard label={t('Profit')} value={money(c.total_profit)} icon={<TrendingUp className="h-4 w-4" />} tone="green" />
          <KpiCard label={t('Discount')} value={money(c.discount_amount)} icon={<BadgePercent className="h-4 w-4" />} tone="red" hint={`${t('Tax')}: ${money(c.tax_amount)}`} />
        </div>

        {total > 0 && (
          <section className="card p-4" aria-label={t('Order status')}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{t('Order status')}</h2>
              {!c.closed && (
                <span className={`text-xs ${c.is_closable ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
                  {c.is_closable ? t('All orders are settled, the register can be closed.') : t('Please clear all orders in progress before closing the register')}
                </span>
              )}
            </div>
            <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" role="presentation">
              <div className="bg-emerald-500" style={{ width: seg(c.in_completed) }} />
              <div className="bg-amber-500" style={{ width: seg(c.in_progress) }} />
              <div className="bg-red-500" style={{ width: seg(c.in_cancelled) }} />
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
              <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-xs bg-emerald-500" aria-hidden />{t('Completed')}: <b className="tabular-nums">{c.in_completed}</b></li>
              <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-xs bg-amber-500" aria-hidden />{t('In progress')}: <b className="tabular-nums">{c.in_progress}</b></li>
              <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-xs bg-red-500" aria-hidden />{t('Cancelled')}: <b className="tabular-nums">{c.in_cancelled}</b></li>
            </ul>
          </section>
        )}

        <section>
          <h2 className="mb-2 text-sm font-semibold">{t('Sales')}</h2>
          <LocalTable
            rows={c.orders}
            columns={columns}
            rowKey={(o) => o.id}
            printAll={printing}
            searchText={(o) => `${o.tracking} ${o.customer?.name ?? ''}`}
            initialSort={{ column: 'created_at', order: 'desc' }}
            empty={<EmptyState title={t('No sales in this register yet')} />}
          />
        </section>
      </div>
    </div>
  );
}

function Flow({ icon, label, value, tone, strong }: { icon: React.ReactNode; label: string; value: string; tone?: string; strong?: boolean }) {
  return (
    <div className="flex items-center gap-3 p-4">
      <span className="rounded-lg bg-slate-100 p-2 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
        <p className={`tabular-nums wrap-anywhere ${strong ? 'text-xl font-bold' : 'text-lg font-semibold'} ${tone ?? ''}`}>{value}</p>
      </div>
    </div>
  );
}
