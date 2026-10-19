import clsx from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { ChefHat, Receipt } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { truthy, type CartItem } from '@/lib/cart';
import { Button } from '@/components/ui';
import { useConfig, useT } from '@/providers/AppProviders';
import { Barcode } from './Barcode';
import { KV, ReceiptFooter, ReceiptFrame, ReceiptHeader, px } from './ReceiptFrame';

type PrintOrder = {
  id: number;
  uuid: string;
  tracking: string;
  items: CartItem[];
  cart_total_price: number | string;
  payable_after_all: number | string;
  discount_amount: number | string;
  order_type: string | null;
  tax: { tax_title?: string; rate?: number | string; tax_rate?: number | string; is_tax_fix?: boolean } | null;
  pickup_point?: { place_title: string; person_name?: string | null; phone?: string | null; address?: string | null } | null;
  taker?: { name: string } | null;
  tax_amount: number | string;
  customer?: { name: string; email?: string | null; phone?: string | null; address?: string | null } | null;
  table?: { id: number; title: string } | null;
  shipping_address?: string | null;
  is_cancelled?: boolean | number;
  tip_amount?: number | string | null;
  progress: number;
  is_item_based_taxation?: boolean | number;
  created_at: string;
};

type Layout = 'l1' | 'l2' | 'l3' | 'l4';
/** Kitchen filter: all items, kitchen only, bar only. */
type Station = 'all' | 'kitchen' | 'bar';

const sortedModifiers = (item: CartItem) =>
  (item.modifiers ?? []).filter((m) => m.is_checked).sort((a, b) => (a.selected_at || 0) - (b.selected_at || 0));

