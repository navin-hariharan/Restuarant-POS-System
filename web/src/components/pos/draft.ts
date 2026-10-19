/**
 * In-progress POS order ("draft"): state shape, localStorage persistence and the
 * request payloads for POST admin/sales, PATCH admin/sales/{uuid} and
 * POST pos/checkout/{uuid}. All math comes from `@/lib/cart` (see docs/cart-contract.md).
 */
import { money, orderTotals, truthy, type CartItem, type OrderTotals, type TaxSetup } from '@/lib/cart';
import { storage } from '@/lib/format';
import type { BillingOrder, Customer, PickupPoint, Reservation, ServiceTable } from './types';

export const DRAFT_KEY = 'pos-cart-draft';
export const ACK_KEY = 'acknowledged-orders';
export const DEFAULT_ORDER_TYPE_KEY = 'default_order_type';
export const COLS_KEY = 'cols_in_row';
export const PER_PAGE_KEY = 'per_page';

export type Draft = {
  uuid: string | null;
  tracking: string | null;
  items: CartItem[];
  order_type: string;
  table: ServiceTable | null;
  pickup_point: PickupPoint | null;
  shipping_address: string | null;
  reservation: Reservation | null;
  customer: Customer | null;
  discount_rate: number | string;
  is_discount_in_percentage: boolean;
  tax: TaxSetup;
  note_for_chef: string;
  staff_note: string;
  payment_note: string;
  tip_amount: number | string;
  payment_method_id: number | null;
  is_item_based_taxation: boolean;
  // Carried over from an existing order (kept on update / used for split orders)
  took_at?: string | null;
  order_taker_id?: number | null;
  chef_id?: number | null;
  prepared_at?: string | null;
  /** Table held by the loaded order (selectable even though it is booked). */
  own_table_id?: number | null;
  /** JSON fingerprint of the loaded order, to know whether the cart was changed. */
  snapshot?: string | null;
};

export function defaultOrderType(types: { key: string }[]): string {
  const saved = storage.get<string | null>(DEFAULT_ORDER_TYPE_KEY, null);
  // old UI stored the raw string (not JSON); storage.get falls back on parse errors
  let raw: string | null = saved;
  if (raw === null) {
    try {
      raw = localStorage.getItem(DEFAULT_ORDER_TYPE_KEY);
    } catch {
      raw = null;
    }
  }
  if (raw && types.some((t) => t.key === raw)) return raw;
  return types[0]?.key ?? 'dining';
}

export function emptyDraft(opts: { orderType: string; tax: TaxSetup; itemBasedTax: boolean; customer?: Customer | null }): Draft {
  return {
    uuid: null,
    tracking: null,
    items: [],
    order_type: opts.orderType,
    table: null,
    pickup_point: null,
    shipping_address: null,
    reservation: null,
    customer: opts.customer ?? null,
    discount_rate: 0,
    is_discount_in_percentage: true,
    tax: opts.tax,
    note_for_chef: '',
    staff_note: '',
    payment_note: '',
    tip_amount: 0,
    payment_method_id: null,
    is_item_based_taxation: opts.itemBasedTax,
    snapshot: null,
  };
}

export function slimCustomer(c: Customer | null | undefined): Customer | null {
  if (!c) return null;
  return {
    id: c.id,
    uuid: c.uuid,
    name: c.name,
    email: c.email ?? null,
    phone: c.phone ?? null,
    address: c.address ?? null,
    shipping_addresses: Array.isArray(c.shipping_addresses) ? c.shipping_addresses.filter(Boolean) : [],
  };
}

export function slimReservation(r: Reservation | null | undefined): Reservation | null {
  if (!r || !r.id) return null;
  return {
    id: r.id,
    uuid: r.uuid,
    tracking: r.tracking,
    checkin_at: r.checkin_at ?? null,
    customer: r.customer ? { id: r.customer.id, name: r.customer.name, phone: r.customer.phone ?? null } : null,
    guest_room: r.guest_room ? { id: r.guest_room.id, room_name: r.guest_room.room_name } : null,
  };
}

/** Fingerprint of everything that a PATCH would change. */
export function fingerprint(d: Draft): string {
  return JSON.stringify([
    d.items.map((i) => [i.cart_uuid, i.qty, i.price, i.name, i.note ?? '', i.is_ready, i.not_display ?? false, i.tax_id ?? null, i.modifiers_price]),
    d.order_type,
    d.table?.id ?? null,
    d.pickup_point?.id ?? null,
    d.shipping_address ?? null,
    d.reservation?.id ?? null,
    d.customer?.id ?? null,
    Number(d.discount_rate) || 0,
    d.is_discount_in_percentage,
    (d.tax as any)?.id ?? (d.tax as any)?.tax_title ?? null,
    d.note_for_chef ?? '',
    d.staff_note ?? '',
  ]);
}

