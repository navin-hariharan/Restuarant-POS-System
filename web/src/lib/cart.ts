/**
 * Cart and order math. Mirrors the old Vue UI exactly so totals stored in
 * existing sales rows stay comparable. See docs/cart-contract.md.
 */

export type TaxSetup = {
  id?: number | null;
  tax_title?: string;
  tax_rate?: number | string | null;
  rate?: number | string | null;
  is_vat?: boolean | number | null;
  is_tax_fix?: boolean | number | null;
  is_tax_included?: boolean | number | null;
  tax_id?: string | null;
};

export type CartModifier = {
  id: number;
  title: string;
  price: number | string;
  cost: number | string;
  qty: number;
  is_checked?: boolean;
  selected_at?: number;
  [key: string]: any;
};

export type CartItem = {
  cart_uuid: string;
  uuid: string;
  id: number;
  food_item_id: number | null;
  name: string;
  upc?: string;
  image?: string;
  price: number | string;
  cost: number | string;
  in_stock?: number;
  qty: number;
  sub_total: number;
  sub_total_before_tax?: number;
  data?: any;
  modifiers: CartModifier[];
  modifiers_price: number;
  modifiers_cost: number;
  is_ready: boolean;
  is_bar_type?: boolean;
  not_display?: boolean;
  note?: string;
  tax_id?: number | null;
  tax_setup: TaxSetup;
  tax_amount: number | string;
  [key: string]: any;
};

