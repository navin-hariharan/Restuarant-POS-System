import clsx from 'clsx';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BedDouble, Check, KeyRound, LogIn, MapPin, Plus, Store, Trash2, UserPlus, Users } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { api, fieldErrors } from '@/lib/api';
import { Badge, Button, EmptyState, Input, Modal, SearchInput, Skeleton, Spinner, Textarea, useDebounced } from '@/components/ui';
import { useAuth, useConfig, useT } from '@/providers/AppProviders';
import { slimCustomer, slimReservation } from './draft';
import { posKeys, useCustomerSearch, usePickupPoints, useReservations, useServiceTables } from './queries';
import type { Customer, PickupPoint, Reservation, ServiceTable } from './types';
import { truthy } from '@/lib/cart';
import { SeatingDialog } from './SeatingDialog';

function OptionTile({ selected, disabled, onClick, children, className }: { selected?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={!!selected}
      className={clsx(
        'relative flex min-h-16 flex-col items-start justify-center gap-1 rounded-xl border p-3 text-start text-sm transition',
        selected
          ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500/30 dark:bg-brand-950'
          : 'border-slate-200 hover:border-brand-400 dark:border-slate-700',
        disabled && 'cursor-not-allowed opacity-50 hover:border-slate-200',
        className,
      )}
    >
      {selected && <Check className="absolute inset-e-2 top-2 h-4 w-4 text-brand-600" />}
      {children}
    </button>
  );
}

/* --------------------------------------------------------------- tables */

