import { describe, expect, it } from 'vitest';
import { addToCart, orderTotals, recalcItem, taxFor, type PosProduct } from './cart';

const burger: PosProduct = { id: 1, uuid: 'u1', name: 'Burger', price: 10, cost: 4, modifiers: [{ id: 9, title: 'Cheese', price: 2, cost: 1, qty: 1, is_checked: true }] };
const cola: PosProduct = { id: 2, uuid: 'u2', name: 'Cola', price: '3.5', cost: '1', modifiers: [] };

describe('cart lines', () => {
  it('adds and merges same product', () => {
    let items = addToCart([], burger, { itemBasedTax: false });
    items = addToCart(items, burger, { itemBasedTax: false });
    expect(items).toHaveLength(1);
    expect(items[0].qty).toBe(2);
    // 2*10 + checked modifier 1*2
    expect(items[0].sub_total).toBe(22);
    expect(items[0].modifiers_cost).toBe(1);
  });

  it('does not merge into a ready line', () => {
    let items = addToCart([], cola, { itemBasedTax: false, isReady: true });
    items = addToCart(items, cola, { itemBasedTax: false });
    expect(items).toHaveLength(2);
    expect(items[1].is_ready).toBe(false);
  });

  it('variant name format', () => {
    const items = addToCart([], { ...cola, food_item_id: 7, food_item_name: 'Soda', name: 'Large' }, { itemBasedTax: false });
    expect(items[0].name).toBe('Soda (Large)');
    expect(items[0].food_item_id).toBe(7);
  });
});

describe('tax rules', () => {
  it('percent', () => expect(taxFor(100, { tax_rate: 15 })).toBe(15));
  it('fixed', () => expect(taxFor(100, { tax_rate: 5, is_tax_fix: true })).toBe(5));
  it('vat excluded', () => expect(taxFor(100, { tax_rate: 20, is_vat: true })).toBe(20));
  it('vat included', () => expect(taxFor(120, { tax_rate: 20, is_vat: true, is_tax_included: true })).toBe(20));
  it('no tax', () => expect(taxFor(100, null)).toBe(0));
});

describe('order totals', () => {
  const items = addToCart(addToCart([], burger, { itemBasedTax: false }), cola, { itemBasedTax: false });

  it('percent discount + order tax excluded + tip', () => {
    const t = orderTotals({ items, isItemBasedTaxation: false, tax: { tax_rate: 10 }, discountRate: 10, isDiscountInPercentage: true, tipAmount: 2, recipientAmount: 20 });
    expect(t.cartTotalPrice).toBe(15.5);
    expect(t.discountAmount).toBeCloseTo(1.55);
    expect(t.afterDiscount).toBeCloseTo(13.95);
    expect(t.taxAmount).toBe(1.4); // 1.395 -> toFixed(2)
    expect(t.totalAmount).toBeCloseTo(15.35);
    expect(t.netAmount).toBe(15.5);
    expect(t.cartTotalCost).toBe(6); // 4 + 1 modifier + 1
    expect(t.profit).toBeCloseTo(7.95);
    expect(t.totalWithTip).toBeCloseTo(17.35);
    expect(t.change).toBeCloseTo(2.65);
  });

  it('fixed discount + VAT included', () => {
    const t = orderTotals({ items, isItemBasedTaxation: false, tax: { tax_rate: 20, is_vat: true, is_tax_included: true }, discountRate: 3.5, isDiscountInPercentage: false });
    expect(t.afterDiscount).toBe(12);
    expect(t.taxAmount).toBe(2);
    expect(t.totalAmount).toBe(12);
    expect(t.netAmount).toBe(13.5);
  });

  it('item based taxation', () => {
    const taxed = addToCart([], { ...cola, tax_setup: { tax_rate: 10 } }, { itemBasedTax: true });
    expect(taxed[0].tax_amount).toBe('0.35');
    expect(taxed[0].sub_total).toBeCloseTo(3.85);
    const t = orderTotals({ items: taxed, isItemBasedTaxation: true, tax: null, discountRate: 0, isDiscountInPercentage: true });
    expect(t.taxAmount).toBeCloseTo(0.35);
    expect(t.netAmount).toBe(3.5);
    expect(t.totalAmount).toBeCloseTo(3.85);
  });

  it('progress counts ready lines', () => {
    const lines = items.map((i, n) => ({ ...i, is_ready: n === 0 }));
    expect(orderTotals({ items: lines, isItemBasedTaxation: false, tax: null, discountRate: 0, isDiscountInPercentage: false }).progress).toBe(50);
  });

  it('unchecking a modifier updates the line', () => {
    const line = { ...items[0], modifiers: items[0].modifiers.map((m) => ({ ...m, is_checked: false })) };
    recalcItem(line, false);
    expect(line.sub_total).toBe(10);
    expect(line.modifiers_price).toBe(0);
  });
});