/** A product (or variant) as returned by GET pos/products. */
export type PosProduct = {
  id: number;
  uuid: string;
  name: string;
  food_item_id?: number | null;
  food_item_name?: string;
  image?: string;
  sku?: string;
  upc?: string;
  price: number | string;
  cost: number | string;
  in_stock?: number;
  is_bar_type?: boolean;
  is_ready?: boolean;
  has_variants?: boolean;
  description?: string;
  modifiers?: CartModifier[];
  variants?: PosProduct[];
  tax_setup?: TaxSetup | null;
  [key: string]: any;
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const truthy = (v: unknown) => v === true || v === 1 || v === '1' || v === 'true';

export function taxRate(tax: TaxSetup | null | undefined): number {
  if (!tax) return 0;
  return num(tax.tax_rate ?? tax.rate);
}

/** Tax for a base amount using the VAT / fixed / percent rules. */
export function taxFor(base: number, tax: TaxSetup | null | undefined): number {
  if (!tax) return 0;
  const rate = taxRate(tax);
  let value: number;
  if (truthy(tax.is_vat)) {
    value = truthy(tax.is_tax_included) ? base - base / (1 + rate / 100) : base * (rate / 100);
  } else if (truthy(tax.is_tax_fix)) {
    value = rate;
  } else {
    value = base * (rate / 100);
  }
  return Number(value.toFixed(2));
}

/** Apply item-level tax to a line (only used with item-based taxation). */
export function applyItemTax(item: CartItem): CartItem {
  const base = num(item.sub_total);
  const tax = taxFor(base, item.tax_setup);
  item.tax_amount = tax.toFixed(2);
  if (truthy(item.tax_setup?.is_tax_included)) {
    item.sub_total_before_tax = base - tax;
    item.sub_total = base;
  } else {
    item.sub_total_before_tax = base;
    item.sub_total = base + tax;
  }
  return item;
}

/** Recompute modifiers, sub_total and (optionally) item tax for one line. */
export function recalcItem(item: CartItem, itemBasedTax: boolean): CartItem {
  item.modifiers_price = 0;
  item.modifiers_cost = 0;
  item.sub_total = num(item.qty) * num(item.price);
  if (item.modifiers?.length) {
    for (const m of item.modifiers) {
      if (m.is_checked) {
        item.modifiers_price += num(m.qty) * num(m.price);
        item.modifiers_cost += num(m.qty) * num(m.cost);
      }
    }
    item.sub_total += item.modifiers_price;
  }
  if (itemBasedTax) applyItemTax(item);
  return item;
}

let seq = 0;
export function makeCartItem(product: PosProduct, opts: { isReady?: boolean; defaultTax?: TaxSetup | null } = {}): CartItem {
  const tax = product.tax_setup ?? opts.defaultTax ?? {};
  return {
    cart_uuid: `${product.id}${product.uuid}${Date.now()}${seq++}`,
    uuid: product.uuid,
    id: product.id,
    food_item_id: product.food_item_id ?? null,
    name: product.food_item_name ? `${product.food_item_name} (${product.name})` : product.name,
    upc: product.upc,
    image: product.image,
    price: product.price,
    cost: product.cost,
    in_stock: product.in_stock,
    qty: 0,
    sub_total: 0,
    data: product,
    modifiers: (product.modifiers ?? []).map((m) => ({ ...m, qty: m.qty ?? 1, is_checked: !!m.is_checked })),
    modifiers_price: 0,
    modifiers_cost: 0,
    is_ready: !!opts.isReady,
    is_bar_type: !!product.is_bar_type,
    tax_id: (tax as TaxSetup).id ?? null,
    tax_setup: tax as TaxSetup,
    tax_amount: 0,
  };
}

/**
 * Add a product to the cart. Like the old UI, adding the same product again
 * bumps the quantity of the existing line unless that line is already ready.
 * Returns a new array.
 */
export function addToCart(
  items: CartItem[],
  product: PosProduct,
  opts: { itemBasedTax: boolean; isReady?: boolean; defaultTax?: TaxSetup | null },
): CartItem[] {
  const next = items.map((i) => ({ ...i }));
  const existingIndex = next.findIndex((i) => i.id == product.id && i.uuid == product.uuid && !i.is_ready);
  let line: CartItem;
  if (existingIndex >= 0) {
    line = next.splice(existingIndex, 1)[0];
  } else {
    line = makeCartItem(product, { isReady: opts.isReady, defaultTax: opts.defaultTax });
  }
  line.qty = num(line.qty) + 1;
  recalcItem(line, opts.itemBasedTax);
  next.push(line);
  return next;
}

export type OrderInput = {
  items: CartItem[];
  isItemBasedTaxation: boolean;
  tax: TaxSetup | null | undefined;
  discountRate: number | string;
  isDiscountInPercentage: boolean;
  tipAmount?: number | string;
  recipientAmount?: number | string;
  /** Stored cost (used for profit at checkout of an existing order). Defaults to the cart cost. */
  cartTotalCost?: number;
};

export type OrderTotals = {
  cartTotalItems: number;
  cartTotalPrice: number;
  cartTotalCost: number;
  netAmount: number;
  discountAmount: number;
  afterDiscount: number;
  taxAmount: number;
  totalAmount: number;
  profit: number;
  totalWithTip: number;
  change: number;
  progress: number;
};

export function orderTotals(input: OrderInput): OrderTotals {
  const items = input.items ?? [];
  const cartTotalItems = items.reduce((s, i) => s + num(i.qty), 0);
  const cartTotalPrice = items.reduce((s, i) => s + num(i.sub_total), 0);
  const cartTotalCost = items.reduce((s, i) => s + num(num(i.cost) * num(i.qty)) + num(i.modifiers_cost), 0);
  const discountAmount = input.isDiscountInPercentage
    ? num(input.discountRate) / 100 * cartTotalPrice
    : num(input.discountRate);
  const afterDiscount = cartTotalPrice - discountAmount;
  const taxIncluded = truthy(input.tax?.is_tax_included);

  let taxAmount: number;
  if (input.isItemBasedTaxation) {
    taxAmount = items.reduce((s, i) => s + num(i.tax_amount), 0);
  } else {
    taxAmount = taxFor(afterDiscount, input.tax);
  }

  let netAmount: number;
  if (input.isItemBasedTaxation) netAmount = items.reduce((s, i) => s + num(i.sub_total_before_tax), 0);
  else netAmount = taxIncluded ? cartTotalPrice - taxAmount : cartTotalPrice;

  let totalAmount: number;
  if (input.isItemBasedTaxation) totalAmount = afterDiscount;
  else totalAmount = taxIncluded ? afterDiscount : afterDiscount + taxAmount;

  const cost = input.cartTotalCost ?? cartTotalCost;
  const profit = afterDiscount - cost;
  const totalWithTip = num(input.tipAmount) + totalAmount;
  const change = num(input.recipientAmount) - totalWithTip;
  const ready = items.filter((i) => i.is_ready).length;
  const progress = items.length ? Math.round((ready / items.length) * 100) : 0;

  return {
    cartTotalItems,
    cartTotalPrice,
    cartTotalCost,
    netAmount,
    discountAmount,
    afterDiscount,
    taxAmount,
    totalAmount,
    profit,
    totalWithTip,
    change,
    progress,
  };
}

/** Round to cents for display/storage without drifting the math above. */
export const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

