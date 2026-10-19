import clsx from 'clsx';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { truthy, type CartItem } from '@/lib/cart';
import { useConfig, useT } from '@/providers/AppProviders';
import { Barcode } from './Barcode';
import { KV, ReceiptFooter, ReceiptFrame, ReceiptHeader, px } from './ReceiptFrame';

type ReservationPrint = {
  id: number;
  uuid: string;
  tracking: string;
  customer?: { name: string; email?: string | null; phone?: string | null; address?: string | null } | null;
  guest_room?: { room_name: string; per_hour_charges?: number | string; per_use_charges?: number | string } | null;
  payment_status?: boolean | number;
  tax_amount: number | string;
  tax?: { tax_title?: string } | null;
  total_room_service_charges: number | string;
  reserved_at_date?: string;
  reserved_at_time?: string;
  reserved_till_date?: string;
  reserved_till_time?: string;
  is_charge_per_use?: boolean | number;
  reservation_hours?: number | string;
  sub_total: number | string;
  sales_tax_amount: number | string;
  sale_discount_amount: number | string;
  sales_payable_amount: number | string;
  sales_items: number;
  sales_orders: number;
  orders: { id: number; tracking: string; items: CartItem[]; created_at: string; is_cancelled?: boolean }[];
  payments: { amount: number | string; [k: string]: any }[];
  created_at: string;
};

export default function PrintReservation() {
  const t = useT();
  const { uuid } = useParams<{ uuid: string }>();
  const { config, money } = useConfig();
  const p = config.printer;
  const q = useQuery({
    queryKey: ['print', 'reservation', uuid],
    queryFn: async () => (await api.get<ReservationPrint>(`pos/print-guest-room-reserations/${uuid}`)).data,
    enabled: !!uuid,
  });
  const r = q.data;

  const totalPayable = r ? Number(r.sales_payable_amount) + Number(r.total_room_service_charges) : 0;
  const paid = (r?.payments ?? []).reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const due = totalPayable - paid;
  const taxTitle = r?.tax?.tax_title ?? t('Tax');

  return (
    <ReceiptFrame ready={!!r} loading={q.isLoading} title={r ? `#${r.tracking}` : t('Reservations')}>
      {r && (
        <>
          <ReceiptHeader />
          <section className="space-y-0.5" style={{ fontSize: px(p.print_header_footer_size, 12) }}>
            <KV label={t('Reservation date')}>{r.created_at}</KV>
            <KV label={t('Reservation ID')}>#{r.tracking} [ {r.id} ]</KV>
            {config.tax_id && config.modes.taxation && <KV label={t('TAX ID')}>{config.tax_id}</KV>}
            {r.customer && (
              <>
                <KV label={t('Customer name')}>{r.customer.name}</KV>
                {r.customer.email && <KV label={t('Email')}>{r.customer.email}</KV>}
                {r.customer.phone && <KV label={t('Phone')}>{r.customer.phone}</KV>}
                {r.customer.address && <KV label={t('Address')}>{r.customer.address}</KV>}
              </>
            )}
            {r.guest_room && <KV label={t('Guest Room')}>{r.guest_room.room_name}</KV>}
            <KV label={t('Reserved from')}>{[r.reserved_at_date, r.reserved_at_time].filter(Boolean).join(' ')}</KV>
            <KV label={t('Reserved till')}>{[r.reserved_till_date, r.reserved_till_time].filter(Boolean).join(' ')}</KV>
            <KV label={t('Payment status')}>{truthy(r.payment_status) ? t('Cleared') : t('Not cleared')}</KV>
          </section>

          <section className="my-2" style={{ fontSize: px(p.print_items_font_size, 11) }}>
            {r.orders?.length > 0 && (
              <>
                <p className="my-1 text-center">- - - - - {t('Food order details')} - - - - -</p>
                {r.orders.map((o) => (
                  <div key={o.id} className="mb-2">
                    <div className="flex justify-between font-semibold">
                      <p>{t('Order')} # {o.tracking}</p>
                      <p>{t('At')} : {o.created_at}</p>
                    </div>
                    <ul className={clsx(o.is_cancelled && 'line-through')}>
                      {(o.items ?? []).map((i, idx) => (
                        <li key={i.cart_uuid ?? idx} className="flex justify-between gap-2 border-t border-dashed border-current py-0.5">
                          <div className="min-w-0">
                            <p>{i.qty} × {i.name}</p>
                            {(i.modifiers ?? [])
                              .filter((m) => m.is_checked)
                              .map((m) => (
                                <p key={m.id} className="ps-2 text-[0.9em]">+ {m.title} x{m.qty}</p>
                              ))}
                          </div>
                          <div className="shrink-0 text-end tabular-nums">
                            <p>{i.price}x{i.qty}</p>
                            {Number(i.modifiers_price) > 0 && <p>+ {money(i.modifiers_price)}</p>}
                            <p className="font-semibold">= {money(i.sub_total)}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </>
            )}
          </section>

          <section className="space-y-0.5" style={{ fontSize: px(p.print_header_footer_size, 12) }}>
            <Block title={t('Room charges')}>
              <Line label={t('Room reservation hours')} value={r.reservation_hours ?? '-'} />
              {r.guest_room && (
                <Line
                  label={truthy(r.is_charge_per_use) ? t('Room charges') : t('Room charges per hour')}
                  value={money(truthy(r.is_charge_per_use) ? r.guest_room.per_use_charges : r.guest_room.per_hour_charges)}
                />
              )}
              <Line label={t('Subtotal')} value={money(r.sub_total)} />
              <Line label={taxTitle} value={money(r.tax_amount)} />
              <Line label={t('Total service charges')} value={money(r.total_room_service_charges)} strong />
            </Block>
            {Number(r.sales_orders) > 0 && (
              <Block title={t('Food charges')}>
                <Line label={t('Food order items')} value={r.sales_items} />
                <Line label={t('Orders')} value={r.sales_orders} />
                {Number(r.sales_tax_amount) > 0 && <Line label={taxTitle} value={money(r.sales_tax_amount)} />}
                <Line label={t('Food orders discount')} value={money(r.sale_discount_amount)} />
                <Line label={t('Food order payable amount')} value={money(r.sales_payable_amount)} strong />
              </Block>
            )}
            <div className="space-y-0.5 border-t border-current pt-1 font-bold">
              <Line label={t('Total Payable')} value={money(totalPayable)} strong />
              <Line label={t('Paid amount')} value={money(paid)} />
              <Line label={t('Due amount')} value={money(due)} strong />
            </div>
          </section>

          <ReceiptFooter />
          <div className="mt-3 flex justify-center">
            <Barcode value={r.tracking} height={36} module={1.2} />
          </div>
        </>
      )}
    </ReceiptFrame>
  );
}

function Block({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="border-t border-dashed border-current py-1">
      <p className="font-bold uppercase">{title}</p>
      {children}
    </div>
  );
}

function Line({ label, value, strong }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <div className={clsx('flex justify-between gap-2', strong && 'font-bold')}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