export function TablePicker({
  open,
  onClose,
  value,
  ownTableId,
  allowReselect,
  autoClose,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  value: ServiceTable | null;
  /** Table already held by the order being edited (always selectable). */
  ownTableId?: number | null;
  allowReselect: boolean;
  autoClose: boolean;
  onChange: (t: ServiceTable | null) => void;
}) {
  const t = useT();
  const { config } = useConfig();
  const { can } = useAuth();
  const tables = useServiceTables(open);
  const [seating, setSeating] = useState<ServiceTable | null>(null);
  const pins = !!config.modes.digital_menu && !!config.modes.digital_menu_pin && (can('pos_portal') || can('manage_service_tables'));
  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      title={t('Service table')}
      size="lg"
      footer={
        <>
          {value && <Button onClick={() => onChange(null)}>{t('Clear')}</Button>}
          <Button variant="primary" onClick={onClose}>{t('Done')}</Button>
        </>
      }
    >
      {tables.isLoading ? (
        <div className="grid grid-cols-3 gap-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : !tables.data?.length ? (
        <EmptyState title={t('No data found')} />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tables.data.map((tb) => {
            const booked = truthy(tb.is_booked) && tb.id !== ownTableId;
            const tile = (
              <OptionTile
                key={tb.id}
                selected={value?.id === tb.id}
                disabled={booked && !allowReselect}
                onClick={() => {
                  onChange(tb);
                  if (autoClose) onClose();
                }}
              >
                <span className="font-semibold">{tb.title}</span>
                <span className="flex flex-wrap gap-1">
                  <Badge tone={booked ? 'amber' : 'green'}>{booked ? t('Booked') : t('Available')}</Badge>
                  {pins && tb.is_open && <Badge tone="blue">{t('Open')}</Badge>}
                </span>
              </OptionTile>
            );
            if (!pins) return tile;
            return (
              <div key={tb.id} className="flex flex-col gap-1">
                {tile}
                <button type="button" className="btn-ghost btn-sm justify-center text-xs" onClick={() => setSeating(tb)}>
                  <KeyRound className="h-3.5 w-3.5" /> {tb.is_open ? t('Table code') : t('Open table')}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
    <SeatingDialog table={seating} onClose={() => setSeating(null)} />
    </>
  );
}

/* --------------------------------------------------------- pickup point */

export function PickupPicker({
  open,
  onClose,
  value,
  autoClose,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  value: PickupPoint | null;
  autoClose: boolean;
  onChange: (p: PickupPoint | null) => void;
}) {
  const t = useT();
  const { can } = useAuth();
  const qc = useQueryClient();
  const points = usePickupPoints(open);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ place_title: '', person_name: '', phone: '', address: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: async () => (await api.post<{ message: string; point: PickupPoint }>('admin/pickup-points', form)).data,
    onSuccess: (r) => {
      toast.success(r.message);
      qc.invalidateQueries({ queryKey: posKeys.pickupPoints });
      onChange(r.point);
      setAdding(false);
      setForm({ place_title: '', person_name: '', phone: '', address: '' });
      setErrors({});
    },
    onError: (e) => setErrors(fieldErrors(e)),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('Pickup point')}
      size="lg"
      footer={
        <>
          {value && <Button onClick={() => onChange(null)}>{t('Clear')}</Button>}
          <Button variant="primary" onClick={onClose}>{t('Done')}</Button>
        </>
      }
    >
      {adding ? (
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Input label={t('Place title')} required value={form.place_title} error={errors.place_title} onChange={(e) => setForm({ ...form, place_title: e.target.value })} wrapperClassName="sm:col-span-2" />
          <Input label={t('Person name')} value={form.person_name} error={errors.person_name} onChange={(e) => setForm({ ...form, person_name: e.target.value })} />
          <Input label={t('Phone')} type="tel" value={form.phone} error={errors.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Textarea label={t('Address')} rows={2} value={form.address} error={errors.address} onChange={(e) => setForm({ ...form, address: e.target.value })} wrapperClassName="sm:col-span-2" />
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button onClick={() => setAdding(false)}>{t('Cancel')}</Button>
            <Button type="submit" variant="primary" loading={save.isPending}>{t('Save')}</Button>
          </div>
        </form>
      ) : (
        <>
          {points.isLoading ? (
            <Skeleton className="h-24" />
          ) : !points.data?.length ? (
            <EmptyState title={t('No data found')} icon={<Store className="h-6 w-6" />} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {points.data.map((p) => (
                <OptionTile
                  key={p.id}
                  selected={value?.id === p.id}
                  onClick={() => {
                    onChange(p);
                    if (autoClose) onClose();
                  }}
                >
                  <span className="font-semibold">{p.place_title}</span>
                  {(p.person_name || p.phone) && (
                    <span className="text-xs text-slate-500">{[p.person_name, p.phone].filter(Boolean).join(' · ')}</span>
                  )}
                  {p.address && <span className="text-xs text-slate-500">{p.address}</span>}
                </OptionTile>
              ))}
            </div>
          )}
          {can('manage_pickup_points') && (
            <Button className="mt-4" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>
              {t('Add new pickup point')}
            </Button>
          )}
        </>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------ shipping address */

export function AddressPicker({
  open,
  onClose,
  value,
  customer,
  autoClose,
  onChange,
  onCustomerUpdated,
}: {
  open: boolean;
  onClose: () => void;
  value: string | null;
  customer: Customer | null;
  autoClose: boolean;
  onChange: (a: string | null) => void;
  onCustomerUpdated: (c: Customer) => void;
}) {
  const t = useT();
  const [text, setText] = useState('');
  const saved = (customer?.shipping_addresses ?? []).filter(Boolean);
  const canSaveToCustomer = !!customer?.uuid && (customer?.id ?? 0) > 1;
  const update = useMutation({
    mutationFn: async (addresses: string[]) => {
      const body = {
        name: customer!.name,
        email: customer!.email ?? null,
        phone: customer!.phone ?? null,
        address: customer!.address ?? null,
        shipping_addresses: addresses,
      };
      const r = await api.patch<{ message: string }>(`admin/customers/${customer!.uuid}`, body);
      return { message: r.data.message, addresses };
    },
    onSuccess: ({ message, addresses }) => {
      toast.success(message);
      onCustomerUpdated({ ...customer!, shipping_addresses: addresses });
    },
  });

  const pick = (a: string | null) => {
    onChange(a);
    if (autoClose) onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('Shipping address')}
      description={customer ? customer.name : undefined}
      size="lg"
      footer={
        <>
          {value && <Button onClick={() => onChange(null)}>{t('Clear')}</Button>}
          <Button variant="primary" onClick={onClose}>{t('Done')}</Button>
        </>
      }
    >
      {saved.length > 0 && (
        <div className="mb-4 space-y-2">
          <p className="label">{t('Select shipping address')}</p>
          {saved.map((a, i) => (
            <div key={`${a}-${i}`} className="flex items-stretch gap-2">
              <OptionTile className="flex-1" selected={value === a} onClick={() => pick(a)}>
                <span className="flex items-center gap-2"><MapPin className="h-4 w-4 shrink-0 text-slate-400" />{a}</span>
              </OptionTile>
              {canSaveToCustomer && (
                <button
                  type="button"
                  className="btn-ghost w-11 p-0! text-red-600"
                  aria-label={t('Remove')}
                  onClick={() => update.mutate(saved.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <Textarea label={t('New address')} rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Street, city, notes for the rider')} />
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {canSaveToCustomer && (
          <Button
            disabled={!text.trim()}
            loading={update.isPending}
            onClick={() => {
              const a = text.trim();
              update.mutate([...saved, a], { onSuccess: () => { pick(a); setText(''); } });
            }}
          >
            {t('Save to customer')}
          </Button>
        )}
        <Button variant="primary" disabled={!text.trim()} onClick={() => { pick(text.trim()); setText(''); }}>
          {t('Use this address')}
        </Button>
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------------- room picker */

export function RoomPicker({
  open,
  onClose,
  value,
  onChange,
  pickable = true,
}: {
  open: boolean;
  onClose: () => void;
  value: Reservation | null;
  onChange?: (r: Reservation | null) => void;
  /** false = only manage check-ins (header "Reservations" button). */
  pickable?: boolean;
}) {
  const t = useT();
  const qc = useQueryClient();
  const reservations = useReservations(open);
  const [tracking, setTracking] = useState('');
  const [search, setSearch] = useState('');
  const checkIn = useMutation({
    mutationFn: async () =>
      (await api.post<{ message: string; reservations: Reservation[] }>('pos/check-in-reservation', { tracking: tracking.trim() })).data,
    onSuccess: (r) => {
      toast.success(r.message);
      qc.setQueryData(posKeys.reservations, r.reservations);
      setTracking('');
    },
  });
  const s = search.trim().toLowerCase();
  const list = (reservations.data ?? []).filter(
    (r) =>
      !s ||
      [r.tracking, r.customer?.name, r.guest_room?.room_name].some((v) => String(v ?? '').toLowerCase().includes(s)),
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={pickable ? t('Select Room') : t('Reservations')}
      size="xl"
      footer={
        <>
          {pickable && value && <Button onClick={() => onChange?.(null)}>{t('Clear')}</Button>}
          <Button variant="primary" onClick={onClose}>{t('Done')}</Button>
        </>
      }
    >
      <form
        className="mb-4 flex flex-col gap-2 rounded-xl border border-dashed border-slate-300 p-3 dark:border-slate-700 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (tracking.trim()) checkIn.mutate();
        }}
      >
        <Input
          wrapperClassName="flex-1"
          label={t('Check in a reservation')}
          placeholder={t('Reservation ID')}
          value={tracking}
          onChange={(e) => setTracking(e.target.value)}
        />
        <Button type="submit" variant="success" loading={checkIn.isPending} icon={<LogIn className="h-4 w-4" />} disabled={!tracking.trim()}>
          {t('Checkin')}
        </Button>
      </form>
      <SearchInput value={search} onChange={setSearch} className="mb-3" placeholder={t('Search')} />
      {reservations.isLoading ? (
        <Skeleton className="h-24" />
      ) : !list.length ? (
        <EmptyState title={t('No checked-in reservations')} icon={<BedDouble className="h-6 w-6" />} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {list.map((r) => {
            const body = (
              <>
                <span className="flex items-center gap-2 font-semibold"><BedDouble className="h-4 w-4 text-slate-400" />{r.guest_room?.room_name ?? '—'}</span>
                <span className="text-xs text-slate-500">#{r.tracking} · {r.customer?.name}</span>
                {r.checkin_at && <span className="text-xs text-slate-500">{t('Checkin')}: {r.checkin_at}</span>}
              </>
            );
            return pickable ? (
              <OptionTile key={r.id} selected={value?.id === r.id} onClick={() => { onChange?.(slimReservation(r)); onClose(); }}>
                {body}
              </OptionTile>
            ) : (
              <div key={r.id} className="flex flex-col gap-1 rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700">{body}</div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

/* -------------------------------------------------------------- customer */

export function CustomerPicker({
  open,
  onClose,
  value,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  value: Customer | null;
  onChange: (c: Customer) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search.trim(), 350);
  const results = useCustomerSearch(debounced, open);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '', address: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useMutation({
    mutationFn: async () => (await api.post<{ message: string; customer: Customer }>('admin/customers', { ...form, shipping_addresses: [] })).data,
    onSuccess: (r) => {
      toast.success(r.message);
      qc.invalidateQueries({ queryKey: ['pos', 'customers'] });
      onChange(slimCustomer(r.customer)!);
      setAdding(false);
      setErrors({});
      setForm({ name: '', email: '', phone: '', address: '' });
      onClose();
    },
    onError: (e) => setErrors(fieldErrors(e)),
  });

  const startAdd = () => {
    // Prefill from what was typed: digits → phone, @ → email, otherwise name.
    const s = search.trim();
    setForm({
      name: s && !/^[\d+\s-]+$/.test(s) && !s.includes('@') ? s : '',
      phone: /^[\d+\s-]+$/.test(s) ? s : '',
      email: s.includes('@') ? s : '',
      address: '',
    });
    setAdding(true);
  };

  return (
    <Modal open={open} onClose={onClose} title={adding ? t('Add customer') : t('Select customer')} size="lg">
      {adding ? (
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Input label={t('Name')} required value={form.name} error={errors.name} onChange={(e) => setForm({ ...form, name: e.target.value })} wrapperClassName="sm:col-span-2" autoFocus />
          <Input label={t('Phone')} type="tel" value={form.phone} error={errors.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Input label={t('Email')} type="email" value={form.email} error={errors.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Textarea label={t('Address')} rows={2} value={form.address} error={errors.address} onChange={(e) => setForm({ ...form, address: e.target.value })} wrapperClassName="sm:col-span-2" />
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button onClick={() => setAdding(false)}>{t('Back')}</Button>
            <Button type="submit" variant="primary" loading={create.isPending}>{t('Save')}</Button>
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2">
            <SearchInput value={search} onChange={setSearch} className="flex-1" autoFocus placeholder={t('Search by name, phone or email')} />
            <Button variant="primary" icon={<UserPlus className="h-4 w-4" />} onClick={startAdd}>
              <span className="hidden sm:inline">{t('New')}</span>
            </Button>
          </div>
          {results.isFetching && !results.data ? (
            <div className="flex justify-center py-6 text-brand-600"><Spinner className="h-5 w-5" /></div>
          ) : !results.data?.length ? (
            <EmptyState title={t('Attention! record not found')} icon={<Users className="h-6 w-6" />} action={<Button onClick={startAdd}>{t('Add customer')}</Button>} />
          ) : (
            <ul className="max-h-[50vh] divide-y divide-slate-200 overflow-y-auto rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
              {results.data.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className={clsx('flex min-h-[52px] w-full items-center gap-3 px-3 py-2 text-start hover:bg-slate-50 dark:hover:bg-slate-800', value?.id === c.id && 'bg-brand-50 dark:bg-brand-950')}
                    onClick={() => {
                      onChange(slimCustomer(c)!);
                      onClose();
                    }}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {c.name?.charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{c.name}</span>
                      <span className="block truncate text-xs text-slate-500">{[c.phone, c.email].filter(Boolean).join(' · ') || '—'}</span>
                    </span>
                    {value?.id === c.id && <Check className="h-4 w-4 text-brand-600" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
