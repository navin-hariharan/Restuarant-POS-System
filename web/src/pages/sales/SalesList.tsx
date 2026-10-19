import clsx from 'clsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Eye, Filter, MoreHorizontal, Pencil, Plus, Printer, RefreshCw, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  Input,
  Menu,
  MenuItem,
  PageHeader,
  SearchInput,
  Select,
  TablePagination,
  useConfirm,
  useTableQuery,
  type Column,
} from '@/components/ui';
import { useAuth, useConfig, useI18n, useT } from '@/providers/AppProviders';
import { CancelSaleModal } from '@/components/sales/CancelSaleModal';
import { CustomerFilter } from '@/components/sales/CustomerFilter';
import {
  canEditInPos,
  formatDateTime,
  OrderTypeChip,
  orderTypeOptions,
  ProgressBar,
  saleStatus,
  StatusBadge,
  type SaleRow,
} from '@/components/sales/saleUtils';

type Staff = { id: number; name: string };
type Filters = {
  tables: { id: number; title: string }[];
  billers: Staff[];
  takers: Staff[];
  chefs: Staff[];
  methods: { id: number; name: string }[];
};

/** Duration presets understood by DurationScopeTrait::scopeAdvanceDuration. */
const durations = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'weekly', label: 'This week' },
  { value: 'last_seven_days', label: 'Last 7 days' },
  { value: 'last_biweek', label: 'Last biweek' },
  { value: 'last_work_week', label: 'Last work week' },
  { value: 'monthly', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'last_three_months', label: 'Last 3 months' },
  { value: 'last_quarter', label: 'Last quarter' },
  { value: 'last_six_months', label: 'Last 6 months' },
  { value: 'last_biannual', label: 'Last biannual' },
  { value: 'yearly', label: 'This year' },
  { value: 'last_year', label: 'Last year' },
  { value: 'custom', label: 'Custom' },
];

/** Filter keys kept in the URL; values are sent as-is to admin/sales. */
const FILTER_KEYS = [
  'duration',
  'starting_date',
  'starting_time',
  'ending_date',
  'ending_time',
  'order_type',
  'table',
  'customer',
  'chef',
  'biller',
  'taker',
  'payment_method',
] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

