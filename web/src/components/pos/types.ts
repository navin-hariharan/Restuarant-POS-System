import type { CartItem, TaxSetup } from '@/lib/cart';

export type Category = { id: number; name: string; image?: string };

export type ServiceTable = { id: number; title: string; is_booked?: boolean | number; is_open?: boolean };

export type PickupPoint = {
  id: number;
  place_title: string;
  person_name?: string | null;
  phone?: string | null;
  address?: string | null;
};

export type Customer = {
  id: number;
  uuid?: string;
  name: string;
  full_name?: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  shipping_addresses?: string[];
};

export type Reservation = {
  id: number;
  uuid?: string;
  tracking: string;
  customer?: { id?: number; name?: string; phone?: string | null } | null;
  guest_room?: { id?: number; room_name?: string } | null;
  checkin_at?: string | null;
  checkout_at?: string | null;
};

export type PaymentMethod = { id: number; title: string };

export type Tax = TaxSetup & { id: number; tax_title: string };

export type SubmittedOrder = {
  id: number;
  uuid: string;
  tracking: string;
  customer?: Customer | null;
  service_table?: ServiceTable | null;
  pickup_point?: PickupPoint | null;
  payable_after_all: number | string;
  order_type: string;
  progress: number;
  created_at: string;
  updated_at: string;
};

/** PosBillingSaleOrderResource (POST pos/submited-sale) */
export type BillingOrder = {
  id: number;
  uuid: string;
  tracking: string;
  customer_id: number | null;
  items: CartItem[];
  cart_total_price: number;
  cart_total_cost: number;
  payable_after_all: number;
  discount_rate: number | string | null;
  is_discount_in_percentage: boolean | number | null;
  discount_amount: number;
  service_table?: ServiceTable | null;
  customer?: Customer | null;
  order_type: string;
  payment_method_id?: number | null;
  pickup_point?: PickupPoint | null;
  guest_room_reservation?: Reservation | null;
  guest_room_reservation_id?: number | null;
  tax: TaxSetup | null;
  tip_amount?: number | string | null;
  shipping_address?: string | null;
  tax_amount?: number;
  progress?: number;
  payment_note?: string | null;
  staff_note?: string | null;
  note_for_chef?: string | null;
  took_at?: string | null;
  prepared_at?: string | null;
  chef_id?: number | null;
  order_taker_id?: number | null;
  is_item_based_taxation?: boolean | number | null;
};

export type Cashbook = {
  id: number;
  uuid: string;
  user: string;
  opening_amount: number | string;
  closed: boolean;
  sales_amount: number | string;
  discount_amount: number | string;
  tax_amount: number | string;
  total_profit: number | string;
  sold_items: number;
  sales: number;
  in_progress: number;
  in_completed: number;
  in_cancelled: number;
  is_closable: boolean;
  expenses_amount: number | string;
  final_amount: number | string;
  created_at: string;
};
