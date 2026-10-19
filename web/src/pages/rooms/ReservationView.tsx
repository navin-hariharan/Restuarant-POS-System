import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BedDouble, CalendarClock, LogIn, LogOut, Mail, MapPin, Pencil, Phone, Plus, Printer, Save, Trash2, User as UserIcon } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth, useConfig, useT } from '@/providers/AppProviders';
import { Badge, Button, Card, Checkbox, EmptyState, Input, PageHeader, Skeleton, Textarea, useConfirm } from '@/components/ui';
import { hhmm, paidTotal, paymentTimestamp, updatePayloadFromDetail, type Payment, type ReservationDetail } from '@/components/rooms/reservation';
import { PaymentBadge, StageBadge } from '@/components/rooms/ReservationBits';

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function Row({ label, children, strong }: { label: string; children: React.ReactNode; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? 'border-t border-slate-200 pt-2 text-base font-semibold dark:border-slate-800' : ''}`}>
      <dt className={strong ? '' : 'text-slate-500'}>{label}</dt>
      <dd className="text-end tabular-nums">{children}</dd>
    </div>
  );
}

export default function ReservationView() {
  const t = useT();
  const { uuid } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can } = useAuth();
  const { money } = useConfig();
  const q = useQuery({
    queryKey: ['admin/guest-room-reservations', uuid],
    queryFn: async () => (await api.get<ReservationDetail>(`admin/guest-room-reservations/${uuid}`)).data,
  });
  const r = q.data;

  const [payments, setPayments] = useState<Payment[]>([]);
  const [note, setNote] = useState('');
  const [staffNote, setStaffNote] = useState('');
  const [payment, setPayment] = useState({ amount: '', description: '' });
  const [checkout, setCheckout] = useState(false);
  const [saving, setSaving] = useState(false);
  const checkoutRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!r) return;
    setPayments(r.payments ?? []);
    setNote(r.note ?? '');
    setStaffNote(r.staff_note ?? '');
  }, [r]);

  useEffect(() => {
    if (r && location.hash === '#checkout') {
      setCheckout(true);
      checkoutRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [r, location.hash]);

  if (q.isLoading) {
    return (
      <div>
        <PageHeader title={t('Reservation order')} />
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }
  if (!r) {
    return <EmptyState title={t('Reservation not found')} action={<Link to="/admin/reservations" className="btn-secondary btn-sm">{t('Back')}</Link>} />;
  }

  const roomTotal = num(r.total_room_service_charges);
  const salesTotal = num(r.sales_payable_amount);
  const grandTotal = roomTotal + salesTotal;
  const paid = paidTotal(payments);
  const due = Math.round((grandTotal - paid) * 100) / 100;
  const closed = !!r.checkout_at;
  const paymentsChanged =
    JSON.stringify(payments) !== JSON.stringify(r.payments ?? []) || note !== (r.note ?? '') || staffNote !== (r.staff_note ?? '');

  const reload = () => {
    qc.invalidateQueries({ queryKey: ['admin/guest-room-reservations'] });
    return q.refetch();
  };

  const addPayment = () => {
    const amount = Number(payment.amount);
    if (!(amount > 0)) return;
    setPayments((p) => [...p, { amount, at: paymentTimestamp(), description: payment.description }]);
    setPayment({ amount: '', description: '' });
  };

  const submitCheckout = async (finish: boolean) => {
    if (finish && due > 0.009) {
      toast.error(t('Clear due payments to checkout'));
      return;
    }
    if (finish && !(await confirm({ title: t('Check out'), message: t('Checkout/close and print final invoice'), confirmText: t('Check out'), danger: false }))) return;
    setSaving(true);
    try {
      const res = await api.post(`admin/guest-reservation-checkout/${r.uuid}`, {
        payments,
        payment_cleared: due <= 0.009,
        note: note || null,
        staff_note: staffNote || null,
        ...(finish ? { checkout_process: true } : {}),
      });
      toast.success(res.data?.message ?? t('Order information updated successfully'));
      await reload();
      if (finish) window.open(`/print/reservation/${r.uuid}`, '_blank', 'noopener');
    } finally {
      setSaving(false);
    }
  };

  const checkIn = async () => {
    if (!(await confirm({ title: t('Check in'), message: `${r.customer?.name ?? ''} · ${r.guest_room?.room_name ?? ''}`, confirmText: t('Check in'), danger: false }))) return;
    const res = await api.put(`admin/guest-room-reservations/${r.uuid}`, updatePayloadFromDetail(r, { checkin_process: true }));
    toast.success(res.data?.message ?? t('Guest room reservation checked in successfully'));
    reload();
  };

  const remove = async () => {
    if (!(await confirm({ danger: true, message: t('The reservation and its room service orders will be removed.') }))) return;
    const res = await api.delete(`admin/guest-room-reservations/${r.uuid}`);
    toast.success(res.data?.message ?? t('Data removed successfully'));
    qc.invalidateQueries({ queryKey: ['admin/guest-room-reservations'] });
    navigate('/admin/reservations', { replace: true });
  };

  return (
    <div>
      <PageHeader
        title={`${t('Reservation')} #${r.tracking}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StageBadge r={r} />
            {r.reservation_status && <Badge tone="purple">{r.reservation_status.title}</Badge>}
            <PaymentBadge cleared={!!r.payment_cleared} />
            <span className="text-xs">
              {t('Booked')} {r.created_at}
            </span>
          </span>
        }
        actions={
          <>
            <Link to="/admin/reservations" className="btn-ghost">
              <ArrowLeft className="h-4 w-4 rtl:rotate-180" /> {t('Back')}
            </Link>
            <a href={`/print/reservation/${r.uuid}`} target="_blank" rel="noopener" className="btn-secondary">
              <Printer className="h-4 w-4" /> {t('Print')}
            </a>
            {!closed && (
              <Link to={`/admin/reservations/${r.uuid}/edit`} className="btn-secondary">
                <Pencil className="h-4 w-4" /> {t('Edit')}
              </Link>
            )}
            {!r.checkin_at && !closed && (
              <Button variant="primary" icon={<LogIn className="h-4 w-4" />} onClick={checkIn}>
                {t('Check in')}
              </Button>
            )}
            {can('manage_reservations_remove') && (
              <Button variant="ghost" className="text-red-600" icon={<Trash2 className="h-4 w-4" />} onClick={remove}>
                {t('Delete')}
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-5">
          <div className="grid gap-5 md:grid-cols-2">
            <Card title={t('Guest')}>
              <ul className="space-y-1.5 text-sm">
                <li className="flex items-center gap-2 font-medium">
                  <UserIcon className="h-4 w-4 text-slate-400" aria-hidden="true" /> {r.customer?.name ?? '—'}
                </li>
                {r.customer?.phone && (
                  <li className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-slate-400" aria-hidden="true" />
                    <a className="hover:underline" href={`tel:${r.customer.phone}`}>
                      {r.customer.phone}
                    </a>
                  </li>
                )}
                {r.customer?.email && (
                  <li className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-slate-400" aria-hidden="true" />
                    <a className="truncate hover:underline" href={`mailto:${r.customer.email}`}>
                      {r.customer.email}
                    </a>
                  </li>
                )}
                {r.customer?.address && (
                  <li className="flex items-start gap-2">
                    <MapPin className="mt-0.5 h-4 w-4 text-slate-400" aria-hidden="true" /> {r.customer.address}
                  </li>
                )}
              </ul>
            </Card>
            <Card title={t('Room')}>
              <ul className="space-y-1.5 text-sm">
                <li className="flex items-center gap-2 font-medium">
                  <BedDouble className="h-4 w-4 text-slate-400" aria-hidden="true" /> {r.guest_room?.room_name ?? '—'}
                </li>
                <li className="text-slate-600 dark:text-slate-300">
                  {t('Max capactity')}: {r.guest_room?.capactity ?? '—'}
                </li>
                <li className="text-slate-600 dark:text-slate-300">
                  {r.is_charge_per_use
                    ? `${t('Rate per use')}: ${money(r.guest_room?.per_use_charges)}`
                    : `${t('Rate per hour')}: ${money(r.guest_room?.per_hour_charges)}`}
                </li>
                {r.booking_source && (
                  <li className="text-slate-600 dark:text-slate-300">
                    {t('Booking source')}: {r.booking_source.title}
                  </li>
                )}
              </ul>
            </Card>
          </div>

          <Card title={t('Stay')}>
            <ol className="grid gap-4 text-sm sm:grid-cols-4">
              <li>
                <p className="text-xs uppercase tracking-wide text-slate-500">{t('Reserved from')}</p>
                <p className="mt-0.5 font-medium">
                  {r.reserved_at_date} {hhmm(r.reserved_at_time)}
                </p>
              </li>
              <li>
                <p className="text-xs uppercase tracking-wide text-slate-500">{t('Reserved till')}</p>
                <p className="mt-0.5 font-medium">
                  {r.reserved_till_date} {hhmm(r.reserved_till_time)}
                </p>
              </li>
              <li>
                <p className="text-xs uppercase tracking-wide text-slate-500">{t('Checkin at')}</p>
                <p className="mt-0.5 font-medium">{r.checkin_at ?? '—'}</p>
              </li>
              <li>
                <p className="text-xs uppercase tracking-wide text-slate-500">{t('Checkout at')}</p>
                <p className="mt-0.5 font-medium">{r.checkout_at ?? '—'}</p>
              </li>
            </ol>
            <p className="mt-3 flex items-center gap-1.5 text-sm text-slate-500">
              <CalendarClock className="h-4 w-4" aria-hidden="true" /> {num(r.reservation_hours)} {t('hours')}
            </p>
          </Card>

          <Card title={t('Room service orders')}>
            {r.sales_orders > 0 ? (
              <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-slate-500">{t('Orders')}</dt>
                  <dd className="text-lg font-semibold tabular-nums">{r.sales_orders}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">{t('Items')}</dt>
                  <dd className="text-lg font-semibold tabular-nums">{r.sales_items}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">{t('Tax')}</dt>
                  <dd className="text-lg font-semibold tabular-nums">{money(r.sales_tax_amount)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">{t('Discount')}</dt>
                  <dd className="text-lg font-semibold tabular-nums">{money(r.sale_discount_amount)}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-slate-500">{t('No room service orders yet. Orders taken in POS with the Room service type are added here.')}</p>
            )}
          </Card>

          {(r.note || r.staff_note) && closed && (
            <Card title={t('Notes')}>
              {r.note && <p className="whitespace-pre-line text-sm">{r.note}</p>}
              {r.staff_note && (
                <p className="mt-2 whitespace-pre-line text-sm text-slate-500">
                  <span className="font-medium">{t('Staff note')}:</span> {r.staff_note}
                </p>
              )}
            </Card>
          )}
        </div>

        <aside className="space-y-5 lg:sticky lg:top-4 lg:self-start" ref={checkoutRef} id="checkout">
          <Card title={t('Bill')}>
            <dl className="space-y-2 text-sm">
              <Row label={t('Room charges')}>{money(r.sub_total)}</Row>
              <Row label={t('Room tax')}>{money(r.tax_amount)}</Row>
              <Row label={t('Total service charges')}>{money(roomTotal)}</Row>
              <Row label={t('Room service orders')}>{money(salesTotal)}</Row>
              <Row label={t('Total payable')} strong>
                {money(grandTotal)}
              </Row>
              <Row label={t('Paid')}>
                <span className="text-emerald-700 dark:text-emerald-400">{money(paid)}</span>
              </Row>
              <Row label={due >= 0 ? t('Due') : t('Change')}>
                <span className={due > 0.009 ? 'font-semibold text-red-600' : ''}>{money(Math.abs(due))}</span>
              </Row>
            </dl>
          </Card>

          <Card title={t('Payments')}>
            {payments.length ? (
              <ul className="mb-3 divide-y divide-slate-200 rounded-lg border border-slate-200 text-sm dark:divide-slate-800 dark:border-slate-800">
                {payments.map((p, i) => (
                  <li key={i} className="flex items-center gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium tabular-nums">{money(p.amount)}</p>
                      <p className="truncate text-xs text-slate-500">{[p.description, p.at].filter(Boolean).join(' · ')}</p>
                    </div>
                    {!closed && (
                      <button
                        type="button"
                        className="btn-ghost btn-sm text-red-600"
                        aria-label={`${t('Remove')} ${money(p.amount)}`}
                        onClick={() => setPayments((list) => list.filter((_, j) => j !== i))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-3 text-sm text-slate-500">{t('No payments recorded yet.')}</p>
            )}
            {!closed && (
              <>
                <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
                  <Input
                    label={t('Amount')}
                    type="number"
                    min={0}
                    step="0.01"
                    value={payment.amount}
                    onChange={(e) => setPayment((p) => ({ ...p, amount: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addPayment())}
                  />
                  <Input
                    label={t('Description')}
                    value={payment.description}
                    onChange={(e) => setPayment((p) => ({ ...p, description: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addPayment())}
                  />
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" icon={<Plus className="h-4 w-4" />} disabled={!(Number(payment.amount) > 0)} onClick={addPayment}>
                    {t('Add payment')}
                  </Button>
                  {due > 0.009 && (
                    <Button size="sm" variant="ghost" onClick={() => setPayment((p) => ({ ...p, amount: String(due) }))}>
                      {t('Fill due')} ({money(due)})
                    </Button>
                  )}
                </div>
                <div className="mt-4 space-y-3">
                  <Textarea label={t('Note')} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                  <Textarea label={t('Staff note')} rows={2} value={staffNote} onChange={(e) => setStaffNote(e.target.value)} />
                </div>
                <div className="mt-4 space-y-2 border-t border-slate-200 pt-4 dark:border-slate-800">
                  <Button className="w-full justify-center" icon={<Save className="h-4 w-4" />} loading={saving && !checkout} disabled={!paymentsChanged} onClick={() => submitCheckout(false)}>
                    {t('Save payments')}
                  </Button>
                  {(
                    <>
                      <Checkbox label={t('Checkout/close and print final invoice')} checked={checkout} onChange={setCheckout} />
                      {checkout && (
                        <>
                          <Button
                            variant="success"
                            className="w-full justify-center"
                            icon={<LogOut className="h-4 w-4" />}
                            loading={saving}
                            disabled={due > 0.009}
                            onClick={() => submitCheckout(true)}
                          >
                            {t('Check out')}
                          </Button>
                          {due > 0.009 && <p className="text-center text-xs text-red-600">({t('Clear due payments to checkout')})</p>}
                        </>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