export default function SalesList() {
  const t = useT();
  const { locale } = useI18n();
  const { config, money } = useConfig();
  const { can } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const [showFilters, setShowFilters] = useState(() => FILTER_KEYS.some((k) => params.get(k) && k !== 'duration'));
  const [selected, setSelected] = useState<(string | number)[]>([]);
  const [cancelling, setCancelling] = useState<SaleRow | null>(null);
  const [customerName, setCustomerName] = useState(params.get('customer_name') ?? '');

  const filters = useMemo(() => {
    const out: Partial<Record<FilterKey, string>> = {};
    for (const k of FILTER_KEYS) {
      const v = params.get(k);
      if (v) out[k] = v;
    }
    if (out.duration !== 'custom') {
      delete out.starting_date;
      delete out.starting_time;
      delete out.ending_date;
      delete out.ending_time;
    }
    return out;
  }, [params]);

  const setFilter = (key: FilterKey, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key === 'customer' && !value) next.delete('customer_name');
    setParams(next, { replace: true });
  };
  const clearFilters = () => {
    setParams(new URLSearchParams(), { replace: true });
    setCustomerName('');
  };
  const activeCount = Object.keys(filters).filter((k) => !['starting_time', 'ending_time', 'ending_date'].includes(k)).length;

  const table = useTableQuery<SaleRow>('admin/sales', { filters, perPageKey: 'sales_per_page' });
  const lists = useQuery({
    queryKey: ['admin/sale.filters'],
    queryFn: async () => (await api.get<Filters>('admin/sale.filters')).data,
  });

  useEffect(() => setSelected([]), [table.page, filters]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['admin/sales'] });
  const allowEditChecked = !!config.modes.allow_to_edit_checked_orders;
  const canPos = can('pos_portal');
  const canRemove = can('remove_sales');
  const canCancel = can('pos_portal', 'manage_sales');

  const removeOne = async (row: SaleRow) => {
    if (!(await confirm({ danger: true, title: t('Delete order'), message: `${t('Order #')}${row.tracking} — ${t("You won't be able to revert this!")}` }))) return;
    const res = await api.delete(`admin/sales/${row.uuid}`);
    toast.success(res.data?.message ?? t('Data removed successfully'));
    refresh();
  };

  const removeSelected = async () => {
    if (!selected.length) return;
    if (!(await confirm({ danger: true, message: t(':count items will be removed', { count: selected.length }) }))) return;
    const res = await api.post('admin/sale-orders-batch-remove', { orders: selected });
    toast.success(res.data?.message ?? t('Data removed successfully'));
    setSelected([]);
    refresh();
  };

  const pageTotals = useMemo(() => {
    const live = table.items.filter((r) => !r.is_cancelled);
    const sum = (k: keyof SaleRow) => live.reduce((s, r) => s + (Number(r[k]) || 0), 0);
    return {
      net: sum('cart_total_price'),
      tax: sum('tax_amount'),
      total: table.items.some((r) => r.payable_after_all !== undefined) ? sum('payable_after_all') : null,
      cancelled: table.items.length - live.length,
    };
  }, [table.items]);
  const apiSummary = (table.query.data as any)?.summary as Record<string, number> | undefined;
  const hasTotalColumn = table.items.some((r) => r.payable_after_all !== undefined);

  const columns: Column<SaleRow>[] = [
    {
      key: 'tracking',
      header: t('Order'),
      sortKey: 'tracking',
      cell: (r) => (
        <div className="min-w-28">
          <Link to={`/admin/sales/${r.uuid}/view`} className="font-semibold tabular-nums text-brand-700 hover:underline dark:text-brand-300" onClick={(e) => e.stopPropagation()}>
            #{r.tracking}
          </Link>
          <p className="text-xs text-slate-500">{formatDateTime(r.took_at, locale) || r.created_at}</p>
        </div>
      ),
    },
    {
      key: 'order_type',
      header: t('Order type'),
      sortKey: 'order_type',
      cell: (r) => (
        <div className="flex flex-col items-start gap-0.5">
          <OrderTypeChip type={r.order_type} />
          {r.table?.title && <span className="text-xs text-slate-500">{r.table.title}</span>}
        </div>
      ),
    },
    {
      key: 'customer',
      header: t('Customer'),
      cell: (r) =>
        r.customer ? (
          <div className="max-w-48">
            <p className="truncate">{r.customer.name}</p>
            {r.customer.phone && <p className="truncate text-xs text-slate-500">{r.customer.phone}</p>}
          </div>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    {
      key: 'status',
      header: t('Status'),
      cell: (r) => {
        const s = saleStatus(r);
        return (
          <div className="w-28 space-y-1">
            <StatusBadge status={s} />
            {(s === 'submitted' || s === 'preparing') && <ProgressBar value={Number(r.progress ?? 0)} className="h-1!" />}
          </div>
        );
      },
    },
    {
      key: 'cart_total_price',
      header: t('Net amount'),
      sortKey: 'cart_total_price',
      className: 'text-end tabular-nums whitespace-nowrap',
      headerClassName: 'text-end',
      cell: (r) => <span className={clsx(r.is_cancelled && 'text-slate-400 line-through')}>{money(r.cart_total_price)}</span>,
    },
    {
      key: 'tax_amount',
      header: t('Tax'),
      sortKey: 'tax_amount',
      className: 'text-end tabular-nums whitespace-nowrap text-slate-500',
      headerClassName: 'text-end',
      cell: (r) => money(r.tax_amount),
    },
    ...(hasTotalColumn
      ? [
          {
            key: 'payable_after_all',
            header: t('Total'),
            sortKey: 'payable_after_all',
            className: 'text-end font-semibold tabular-nums whitespace-nowrap',
            headerClassName: 'text-end',
            cell: (r: SaleRow) => <span className={clsx(r.is_cancelled && 'text-slate-400 line-through')}>{money(r.payable_after_all)}</span>,
          } as Column<SaleRow>,
        ]
      : []),
    {
      key: 'completed_at',
      header: t('Completed at'),
      sortKey: 'completed_at',
      className: 'whitespace-nowrap text-xs text-slate-500',
      cell: (r) => (r.completed_at ? formatDateTime(r.completed_at, locale) : '—'),
    },
    {
      key: '__actions',
      header: <span className="sr-only">{t('Actions')}</span>,
      className: 'text-end',
      cell: (r) => {
        const editable = canPos && canEditInPos(r, allowEditChecked);
        return (
          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <Link to={`/print/sale/${r.uuid}`} className="btn-ghost btn-sm hidden sm:inline-flex" aria-label={t('Print')} title={t('Print')}>
              <Printer className="h-4 w-4" />
            </Link>
            <Menu
              trigger={({ toggle }) => (
                <button className="btn-ghost btn-sm" onClick={toggle} aria-label={t('Actions')} title={t('Actions')}>
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              )}
            >
              {(close) => (
                <>
                  <MenuItem icon={<Eye className="h-4 w-4" />} onClick={() => { close(); nav(`/admin/sales/${r.uuid}/view`); }}>
                    {t('View')}
                  </MenuItem>
                  {editable && (
                    <MenuItem icon={<Pencil className="h-4 w-4" />} onClick={() => { close(); nav(`/admin/pos/${r.uuid}`); }}>
                      {t('Edit in POS')}
                    </MenuItem>
                  )}
                  <MenuItem icon={<Printer className="h-4 w-4" />} onClick={() => { close(); nav(`/print/sale/${r.uuid}`); }}>
                    {t('Print')}
                  </MenuItem>
                  {canCancel && !r.is_cancelled && (!r.completed_at || allowEditChecked) && (
                    <MenuItem danger icon={<Ban className="h-4 w-4" />} onClick={() => { close(); setCancelling(r); }}>
                      {t('Cancel order')}
                    </MenuItem>
                  )}
                  {canRemove && (
                    <MenuItem danger icon={<Trash2 className="h-4 w-4" />} onClick={() => { close(); removeOne(r); }}>
                      {t('Delete')}
                    </MenuItem>
                  )}
                </>
              )}
            </Menu>
          </div>
        );
      },
    },
  ];

  const staffOptions = (list?: Staff[]) => (list ?? []).map((s) => ({ value: s.id, label: s.name }));
  const total = table.pagination?.total ?? table.items.length;

  return (
    <div>
      <PageHeader
        title={t('Sale orders')}
        description={t('Every order taken at the POS or through the digital menu.')}
        actions={
          <>
            <Button icon={<RefreshCw className={clsx('h-4 w-4', table.query.isFetching && 'animate-spin')} />} onClick={refresh}>
              {t('Refresh')}
            </Button>
            {canPos && (
              <Link to="/admin/pos" className="btn-primary">
                <Plus className="h-4 w-4" />
                {t('New order')}
              </Link>
            )}
          </>
        }
      />

      {/* Summary */}
      <div className="mb-4 grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 xl:grid-cols-4">
        <SummaryTile label={t('Orders')} value={String(apiSummary?.count ?? total)} hint={pageTotals.cancelled ? t(':count cancelled on this page', { count: pageTotals.cancelled }) : undefined} />
        <SummaryTile label={t('Net amount')} value={money(apiSummary?.net ?? pageTotals.net)} hint={apiSummary ? undefined : t('This page, excluding cancelled')} />
        <SummaryTile label={t('Tax')} value={money(apiSummary?.tax ?? pageTotals.tax)} hint={apiSummary ? undefined : t('This page, excluding cancelled')} />
        <SummaryTile
          label={t('Total')}
          value={apiSummary?.total !== undefined ? money(apiSummary.total) : pageTotals.total !== null ? money(pageTotals.total) : money(pageTotals.net + pageTotals.tax)}
          hint={apiSummary ? undefined : t('This page, excluding cancelled')}
        />
      </div>

      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput className="w-full sm:w-64" value={table.search} onChange={table.setSearch} placeholder={t('Search by order number')} />
        <Select
          aria-label={t('Duration')}
          wrapperClassName="w-full sm:w-44"
          options={durations.map((d) => ({ value: d.value, label: t(d.label) }))}
          placeholder={t('All time')}
          value={params.get('duration') ?? ''}
          onChange={(e) => setFilter('duration', e.target.value)}
        />
        <Select
          aria-label={t('Order type')}
          wrapperClassName="w-full sm:w-40"
          options={orderTypeOptions(config).map((o) => ({ value: o.value, label: t(o.label) }))}
          placeholder={t('All order types')}
          value={params.get('order_type') ?? ''}
          onChange={(e) => setFilter('order_type', e.target.value)}
        />
        <Button icon={<Filter className="h-4 w-4" />} onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
          {t('Filters')}
          {activeCount > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-xs text-white">{activeCount}</span>}
        </Button>
        {activeCount > 0 && (
          <Button variant="ghost" icon={<X className="h-4 w-4" />} onClick={clearFilters}>
            {t('Clear filters')}
          </Button>
        )}
        <div className="flex-1" />
        {canRemove && selected.length > 0 && (
          <Button variant="danger" size="sm" icon={<Trash2 className="h-4 w-4" />} onClick={removeSelected}>
            {t('Delete')} ({selected.length})
          </Button>
        )}
      </div>

      {params.get('duration') === 'custom' && (
        <div className="card mb-3 grid grid-cols-1 gap-3 p-3 min-[400px]:grid-cols-2 md:grid-cols-4">
          <Input type="date" label={t('Start date')} value={params.get('starting_date') ?? ''} onChange={(e) => setFilter('starting_date', e.target.value)} />
          <Input type="time" label={t('Start time')} value={params.get('starting_time') ?? ''} onChange={(e) => setFilter('starting_time', e.target.value)} />
          <Input type="date" label={t('End date')} value={params.get('ending_date') ?? ''} onChange={(e) => setFilter('ending_date', e.target.value)} />
          <Input type="time" label={t('End time')} value={params.get('ending_time') ?? ''} onChange={(e) => setFilter('ending_time', e.target.value)} />
        </div>
      )}

      {showFilters && (
        <div className="card mb-3 grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Select
            label={t('Service table')}
            options={(lists.data?.tables ?? []).map((x) => ({ value: x.id, label: x.title }))}
            placeholder={t('All')}
            value={params.get('table') ?? ''}
            onChange={(e) => setFilter('table', e.target.value)}
          />
          <CustomerFilter
            value={params.get('customer') ?? ''}
            valueLabel={customerName}
            onChange={(id, name) => {
              setCustomerName(name);
              const next = new URLSearchParams(params);
              if (id) {
                next.set('customer', id);
                next.set('customer_name', name);
              } else {
                next.delete('customer');
                next.delete('customer_name');
              }
              setParams(next, { replace: true });
            }}
          />
          <Select label={t('Order taker')} options={staffOptions(lists.data?.takers)} placeholder={t('All')} value={params.get('taker') ?? ''} onChange={(e) => setFilter('taker', e.target.value)} />
          <Select label={t('Chef')} options={staffOptions(lists.data?.chefs)} placeholder={t('All')} value={params.get('chef') ?? ''} onChange={(e) => setFilter('chef', e.target.value)} />
          <Select label={t('Biller')} options={staffOptions(lists.data?.billers)} placeholder={t('All')} value={params.get('biller') ?? ''} onChange={(e) => setFilter('biller', e.target.value)} />
          <Select
            label={t('Payment method')}
            options={(lists.data?.methods ?? []).map((m) => ({ value: m.id, label: m.name }))}
            placeholder={t('All')}
            value={params.get('payment_method') ?? ''}
            onChange={(e) => setFilter('payment_method', e.target.value)}
          />
        </div>
      )}

      <DataTable
        columns={columns}
        rows={table.items}
        loading={table.query.isLoading}
        rowKey={(r) => r.id}
        sort={table.sort}
        onSort={table.setSort}
        selectable={canRemove}
        selected={selected}
        onSelectedChange={setSelected}
        onRowClick={(r) => nav(`/admin/sales/${r.uuid}/view`)}
        dense
        empty={
          <EmptyState
            title={t('No orders found')}
            description={activeCount || table.search ? t('Try another search or clear the filters.') : undefined}
            action={
              activeCount ? (
                <Button size="sm" onClick={clearFilters}>
                  {t('Clear filters')}
                </Button>
              ) : undefined
            }
          />
        }
        footer={<TablePagination table={table} />}
      />

      {table.items.some((r) => r.is_cancelled) && (
        <p className="mt-2 flex items-center gap-1 text-xs text-slate-500">
          <Badge tone="red">{t('Cancelled')}</Badge> {t('orders are struck through and left out of the totals.')}
        </p>
      )}

      <CancelSaleModal sale={cancelling} onClose={() => setCancelling(null)} onDone={refresh} />
    </div>
  );
}

function SummaryTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums wrap-anywhere">{value}</p>
      {hint && <p className="truncate text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}
