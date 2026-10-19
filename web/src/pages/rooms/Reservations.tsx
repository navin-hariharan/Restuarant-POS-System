import { useEffect, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Eye, LogIn, LogOut, MoreHorizontal, Pencil, Plus, Printer, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth, useConfig, useT } from '@/providers/AppProviders';
import {
  Badge, Button, DataTable, EmptyState, Input, Menu, MenuItem, PageHeader, SearchInput, Select, TablePagination, useConfirm, useTableQuery,
  type Column,
} from '@/components/ui';
import { hhmm, updatePayloadFromDetail, useReservationFilters, type ReservationDetail, type ReservationRow } from '@/components/rooms/reservation';
import { PaymentBadge, StageBadge } from '@/components/rooms/ReservationBits';

const DURATIONS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last_seven_days', label: 'Last 7 days' },
  { value: 'weekly', label: 'This week' },
  { value: 'monthly', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'last_three_months', label: 'Last 3 months' },
  { value: 'yearly', label: 'This year' },
  { value: 'last_year', label: 'Last year' },
  { value: 'custom', label: 'Custom range' },
];

const FILTER_KEYS = ['customer_id', 'guest_room', 'booking_source', 'reservation_status', 'duration', 'starting_date', 'ending_date'] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

export default function Reservations() {
  const t = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can } = useAuth();
  const { money } = useConfig();
  const [params, setParams] = useSearchParams();
  const lookups = useReservationFilters();

  // Filters live in the URL so a filtered list can be bookmarked / shared.
  const filters = useMemo(() => {
    const f: Partial<Record<FilterKey, string>> = {};
    for (const k of FILTER_KEYS) {
      const v = params.get(k);
      if (v) f[k] = v;
    }
    if (f.duration !== 'custom') {
      delete f.starting_date;
      delete f.ending_date;
    }
    return f;
  }, [params]);
  const setFilter = (k: FilterKey, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const clearFilters = () => setParams(new URLSearchParams(), { replace: true });
  const activeCount = Object.keys(filters).length;

  const table = useTableQuery<ReservationRow>('admin/guest-room-reservations', { filters, perPageKey: 'reservations_per_page' });
  const filterKey = JSON.stringify(filters);
  useEffect(() => {
    table.setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin/guest-room-reservations'] });

  const checkIn = async (row: ReservationRow) => {
    if (!(await confirm({ title: t('Check in'), message: `${row.customer?.name ?? ''} · ${row.guest_room?.room_name ?? ''}`, confirmText: t('Check in'), danger: false }))) return;
    const detail = (await api.get<ReservationDetail>(`admin/guest-room-reservations/${row.uuid}`)).data;
    const res = await api.put(`admin/guest-room-reservations/${row.uuid}`, updatePayloadFromDetail(detail, { checkin_process: true }));
    toast.success(res.data?.message ?? t('Guest room reservation checked in successfully'));
    refresh();
  };

  const remove = async (row: ReservationRow) => {
    if (!(await confirm({ danger: true, message: t('The reservation and its room service orders will be removed.') }))) return;
    const res = await api.delete(`admin/guest-room-reservations/${row.uuid}`);
    toast.success(res.data?.message ?? t('Data removed successfully'));
    refresh();
  };

  const columns: Column<ReservationRow>[] = [
    {
      key: 'tracking',
      header: t('Reservation ID'),
      sortKey: 'tracking',
      cell: (r) => <span className="font-mono text-xs">#{r.tracking}</span>,
    },
    {
      key: 'customer',
      header: t('Customer'),
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{r.customer?.name ?? '—'}</p>
          {r.customer?.phone && <p className="truncate text-xs text-slate-500">{r.customer.phone}</p>}
        </div>
      ),
    },
    { key: 'guest_room', header: t('Room'), cell: (r) => r.guest_room?.room_name ?? '—' },
    {
      key: 'reserved_at_date',
      header: t('Reservation date'),
      sortKey: 'reserved_at_date',
      cell: (r) => (
        <div className="whitespace-nowrap">
          <p>
            {r.reserved_at_date} <span className="text-slate-500">{hhmm(r.reserved_at_time)}</span>
          </p>
          <p className="text-xs text-slate-500">
            {Number(r.reservation_hours) || 0} {t('hours')}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: t('Status'),
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          <StageBadge r={r} />
          {r.reservation_status && <Badge tone="purple">{r.reservation_status.title}</Badge>}
        </div>
      ),
    },
    { key: 'booking_source', header: t('Booking source'), cell: (r) => <span className="text-slate-600 dark:text-slate-300">{r.booking_source?.title ?? '—'}</span> },
    {
      key: 'total_room_service_charges',
      header: t('Room charges'),
      sortKey: 'total_room_service_charges',
      className: 'text-end tabular-nums',
      headerClassName: 'text-end',
      cell: (r) => (
        <div className="flex flex-col items-end gap-1">
          {money(r.total_room_service_charges)}
          <PaymentBadge cleared={!!r.payment_cleared} />
        </div>
      ),
    },
    {
      key: '__actions',
      header: <span className="sr-only">{t('Actions')}</span>,
      className: 'text-end',
      cell: (r) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {!r.checkin_at && !r.checkout_at && (
            <Button size="sm" variant="ghost" icon={<LogIn className="h-4 w-4" />} onClick={() => checkIn(r)}>
              <span className="hidden xl:inline">{t('Check in')}</span>
            </Button>
          )}
          {r.checkin_at && !r.checkout_at && (
            <Button size="sm" variant="ghost" icon={<LogOut className="h-4 w-4" />} onClick={() => navigate(`/admin/reservations/${r.uuid}/view#checkout`)}>
              <span className="hidden xl:inline">{t('Check out')}</span>
            </Button>
          )}
          <Menu
            trigger={({ toggle }) => (
              <button className="btn-ghost btn-sm" onClick={toggle} aria-label={t('More actions')} title={t('More actions')}>
                <MoreHorizontal className="h-4 w-4" />
              </button>
            )}
          >
            {(close) => (
              <>
                <MenuItem icon={<Eye className="h-4 w-4" />} onClick={() => (close(), navigate(`/admin/reservations/${r.uuid}/view`))}>
                  {t('View')}
                </MenuItem>
                {!r.checkout_at && (
                  <MenuItem icon={<Pencil className="h-4 w-4" />} onClick={() => (close(), navigate(`/admin/reservations/${r.uuid}/edit`))}>
                    {t('Edit')}
                  </MenuItem>
                )}
                <MenuItem icon={<Printer className="h-4 w-4" />} onClick={() => (close(), window.open(`/print/reservation/${r.uuid}`, '_blank', 'noopener'))}>
                  {t('Print')}
                </MenuItem>
                {can('manage_reservations_remove') && (
                  <MenuItem danger icon={<Trash2 className="h-4 w-4" />} onClick={() => (close(), remove(r))}>
                    {t('Delete')}
                  </MenuItem>
                )}
              </>
            )}
          </Menu>
        </div>
      ),
    },
  ];

  const data = lookups.data;
  return (
    <div>
      <PageHeader
        title={t('Reservations')}
        description={t('Guest room reservations manager')}
        actions={
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => navigate('/admin/reservations/new')}>
            {t('New reservation')}
          </Button>
        }
      />
      <div className="card mb-3 p-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SearchInput className="sm:col-span-2 lg:col-span-1" placeholder={t('Search by reservation ID')} value={table.search} onChange={table.setSearch} />
          <Select
            aria-label={t('Customer')}
            placeholder={t('All customers')}
            options={(data?.customers ?? []).map((c) => ({ value: c.id, label: c.name }))}
            value={filters.customer_id ?? ''}
            onChange={(e) => setFilter('customer_id', e.target.value)}
          />
          <Select
            aria-label={t('Room')}
            placeholder={t('All rooms')}
            options={(data?.rooms ?? []).map((r) => ({ value: r.id, label: r.room_name }))}
            value={filters.guest_room ?? ''}
            onChange={(e) => setFilter('guest_room', e.target.value)}
          />
          <Select
            aria-label={t('Reservation status')}
            placeholder={t('All statuses')}
            options={(data?.statuses ?? []).map((s) => ({ value: s.id, label: s.title }))}
            value={filters.reservation_status ?? ''}
            onChange={(e) => setFilter('reservation_status', e.target.value)}
          />
          <Select
            aria-label={t('Booking source')}
            placeholder={t('All booking sources')}
            options={(data?.sources ?? []).map((s) => ({ value: s.id, label: s.title }))}
            value={filters.booking_source ?? ''}
            onChange={(e) => setFilter('booking_source', e.target.value)}
          />
          <Select
            aria-label={t('Duration')}
            placeholder={t('Booked: any time')}
            options={DURATIONS.map((d) => ({ value: d.value, label: t(d.label) }))}
            value={params.get('duration') ?? ''}
            onChange={(e) => setFilter('duration', e.target.value)}
          />
          {params.get('duration') === 'custom' && (
            <>
              <Input type="date" aria-label={t('From')} value={params.get('starting_date') ?? ''} onChange={(e) => setFilter('starting_date', e.target.value)} />
              <Input type="date" aria-label={t('Till')} value={params.get('ending_date') ?? ''} onChange={(e) => setFilter('ending_date', e.target.value)} />
            </>
          )}
        </div>
        {activeCount > 0 && (
          <div className="mt-2 flex items-center gap-2 text-sm text-slate-500">
            <span>
              {activeCount} {t('filters applied')}
            </span>
            <Button size="sm" variant="ghost" icon={<X className="h-3.5 w-3.5" />} onClick={clearFilters}>
              {t('Clear filters')}
            </Button>
          </div>
        )}
      </div>
      <DataTable
        columns={columns}
        rows={table.items}
        loading={table.query.isLoading}
        rowKey={(r) => r.uuid}
        sort={table.sort}
        onSort={table.setSort}
        onRowClick={(r) => navigate(`/admin/reservations/${r.uuid}/view`)}
        empty={
          <EmptyState
            icon={<CalendarClock className="h-6 w-6" />}
            title={activeCount || table.search ? t('No reservations match these filters') : t('No reservations yet')}
            action={
              activeCount || table.search ? (
                <Button size="sm" onClick={() => (clearFilters(), table.setSearch(''))}>
                  {t('Clear filters')}
                </Button>
              ) : (
                <Link to="/admin/reservations/new" className="btn-primary btn-sm">
                  {t('New reservation')}
                </Link>
              )
            }
          />
        }
        footer={<TablePagination table={table} />}
      />
    </div>
  );
}
