import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { taxFor, truthy, type TaxSetup } from '@/lib/cart';

export type Slot = { reserved_at_date: string; reserved_at_time: string; reserved_till_date: string; reserved_till_time: string };

export type GuestRoom = {
  id: number;
  room_name: string;
  capactity: number | string;
  per_hour_charges: number | string;
  per_use_charges: number | string;
  layout: string | null;
  reserved_slots: Slot[];
};

export type Customer = { id: number; uuid: string; name: string; email: string | null; phone: string | null; address: string | null };
export type TitleRow = { id: number; title: string };
export type ReservationTax = TaxSetup & { id?: number };

export type Payment = { amount: number | string; at: string; description?: string | null };

export type ReservationRow = {
  id: number;
  uuid: string;
  tracking: string;
  customer: Customer | null;
  booking_source: TitleRow | null;
  reservation_status: TitleRow | null;
  guest_room: GuestRoom | null;
  payment_cleared: boolean;
  tax_amount: number | string;
  total_room_service_charges: number | string;
  reserved_at_date: string;
  reserved_at_time: string;
  checkin_at: string | null;
  checkout_at: string | null;
  reservation_hours: number | string;
  sub_total: number | string;
  created_at: string;
};

export type ReservationDetail = ReservationRow & {
  customer_id: number;
  booking_source_id: number;
  reservation_status_id: number;
  guest_room_id: number;
  payments: Payment[];
  note: string | null;
  staff_note: string | null;
  reserved_till_date: string;
  reserved_till_time: string;
  tax: ReservationTax | null;
  sales_tax_amount: number | string;
  sale_discount_amount: number | string;
  sales_payable_amount: number | string;
  sales_items: number;
  sales_orders: number;
  is_charge_per_use: boolean;
};

export type ReservationFilters = {
  customers: Customer[];
  statuses: TitleRow[];
  sources: TitleRow[];
  rooms: GuestRoom[];
  taxes: ReservationTax[];
};

/** Customers, statuses, sources, rooms and taxes in one call. */
export function useReservationFilters() {
  return useQuery({
    queryKey: ['admin/room-reservations-filters'],
    queryFn: async () => (await api.get<ReservationFilters>('admin/room-reservations-filters')).data,
  });
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const hhmm = (time: string | null | undefined) => (time ? String(time).slice(0, 5) : '');

export function toDateTime(date: string | null | undefined, time: string | null | undefined): Date | null {
  if (!date) return null;
  const d = new Date(`${date}T${hhmm(time) || '00:00'}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Hours between two date+time pairs (same rule as the old UI), never negative. */
export function hoursBetween(atDate: string, atTime: string, tillDate: string, tillTime: string): number {
  const a = toDateTime(atDate, atTime);
  const b = toDateTime(tillDate, tillTime);
  if (!a || !b) return 0;
  return Math.max(0, Math.round(((b.getTime() - a.getTime()) / 3_600_000) * 100) / 100);
}

/** Room charges for a booking: sub total, tax and total (tax included → total = sub total). */
export function roomCharges(opts: { room: GuestRoom | null | undefined; perUse: boolean; hours: number; tax: ReservationTax | null | undefined }) {
  const charges = opts.room ? num(opts.perUse ? opts.room.per_use_charges : opts.room.per_hour_charges) : 0;
  const subTotal = Math.round((opts.perUse ? charges : opts.hours * charges) * 100) / 100;
  const taxAmount = taxFor(subTotal, opts.tax ?? null);
  const included = truthy(opts.tax?.is_tax_included);
  const total = Math.round((included ? subTotal : subTotal + taxAmount) * 100) / 100;
  return { charges, subTotal, taxAmount, total };
}

/** Find booked slots of a room that overlap the requested period. */
export function overlappingSlots(room: GuestRoom | null | undefined, from: Date | null, till: Date | null, ignore?: Slot | null): Slot[] {
  if (!room || !from || !till) return [];
  const same = (a: Slot, b: Slot) =>
    a.reserved_at_date === b.reserved_at_date &&
    hhmm(a.reserved_at_time) === hhmm(b.reserved_at_time) &&
    a.reserved_till_date === b.reserved_till_date &&
    hhmm(a.reserved_till_time) === hhmm(b.reserved_till_time);
  let ignored = false;
  return (room.reserved_slots ?? []).filter((s) => {
    if (ignore && !ignored && same(s, ignore)) {
      ignored = true;
      return false;
    }
    const a = toDateTime(s.reserved_at_date, s.reserved_at_time);
    const b = toDateTime(s.reserved_till_date, s.reserved_till_time);
    return !!a && !!b && a < till && b > from;
  });
}

export const paidTotal = (payments: Payment[] | null | undefined) => (payments ?? []).reduce((s, p) => s + num(p.amount), 0);

/** dd/mm/yyyy hh:mm:ss like the old UI stored payment times. */
export function paymentTimestamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export type ReservationStage = 'booked' | 'checked_in' | 'checked_out';
export const stageOf = (r: Pick<ReservationRow, 'checkin_at' | 'checkout_at'>): ReservationStage =>
  r.checkout_at ? 'checked_out' : r.checkin_at ? 'checked_in' : 'booked';

/**
 * Body for PUT guest-room-reservations/{uuid} built from a details response
 * (used for quick check-in). `charges` is not in the details resource, so it
 * is recomputed from the room rates.
 */
export function updatePayloadFromDetail(r: ReservationDetail, extra: Record<string, unknown> = {}) {
  const hours = num(r.reservation_hours);
  const { charges } = roomCharges({ room: r.guest_room, perUse: !!r.is_charge_per_use, hours, tax: r.tax });
  return {
    customer_id: r.customer_id,
    guest_room_id: r.guest_room_id,
    booking_source_id: r.booking_source_id,
    reservation_status_id: r.reservation_status_id,
    reserved_at_date: r.reserved_at_date,
    reserved_at_time: hhmm(r.reserved_at_time),
    reserved_till_date: r.reserved_till_date,
    reserved_till_time: hhmm(r.reserved_till_time),
    tax: r.tax ?? {},
    tax_amount: r.tax_amount,
    reservation_hours: r.reservation_hours,
    charges,
    is_charge_per_use: !!r.is_charge_per_use,
    sub_total: r.sub_total,
    total_room_service_charges: r.total_room_service_charges,
    note: r.note,
    staff_note: r.staff_note,
    payments: r.payments ?? [],
    ...extra,
  };
}
