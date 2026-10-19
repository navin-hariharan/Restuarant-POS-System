import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, BedDouble, Pencil, Plus, Save, Trash2, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { api, fieldErrors } from '@/lib/api';
import { toDateInput, toTimeInput } from '@/lib/format';
import { useAuth, useConfig, useT } from '@/providers/AppProviders';
import { Badge, Button, Card, Checkbox, Input, PageHeader, Select, Skeleton, Switch, Textarea } from '@/components/ui';
import {
  hhmm, hoursBetween, overlappingSlots, paidTotal, paymentTimestamp, roomCharges, toDateTime, useReservationFilters,
  type Customer, type Payment, type ReservationDetail, type ReservationTax, type Slot,
} from '@/components/rooms/reservation';
import { CustomerModal } from '@/components/rooms/ReservationBits';

type FormState = {
  customer_id: string;
  guest_room_id: string;
  booking_source_id: string;
  reservation_status_id: string;
  reserved_at_date: string;
  reserved_at_time: string;
  reserved_till_date: string;
  reserved_till_time: string;
  is_charge_per_use: boolean;
  tax_key: string;
  note: string;
  staff_note: string;
  checkin_process: boolean;
  payments: Payment[];
};

function defaultTimes() {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 2 * 3_600_000);
  return {
    reserved_at_date: toDateInput(start),
    reserved_at_time: toTimeInput(start),
    reserved_till_date: toDateInput(end),
    reserved_till_time: toTimeInput(end),
  };
}

const CURRENT_TAX = '__current';