export default function PrintSale() {
  const t = useT();
  const { uuid } = useParams<{ uuid: string }>();
  const [search, setSearch] = useSearchParams();
  const { config, money } = useConfig();
  const p = config.printer;
  const forKitchen = !!search.get('k_portal');
  const [layout, setLayout] = useState<Layout>(() => {
    let v: string | null = null;
    try {
      v = localStorage.getItem('defaultLayout');
    } catch {
      v = null;
    }
    return (['l1', 'l2', 'l3', 'l4'].includes(v ?? '') ? v : 'l1') as Layout;
  });
  const [station, setStation] = useState<Station>('all');

  const q = useQuery({
    queryKey: ['print', 'sale', uuid],
    queryFn: async () => (await api.get<PrintOrder>(`pos/sale/${uuid}`)).data,
    enabled: !!uuid,
  });
  const order = q.data;

  const changeLayout = (v: Layout) => {
    setLayout(v);
    try {
      localStorage.setItem('defaultLayout', v);
    } catch {
      /* ignore */
    }
  };

  const items = (order?.items ?? []).filter((i) => {
    if (!forKitchen) return true;
    if (i.not_display) return false;
    if (station === 'kitchen') return !i.is_bar_type;
    if (station === 'bar') return !!i.is_bar_type;
    return true;
  });
  const cancelled = truthy(order?.is_cancelled);
  const itemTax = truthy(order?.is_item_based_taxation) && config.modes.taxation;
  const tip = Number(order?.tip_amount) || 0;
  const isShipping = !!order?.shipping_address;

  const toolbar = (
    <>
      <select className="input h-11 w-auto" aria-label={t('Layout')} value={layout} onChange={(e) => changeLayout(e.target.value as Layout)}>
        <option value="l1">{t('Basic default')}</option>
        <option value="l2">{t('Layout 2')}</option>
        <option value="l3">{t('Layout 3')}</option>
        <option value="l4">{t('Layout 4')}</option>
      </select>
      {forKitchen && (
        <select className="input h-11 w-auto" aria-label={t('Items')} value={station} onChange={(e) => setStation(e.target.value as Station)}>
          <option value="all">{t('Display all items')}</option>
          <option value="kitchen">{t('Display items only related to kitchen')}</option>
          <option value="bar">{t('Display items only related to bar')}</option>
        </select>
      )}
      <Button
        className="h-11"
        icon={forKitchen ? <Receipt className="h-4 w-4" /> : <ChefHat className="h-4 w-4" />}
        onClick={() => {
          const next = new URLSearchParams(search);
          if (forKitchen) next.delete('k_portal');
          else next.set('k_portal', 'true');
          setSearch(next, { replace: true });
        }}
      >
        {forKitchen ? t('Recipient') : t('For kitchen')}
      </Button>
    </>
  );

  return (
    <ReceiptFrame ready={!!order} loading={q.isLoading} title={order ? `#${order.tracking}` : t('Print sale order')} toolbar={toolbar}>
      {order && (
        <>
          <ReceiptHeader heading={forKitchen ? <p className="uppercase tracking-wider">{t('For kitchen')}</p> : undefined} />

          <section className="space-y-0.5" style={{ fontSize: px(p.print_header_footer_size, 12) }}>
            {p.invoice_type && <KV label={t('Invoice type')}>{p.invoice_type}</KV>}
            <KV label={t('Invoice date')}>{order.created_at}</KV>
            <KV label={t('Invoice ID')}>
              #{order.tracking} [ {order.id} ]{cancelled && <span className="ms-1 font-bold">[{t('Cancelled')}]</span>}
            </KV>
            {config.tax_id && config.modes.taxation && <KV label={t('TAX ID')}>{config.tax_id}</KV>}
            <KV label={t('Type')} className="mb-1">
              {String(order.order_type ?? '').toUpperCase()}
              {order.table && ` (${order.table.title})`}
            </KV>
            {order.taker && <KV label={t('Order Taker')}>{order.taker.name}</KV>}
            {order.customer && <KV label={t('Customer name')}>{order.customer.name}</KV>}
            {order.customer && !forKitchen && (
              <>
                {order.customer.email && <KV label={t('Email')}>{order.customer.email}</KV>}
                {order.customer.phone && <KV label={t('Phone')}>{order.customer.phone}</KV>}
                {order.customer.address && <KV label={t('Address')}>{order.customer.address}</KV>}
                {isShipping && <KV label={t('Shipping to')}>{order.shipping_address}</KV>}
              </>
            )}
            {!forKitchen && order.pickup_point && (
              <div className="mt-1">
                <p className="font-bold uppercase">{t('Pickup information')}:</p>
                <p><strong>{t('Place').toUpperCase()}:</strong> {order.pickup_point.place_title}</p>
                {order.pickup_point.person_name && <p><strong>{t('Person').toUpperCase()}:</strong> {order.pickup_point.person_name}</p>}
                {order.pickup_point.phone && <p><strong>{t('Phone').toUpperCase()}:</strong> {order.pickup_point.phone}</p>}
                {order.pickup_point.address && <p><strong>{t('Address').toUpperCase()}:</strong> {order.pickup_point.address}</p>}
              </div>
            )}
          </section>

          <section className="my-2" style={{ fontSize: px(p.print_items_font_size, 11) }}>
            <Items layout={layout} items={items} forKitchen={forKitchen} cancelled={cancelled} itemTax={itemTax} money={money} />
          </section>

          {!forKitchen && (
            <>
              <section style={{ fontSize: px(p.print_header_footer_size, 12) }}>
                <div className="space-y-0.5 border-t border-dashed border-current py-1 font-semibold">
                  <Line label={t('Items')} value={order.items?.length ?? 0} />
                  <Line label={t('Net')} value={money(order.cart_total_price)} />
                </div>
                <div className="space-y-0.5 border-t border-dashed border-current py-1 font-semibold">
                  {Number(order.discount_amount) > 0 && <Line label={`${t('Discount')} (-)`} value={money(order.discount_amount)} />}
                  {Number(order.tax_amount) > 0 && config.modes.taxation && (
                    <Line
                      label={
                        truthy(order.is_item_based_taxation)
                          ? t('Tax')
                          : `${order.tax?.tax_title ?? t('Tax')} (${order.tax?.rate ?? order.tax?.tax_rate ?? 0}${truthy(order.tax?.is_tax_fix) ? ` ${t('fix')}` : '%'}) (+)`
                      }
                      value={money(order.tax_amount)}
                    />
                  )}
                  {tip > 0 && <Line label={`${t('Tip')} (+)`} value={money(tip)} />}
                  <div className="flex items-baseline justify-between border-t border-current pt-1 text-[1.15em] font-bold">
                    <div>
                      <p>{t('Total')}</p>
                      {tip > 0 && (
                        <p className="text-[0.6em] font-normal">
                          ({t('Payable')} {money(order.payable_after_all)} + {t('Tip')} {money(tip)})
                        </p>
                      )}
                    </div>
                    <p className="tabular-nums">{money(Number(order.payable_after_all) + tip)}</p>
                  </div>
                </div>
              </section>
              <ReceiptFooter />
              <div className="mt-3 flex justify-center">
                <Barcode value={order.tracking} height={36} module={1.2} />
              </div>
            </>
          )}

          {Number(order.progress) < 99 && (
            <p className="mt-2 text-center text-lg">
              {t('Progress')} {Math.round(Number(order.progress) || 0)}%
            </p>
          )}
        </>
      )}
    </ReceiptFrame>
  );
}