export function draftFromOrder(o: BillingOrder, fallbackTax: TaxSetup): Draft {
  const d: Draft = {
    uuid: o.uuid,
    tracking: o.tracking,
    items: Array.isArray(o.items) ? o.items.map((i) => ({ ...i, modifiers: Array.isArray(i.modifiers) ? i.modifiers : [] })) : [],
    order_type: o.order_type,
    table: o.service_table?.id ? o.service_table : null,
    pickup_point: o.pickup_point?.id ? o.pickup_point : null,
    shipping_address: o.shipping_address ?? null,
    reservation: slimReservation(o.guest_room_reservation),
    customer: slimCustomer(o.customer),
    discount_rate: o.discount_rate ?? 0,
    is_discount_in_percentage: o.is_discount_in_percentage === null || o.is_discount_in_percentage === undefined ? true : truthy(o.is_discount_in_percentage),
    tax: o.tax && typeof o.tax === 'object' && !Array.isArray(o.tax) ? o.tax : fallbackTax,
    note_for_chef: o.note_for_chef ?? '',
    staff_note: o.staff_note ?? '',
    payment_note: o.payment_note ?? '',
    tip_amount: o.tip_amount ?? 0,
    payment_method_id: o.payment_method_id ?? null,
    is_item_based_taxation: truthy(o.is_item_based_taxation),
    took_at: o.took_at ?? null,
    order_taker_id: o.order_taker_id ?? null,
    chef_id: o.chef_id ?? null,
    prepared_at: o.prepared_at ?? null,
    own_table_id: o.service_table?.id ?? null,
  };
  if (!d.reservation && o.guest_room_reservation_id) d.reservation = { id: o.guest_room_reservation_id, tracking: '' };
  d.snapshot = fingerprint(d);
  return d;
}

export function loadDraft(): Draft | null {
  const d = storage.get<Draft | null>(DRAFT_KEY, null);
  if (!d || typeof d !== 'object' || !Array.isArray(d.items)) return null;
  return d;
}

export function saveDraft(d: Draft | null) {
  if (!d) storage.remove(DRAFT_KEY);
  else storage.set(DRAFT_KEY, d);
}

export function totalsFor(d: Draft, extra: { recipientAmount?: number | string; tipAmount?: number | string } = {}): OrderTotals {
  return orderTotals({
    items: d.items,
    isItemBasedTaxation: d.is_item_based_taxation,
    tax: d.tax,
    discountRate: d.discount_rate,
    isDiscountInPercentage: d.is_discount_in_percentage,
    tipAmount: extra.tipAmount ?? d.tip_amount,
    recipientAmount: extra.recipientAmount,
  });
}

/** Body for POST admin/sales and PATCH admin/sales/{uuid}. */
export function orderPayload(d: Draft, opts: { isSpliting?: boolean; progress?: number } = {}) {
  const t = totalsFor(d);
  const type = d.order_type;
  const body: Record<string, any> = {
    items: d.items,
    tax: d.tax,
    tax_amount: money(t.taxAmount),
    cart_total_items: t.cartTotalItems,
    cart_total_price: money(t.netAmount),
    cart_total_cost: money(t.cartTotalCost),
    payable_after_all: money(t.totalAmount),
    discount_amount: money(t.discountAmount),
    discount_rate: Number(d.discount_rate) || 0,
    is_discount_in_percentage: !!d.is_discount_in_percentage,
    profit_after_all: money(t.profit),
    progress: opts.progress ?? t.progress,
    order_type: type,
    customer_id: d.customer?.id ?? null,
    table_id: type === 'dining' ? d.table?.id ?? null : null,
    pickup_point_id: type === 'pickup' ? d.pickup_point?.id ?? null : null,
    shipping_address: type === 'dilivery' ? d.shipping_address || null : null,
    guest_room_reservation_id: type === 'roomservice' ? d.reservation?.id ?? null : null,
    note_for_chef: d.note_for_chef || null,
    staff_note: d.staff_note || null,
    is_spliting: !!opts.isSpliting,
    is_item_based_taxation: !!d.is_item_based_taxation,
  };
  for (const k of ['took_at', 'order_taker_id', 'chef_id', 'prepared_at'] as const) {
    if (d[k] !== undefined && d[k] !== null) body[k] = d[k];
  }
  return body;
}

/** Body for POST pos/checkout/{uuid}. */
export function checkoutPayload(
  d: Draft,
  p: { payment_method_id: number; payment_note: string; staff_note: string; tip_amount: number | string },
) {
  return {
    ...orderPayload({ ...d, staff_note: p.staff_note }),
    payment_method_id: p.payment_method_id,
    payment_note: p.payment_note || null,
    staff_note: p.staff_note || null,
    tip_amount: Number(p.tip_amount) || 0,
  };
}

/**
 * Products per row on large screens; 0 = automatic (as many as fit, the default).
 * The old UI stored a Tailwind class like "lg:grid-cols-6".
 */
export function readCols(): number {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(COLS_KEY);
  } catch {
    raw = null;
  }
  const m = raw?.match(/(\d+)/);
  if (!m) return 0;
  return Math.min(8, Math.max(2, Number(m[1]) || 5));
}
export function writeCols(n: number) {
  try {
    localStorage.setItem(COLS_KEY, n ? `lg:grid-cols-${n}` : 'auto');
  } catch {
    /* ignore */
  }
}
export function readPerPage(): number {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(PER_PAGE_KEY);
  } catch {
    raw = null;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 18;
}
export function writePerPage(n: number) {
  try {
    localStorage.setItem(PER_PAGE_KEY, String(n));
  } catch {
    /* ignore */
  }
}
export function writeDefaultOrderType(key: string) {
  try {
    localStorage.setItem(DEFAULT_ORDER_TYPE_KEY, key);
  } catch {
    /* ignore */
  }
}

export function readAcknowledged(): string[] {
  const v = storage.get<unknown>(ACK_KEY, []);
  return Array.isArray(v) ? v.map(String) : [];
}
export function writeAcknowledged(ids: string[]) {
  storage.set(ACK_KEY, ids);
}

export const orderTypeLabel = (types: { key: string; title: string }[], key: string) =>
  types.find((t) => t.key === key)?.title ?? key;