export default function ReservationForm() {
  const t = useT();
  const { uuid } = useParams();
  const editing = !!uuid;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();
  const { config, money } = useConfig();
  const lookups = useReservationFilters();
  const detail = useQuery({
    queryKey: ['admin/guest-room-reservations', uuid],
    queryFn: async () => (await api.get<ReservationDetail>(`admin/guest-room-reservations/${uuid}`)).data,
    enabled: editing,
  });

  const [form, setForm] = useState<FormState | null>(null);
  const [extraCustomers, setExtraCustomers] = useState<Customer[]>([]);
  const [customerModal, setCustomerModal] = useState<{ open: boolean; customer: Customer | null }>({ open: false, customer: null });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [payment, setPayment] = useState({ amount: '', description: '' });

  const taxes = lookups.data?.taxes ?? [];
  const storedTax: ReservationTax | null = detail.data?.tax ?? null;

  useEffect(() => {
    setForm(null);
    setErrors({});
  }, [uuid]);

  // Initialise once lookups (and the reservation when editing) are loaded.
  useEffect(() => {
    if (form || !lookups.data || (editing && !detail.data)) return;
    if (editing && detail.data) {
      const d = detail.data;
      const match = d.tax?.id ? taxes.find((x) => x.id === d.tax!.id) : undefined;
      setForm({
        customer_id: String(d.customer_id ?? ''),
        guest_room_id: String(d.guest_room_id ?? ''),
        booking_source_id: String(d.booking_source_id ?? ''),
        reservation_status_id: String(d.reservation_status_id ?? ''),
        reserved_at_date: d.reserved_at_date ?? '',
        reserved_at_time: hhmm(d.reserved_at_time),
        reserved_till_date: d.reserved_till_date ?? '',
        reserved_till_time: hhmm(d.reserved_till_time),
        is_charge_per_use: !!d.is_charge_per_use,
        tax_key: match ? String(match.id) : d.tax ? CURRENT_TAX : '',
        note: d.note ?? '',
        staff_note: d.staff_note ?? '',
        checkin_process: false,
        payments: d.payments ?? [],
      });
    } else {
      const defId = Number(config.tax_setup?.tax_id);
      const def = taxes.find((x) => x.id === defId);
      setForm({
        customer_id: '',
        guest_room_id: '',
        booking_source_id: lookups.data.sources.length === 1 ? String(lookups.data.sources[0].id) : '',
        reservation_status_id: lookups.data.statuses.length === 1 ? String(lookups.data.statuses[0].id) : '',
        ...defaultTimes(),
        is_charge_per_use: false,
        tax_key: def ? String(def.id) : taxes[0] ? String(taxes[0].id) : '',
        note: '',
        staff_note: '',
        checkin_process: false,
        payments: [],
      });
    }
  }, [form, lookups.data, detail.data, editing, taxes, config.tax_setup]);

  const customers = useMemo(() => {
    const list = [...(lookups.data?.customers ?? [])];
    for (const c of extraCustomers) {
      const i = list.findIndex((x) => x.id === c.id);
      if (i >= 0) list[i] = c;
      else list.push(c);
    }
    return list;
  }, [lookups.data, extraCustomers]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    setErrors((e) => {
      if (!e[k as string]) return e;
      const { [k as string]: _x, ...rest } = e;
      return rest;
    });
  };

  const room = lookups.data?.rooms.find((r) => String(r.id) === form?.guest_room_id) ?? null;
  const customer = customers.find((c) => String(c.id) === form?.customer_id) ?? null;
  const tax: ReservationTax | null = form?.tax_key === CURRENT_TAX ? storedTax : taxes.find((x) => String(x.id) === form?.tax_key) ?? null;
  const hours = form ? hoursBetween(form.reserved_at_date, form.reserved_at_time, form.reserved_till_date, form.reserved_till_time) : 0;
  const totals = roomCharges({ room, perUse: !!form?.is_charge_per_use, hours, tax });
  const paid = paidTotal(form?.payments);
  const from = form ? toDateTime(form.reserved_at_date, form.reserved_at_time) : null;
  const till = form ? toDateTime(form.reserved_till_date, form.reserved_till_time) : null;
  const invalidRange = !!from && !!till && till <= from;
  const originalSlot: Slot | null =
    editing && detail.data && String(detail.data.guest_room_id) === form?.guest_room_id
      ? {
          reserved_at_date: detail.data.reserved_at_date,
          reserved_at_time: detail.data.reserved_at_time,
          reserved_till_date: detail.data.reserved_till_date,
          reserved_till_time: detail.data.reserved_till_time,
        }
      : null;
  const clashes = overlappingSlots(room, from, till, originalSlot);

  const addPayment = () => {
    const amount = Number(payment.amount);
    if (!form || !(amount > 0)) return;
    set('payments', [...form.payments, { amount, at: paymentTimestamp(), description: payment.description }]);
    setPayment({ amount: '', description: '' });
  };

  const submit = async () => {
    if (!form) return;
    const local: Record<string, string> = {};
    if (!form.customer_id) local.customer_id = t('Select a customer');
    if (!form.guest_room_id) local.guest_room_id = t('Select a room');
    if (!form.booking_source_id) local.booking_source_id = t('Select a booking source');
    if (!form.reservation_status_id) local.reservation_status_id = t('Select a status');
    if (!tax) local.tax = t('Select a tax method');
    if (invalidRange) local.reserved_till_date = t('Check-out must be after check-in');
    if (Object.keys(local).length) {
      setErrors(local);
      toast.error(t('Please fix the highlighted fields'));
      return;
    }
    const payload = {
      customer_id: Number(form.customer_id),
      guest_room_id: Number(form.guest_room_id),
      booking_source_id: Number(form.booking_source_id),
      reservation_status_id: Number(form.reservation_status_id),
      reserved_at_date: form.reserved_at_date,
      reserved_at_time: form.reserved_at_time,
      reserved_till_date: form.reserved_till_date,
      reserved_till_time: form.reserved_till_time,
      tax,
      tax_amount: totals.taxAmount,
      reservation_hours: hours,
      charges: totals.charges,
      is_charge_per_use: form.is_charge_per_use,
      sub_total: totals.subTotal,
      total_room_service_charges: totals.total,
      note: form.note || null,
      staff_note: form.staff_note || null,
      payments: form.payments,
      ...(form.checkin_process ? { checkin_process: true } : {}),
    };
    setSaving(true);
    try {
      if (editing) {
        const res = await api.put(`admin/guest-room-reservations/${uuid}`, payload);
        toast.success(res.data?.message ?? t('Data updated successfully'));
        qc.invalidateQueries({ queryKey: ['admin/guest-room-reservations'] });
        qc.invalidateQueries({ queryKey: ['admin/room-reservations-filters'] });
        navigate(`/admin/reservations/${uuid}/view`);
      } else {
        const res = await api.post<{ message: string; reservation: string }>('admin/guest-room-reservations', payload);
        toast.success(res.data?.message ?? t('Data saved successfully'));
        qc.invalidateQueries({ queryKey: ['admin/guest-room-reservations'] });
        qc.invalidateQueries({ queryKey: ['admin/room-reservations-filters'] });
        navigate(`/admin/reservations/${res.data.reservation}/view`);
      }
    } catch (e) {
      setErrors(fieldErrors(e));
    } finally {
      setSaving(false);
    }
  };

  const loading = lookups.isLoading || (editing && detail.isLoading) || !form;
  const title = editing ? t('Edit reservation') : t('New room reservation');

  if (loading) {
    return (
      <div>
        <PageHeader title={title} />
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Skeleton className="h-112 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      </div>
    );
  }
  if (!form) return null;
  if (editing && detail.data?.checkout_at) {
    return (
      <div>
        <PageHeader title={title} />
        <Card>
          <p className="text-sm">{t('This reservation is checked out and can no longer be edited.')}</p>
          <Link to={`/admin/reservations/${uuid}/view`} className="btn-secondary btn-sm mt-3">
            {t('View reservation')}
          </Link>
        </Card>
      </div>
    );
  }

  const noRooms = (lookups.data?.rooms.length ?? 0) === 0;
  const canCustomers = can('manage_customers', 'pos_portal');

  return (
    <div>
      <PageHeader
        title={title}
        description={editing && detail.data ? `#${detail.data.tracking}` : t('Book a room for a guest')}
        actions={
          <Link to={editing ? `/admin/reservations/${uuid}/view` : '/admin/reservations'} className="btn-ghost">
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" /> {t('Back')}
          </Link>
        }
      />
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]"
      >
        <div className="min-w-0 space-y-5">
          <Card title={t('Guest')}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <Select
                wrapperClassName="flex-1"
                label={t('Customer')}
                required
                placeholder={t('Select a customer')}
                options={customers.map((c) => ({ value: c.id, label: c.phone ? `${c.name} · ${c.phone}` : c.name }))}
                value={form.customer_id}
                error={errors.customer_id}
                onChange={(e) => set('customer_id', e.target.value)}
              />
              {canCustomers && (
                <div className="flex gap-2 sm:mb-0.5">
                  {customer && customer.id > 1 && (
                    <Button icon={<Pencil className="h-4 w-4" />} onClick={() => setCustomerModal({ open: true, customer })}>
                      {t('Edit')}
                    </Button>
                  )}
                  <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setCustomerModal({ open: true, customer: null })}>
                    {t('New customer')}
                  </Button>
                </div>
              )}
            </div>
            {customer && (customer.email || customer.address) && (
              <p className="mt-2 text-xs text-slate-500">{[customer.email, customer.address].filter(Boolean).join(' · ')}</p>
            )}
          </Card>

          <Card title={t('Room and time')}>
            {noRooms ? (
              <p className="text-sm text-slate-500">
                {t('No guest rooms yet.')}{' '}
                {can('manage_guest_rooms') && (
                  <Link className="font-medium text-brand-700 underline dark:text-brand-300" to="/admin/guest-rooms">
                    {t('Add a room')}
                  </Link>
                )}
              </p>
            ) : (
              <fieldset>
                <legend className="label">
                  {t('Room')} <span className="text-red-500">*</span>
                </legend>
                <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
                  {lookups.data!.rooms.map((r) => {
                    const active = String(r.id) === form.guest_room_id;
                    return (
                      <label
                        key={r.id}
                        className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition ${
                          active ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500 dark:bg-brand-950' : 'border-slate-300 hover:border-slate-400 dark:border-slate-700'
                        }`}
                      >
                        <input
                          type="radio"
                          name="guest_room_id"
                          className="mt-1 accent-brand-600"
                          checked={active}
                          onChange={() => set('guest_room_id', String(r.id))}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 font-medium">
                            <BedDouble className="h-4 w-4 text-slate-400" aria-hidden="true" /> {r.room_name}
                          </span>
                          <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-500">
                            <span className="inline-flex items-center gap-1">
                              <Users className="h-3 w-3" aria-hidden="true" /> {r.capactity}
                            </span>
                            <span>
                              {money(r.per_hour_charges)} / {t('hour')}
                            </span>
                            <span>
                              {money(r.per_use_charges)} {t('per use')}
                            </span>
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                {errors.guest_room_id && <p className="error-text">{errors.guest_room_id}</p>}
              </fieldset>
            )}
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Input
                label={t('Check in date')}
                type="date"
                required
                value={form.reserved_at_date}
                error={errors.reserved_at_date}
                onChange={(e) => {
                  const v = e.target.value;
                  setForm((f) => (f ? { ...f, reserved_at_date: v, reserved_till_date: f.reserved_till_date < v ? v : f.reserved_till_date } : f));
                }}
              />
              <Input label={t('Time')} type="time" required value={form.reserved_at_time} error={errors.reserved_at_time} onChange={(e) => set('reserved_at_time', e.target.value)} />
              <Input
                label={t('Check out date')}
                type="date"
                required
                min={form.reserved_at_date}
                value={form.reserved_till_date}
                error={errors.reserved_till_date}
                onChange={(e) => set('reserved_till_date', e.target.value)}
              />
              <Input label={t('Time')} type="time" required value={form.reserved_till_time} error={errors.reserved_till_time} onChange={(e) => set('reserved_till_time', e.target.value)} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={invalidRange ? 'red' : 'blue'}>
                {hours} {t('hours')}
              </Badge>
              {[1, 2, 4, 12, 24].map((h) => (
                <button
                  key={h}
                  type="button"
                  className="rounded-full border border-slate-300 px-2 py-0.5 text-xs hover:border-brand-500 pointer-coarse:min-h-10 pointer-coarse:px-3 dark:border-slate-700"
                  onClick={() => {
                    if (!from) return;
                    const end = new Date(from.getTime() + h * 3_600_000);
                    setForm((f) => (f ? { ...f, reserved_till_date: toDateInput(end), reserved_till_time: toTimeInput(end) } : f));
                  }}
                >
                  +{h}h
                </button>
              ))}
            </div>
            {clashes.length > 0 && (
              <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300" role="alert">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-medium">{t('This room is already reserved in that period')}</p>
                  <ul className="mt-1 text-xs">
                    {clashes.slice(0, 4).map((s, i) => (
                      <li key={i}>
                        {s.reserved_at_date} {hhmm(s.reserved_at_time)} → {s.reserved_till_date} {hhmm(s.reserved_till_time)}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            <div className="mt-4 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <Switch
                label={t('Charge per use')}
                description={form.is_charge_per_use ? t('A flat per-use price is charged.') : t('Charged by the hour for the reserved period.')}
                checked={form.is_charge_per_use}
                onChange={(v) => set('is_charge_per_use', v)}
              />
            </div>
          </Card>

          <Card title={t('Booking')}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Select
                label={t('Booking source')}
                required
                placeholder={t('Select')}
                options={(lookups.data?.sources ?? []).map((s) => ({ value: s.id, label: s.title }))}
                value={form.booking_source_id}
                error={errors.booking_source_id}
                onChange={(e) => set('booking_source_id', e.target.value)}
              />
              <Select
                label={t('Reservation status')}
                required
                placeholder={t('Select')}
                options={(lookups.data?.statuses ?? []).map((s) => ({ value: s.id, label: s.title }))}
                value={form.reservation_status_id}
                error={errors.reservation_status_id}
                onChange={(e) => set('reservation_status_id', e.target.value)}
              />
              <Select
                label={t('Tax method')}
                required
                placeholder={t('Select')}
                options={[
                  ...(storedTax && form.tax_key === CURRENT_TAX ? [{ value: CURRENT_TAX, label: `${storedTax.tax_title ?? t('Current')} (${t('Current')})` }] : []),
                  ...taxes.map((x) => ({ value: String(x.id), label: x.tax_title ?? String(x.id) })),
                ]}
                value={form.tax_key}
                error={errors.tax}
                onChange={(e) => set('tax_key', e.target.value)}
              />
            </div>
            {(lookups.data?.sources.length === 0 || lookups.data?.statuses.length === 0) && (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                {t('Add booking sources and reservation statuses first.')}{' '}
                {can('manage_booking_sources') && (
                  <Link className="underline" to="/admin/booking-sources">
                    {t('Booking sources')}
                  </Link>
                )}{' '}
                {can('manage_reservation_statuses') && (
                  <Link className="underline" to="/admin/reservation-statuses">
                    {t('Reservation statuses')}
                  </Link>
                )}
              </p>
            )}
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Textarea label={t('Note')} help={t('Visible on the printed reservation')} rows={2} value={form.note} error={errors.note} onChange={(e) => set('note', e.target.value)} />
              <Textarea label={t('Staff note')} help={t('Internal only')} rows={2} value={form.staff_note} error={errors.staff_note} onChange={(e) => set('staff_note', e.target.value)} />
            </div>
            {!(editing && detail.data?.checkin_at) && (
              <Checkbox className="mt-4" label={t('Check the guest in now')} checked={form.checkin_process} onChange={(v) => set('checkin_process', v)} />
            )}
          </Card>

          <Card title={t('Advance payments')}>
            {form.payments.length > 0 ? (
              <ul className="mb-3 divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                {form.payments.map((p, i) => (
                  <li key={i} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="font-medium tabular-nums">{money(p.amount)}</span>
                    <span className="min-w-0 flex-1 truncate text-slate-500">{p.description || '—'}</span>
                    <span className="hidden text-xs text-slate-400 sm:inline">{p.at}</span>
                    <button
                      type="button"
                      className="btn-ghost btn-sm text-red-600"
                      aria-label={`${t('Remove')} ${money(p.amount)}`}
                      onClick={() => set('payments', form.payments.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-3 text-sm text-slate-500">{t('No payments recorded yet.')}</p>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <Input
                wrapperClassName="sm:w-36"
                label={t('Amount')}
                type="number"
                min={0}
                step="0.01"
                value={payment.amount}
                onChange={(e) => setPayment((p) => ({ ...p, amount: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addPayment();
                  }
                }}
              />
              <Input
                wrapperClassName="flex-1"
                label={t('Description')}
                placeholder={t('e.g. Cash deposit')}
                value={payment.description}
                onChange={(e) => setPayment((p) => ({ ...p, description: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addPayment();
                  }
                }}
              />
              <Button icon={<Plus className="h-4 w-4" />} disabled={!(Number(payment.amount) > 0)} onClick={addPayment}>
                {t('Add')}
              </Button>
            </div>
          </Card>
        </div>

        <aside className="lg:sticky lg:top-4 lg:self-start">
          <Card title={t('Summary')}>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">{t('Room')}</dt>
                <dd className="text-end font-medium">{room?.room_name ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">{form.is_charge_per_use ? t('Room charges per use') : t('Room charges per hour')}</dt>
                <dd className="tabular-nums">{money(totals.charges)}</dd>
              </div>
              {!form.is_charge_per_use && (
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">{t('Reservation hours')}</dt>
                  <dd className="tabular-nums">{hours}</dd>
                </div>
              )}
              <div className="flex justify-between gap-2 border-t border-slate-200 pt-2 dark:border-slate-800">
                <dt className="text-slate-500">{t('Subtotal')}</dt>
                <dd className="tabular-nums">{money(totals.subTotal)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">
                  {t('Tax')} {tax?.tax_title ? <span className="text-xs">({tax.tax_title})</span> : null}
                </dt>
                <dd className="tabular-nums">{money(totals.taxAmount)}</dd>
              </div>
              <div className="flex justify-between gap-2 border-t border-slate-200 pt-2 text-base font-semibold dark:border-slate-800">
                <dt>{t('Total service charges')}</dt>
                <dd className="tabular-nums">{money(totals.total)}</dd>
              </div>
              {form.payments.length > 0 && (
                <>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">{t('Paid')}</dt>
                    <dd className="tabular-nums text-emerald-700 dark:text-emerald-400">{money(paid)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">{t('Due')}</dt>
                    <dd className="tabular-nums">{money(Math.max(0, totals.total - paid))}</dd>
                  </div>
                </>
              )}
            </dl>
            <Button type="submit" variant="primary" size="lg" className="mt-4 w-full justify-center" icon={<Save className="h-4 w-4" />} loading={saving} disabled={noRooms}>
              {editing ? t('Update') : t('Save reservation')}
            </Button>
            {Object.keys(errors).length > 0 && (
              <p className="mt-2 text-center text-xs text-red-600" role="alert">
                {t('Please fix the highlighted fields')}
              </p>
            )}
          </Card>
        </aside>
      </form>
      <CustomerModal
        open={customerModal.open}
        customer={customerModal.customer}
        onClose={() => setCustomerModal({ open: false, customer: null })}
        onSaved={(c) => {
          setExtraCustomers((list) => [...list.filter((x) => x.id !== c.id), c]);
          set('customer_id', String(c.id));
        }}
      />
    </div>
  );
}