function Line({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function Items({
  layout,
  items,
  forKitchen,
  cancelled,
  itemTax,
  money,
}: {
  layout: Layout;
  items: CartItem[];
  forKitchen: boolean;
  cancelled: boolean;
  itemTax: boolean;
  money: (v: unknown) => string;
}) {
  const t = useT();
  const done = (i: CartItem) => (forKitchen && i.is_ready ? <span className="font-bold">[{t('Done')}] </span> : null);
  const note = (i: CartItem) =>
    i.note && (forKitchen || layout !== 'l1') ? (
      <p className="text-[0.9em]">
        <strong>{t('Instructions')}:</strong> {i.note}
      </p>
    ) : null;

  if (layout === 'l1') {
    return (
      <ul>
        {items.map((i, idx) => (
          <li key={i.cart_uuid ?? idx} className="flex border-t border-current py-1">
            <div className={clsx('min-w-0 flex-1 pe-1', cancelled && 'line-through')}>
              <p className="font-semibold">
                {done(i)}
                {i.qty} X {idx + 1}.{i.name}
              </p>
              <ul>
                {sortedModifiers(i).map((m) => (
                  <li key={m.id} className="flex justify-between px-2 text-[0.9em]">
                    <span>+ {m.title}</span>
                    <span>{forKitchen ? ` x${m.qty}` : `${money(m.price)} x ${m.qty}`}</span>
                  </li>
                ))}
              </ul>
              {note(i)}
            </div>
            <div className="w-[38%] shrink-0 border-s border-current ps-1 font-semibold tabular-nums">
              {forKitchen ? (
                <p>x{i.qty}</p>
              ) : (
                <>
                  <p>{i.price}x{i.qty}</p>
                  {Number(i.modifiers_price) > 0 && <p>+ {money(i.modifiers_price)}</p>}
                  {itemTax && Number(i.tax_amount) > 0 && <p>+ {money(i.tax_amount)}</p>}
                  <p className="border-t border-current">= {money(i.sub_total)}</p>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    );
  }

  const cell = 'border border-current px-1 py-0.5 align-top';
  if (layout === 'l4') {
    return (
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={cell}>{t('Qty')}</th>
            <th className={clsx(cell, 'text-start')}>{t('Item')}</th>
            {!forKitchen && itemTax && <th className={cell}>{t('Tax')}</th>}
            {!forKitchen && <th className={cell}>{t('Subtotal')}</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((i, idx) => (
            <tr key={i.cart_uuid ?? idx} className={clsx(cancelled && 'line-through')}>
              <td className={clsx(cell, 'text-center')}>{i.qty}</td>
              <td className={cell}>
                <p>{done(i)}{i.name}</p>
                {sortedModifiers(i).map((m) => (
                  <p key={m.id} className="text-[0.9em]">+ {m.title} x{m.qty}</p>
                ))}
                {note(i)}
              </td>
              {!forKitchen && itemTax && <td className={clsx(cell, 'text-center tabular-nums')}>{money(i.tax_amount)}</td>}
              {!forKitchen && <td className={clsx(cell, 'text-center tabular-nums')}>{money(i.sub_total)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  // l2 (with modifier prices) and l3 (compact)
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th className={cell}>{t('No')}</th>
          <th className={clsx(cell, 'text-start')}>{layout === 'l2' ? t('Item / Modifiers') : t('Item')}</th>
          <th className={cell}>{t('Qty')}</th>
          {!forKitchen && <th className={cell}>{t('Price')}</th>}
          {!forKitchen && itemTax && <th className={cell}>{t('Tax')}</th>}
          {!forKitchen && <th className={cell}>{t('Subtotal')}</th>}
        </tr>
      </thead>
      <tbody>
        {items.map((i, idx) => (
          <tr key={i.cart_uuid ?? idx} className={clsx(cancelled && 'line-through')}>
            <td className={clsx(cell, 'text-center')}>{idx + 1}</td>
            <td className={cell}>
              <p>{done(i)}{i.name}</p>
              {layout === 'l2' &&
                sortedModifiers(i).map((m) => (
                  <p key={m.id} className="flex justify-between gap-1 text-[0.9em]">
                    <span>+ {m.title} x{m.qty}</span>
                    {!forKitchen && <span>{money(Number(m.price) * Number(m.qty))}</span>}
                  </p>
                ))}
              {note(i)}
            </td>
            <td className={clsx(cell, 'text-center')}>{i.qty}</td>
            {!forKitchen && <td className={clsx(cell, 'text-center tabular-nums')}>{money(i.price)}</td>}
            {!forKitchen && itemTax && <td className={clsx(cell, 'text-center tabular-nums')}>{money(i.tax_amount)}</td>}
            {!forKitchen && <td className={clsx(cell, 'text-center tabular-nums')}>{money(i.sub_total)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
