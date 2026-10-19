import clsx from 'clsx';
import {
  BedDouble,
  ChevronRight,
  CreditCard,
  MapPin,
  MessageSquareText,
  Pencil,
  Percent,
  Plus,
  Printer,
  Receipt,
  Scissors,
  ShoppingBag,
  Store,
  Trash2,
  User,
  Utensils,
  XCircle,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { CartItem, OrderTotals } from '@/lib/cart';
import { truthy } from '@/lib/cart';
import { Badge, Button, EmptyState } from '@/components/ui';
import { useAuth, useConfig, useT } from '@/providers/AppProviders';
import type { Draft } from './draft';
import { Stepper } from './ItemModals';

export type CartActions = {
  setOrderType: (key: string) => void;
  openDestination: () => void;
  openCustomer: () => void;
  setQty: (cartUuid: string, qty: number) => void;
  remove: (cartUuid: string) => void;
  edit: (item: CartItem, tab: 'details' | 'modifiers') => void;
  openDiscount: () => void;
  openTax: () => void;
  openNotes: () => void;
  clear: () => void;
  submit: () => void;
  checkout: () => void;
  split: () => void;
  cancel: () => void;
  print: () => void;
};

const typeIcon: Record<string, ReactNode> = {
  dining: <Utensils className="h-4 w-4" />,
  pickup: <ShoppingBag className="h-4 w-4" />,
  dilivery: <MapPin className="h-4 w-4" />,
  roomservice: <BedDouble className="h-4 w-4" />,
};

export function sortedModifiers(item: CartItem) {
  return (item.modifiers ?? []).filter((m) => m.is_checked).sort((a, b) => (a.selected_at || 0) - (b.selected_at || 0));
}

export function CartPanel({
  draft,
  totals,
  actions,
  submitting,
  tableRequired,
}: {
  draft: Draft;
  totals: OrderTotals;
  actions: CartActions;
  submitting: boolean;
  tableRequired: boolean;
}) {
  const t = useT();
  const { config, money } = useConfig();
  const { can } = useAuth();
  const modes = config.modes;
  const editing = !!draft.uuid;
  const items = draft.items;

  const dest = (() => {
    switch (draft.order_type) {
      case 'dining':
        return { label: t('Service table'), value: draft.table?.title, required: tableRequired, icon: <Utensils className="h-4 w-4" /> };
      case 'pickup':
        return { label: t('Pickup point'), value: draft.pickup_point?.place_title, required: false, icon: <Store className="h-4 w-4" /> };
      case 'dilivery':
        return { label: t('Shipping address'), value: draft.shipping_address, required: false, icon: <MapPin className="h-4 w-4" /> };
      case 'roomservice':
        return {
          label: t('Room'),
          value: draft.reservation ? `${draft.reservation.guest_room?.room_name ?? ''} #${draft.reservation.tracking}`.trim() : null,
          required: true,
          icon: <BedDouble className="h-4 w-4" />,
        };
      default:
        return null;
    }
  })();

  const tax = draft.tax as any;
  const taxLabel = draft.is_item_based_taxation
    ? t('Tax')
    : `${tax?.tax_title ?? t('Tax')}${truthy(tax?.is_tax_fix) ? '' : ` (${Number(tax?.tax_rate ?? tax?.rate ?? 0)}%)`}`;
  const taxIncluded = !draft.is_item_based_taxation && truthy(tax?.is_tax_included);

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-slate-900">
      {/* Order meta */}
      <div className="space-y-2 border-b border-slate-200 p-3 dark:border-slate-800">
        {editing && (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
            <span className="flex items-center gap-2 font-medium">
              <Pencil className="h-4 w-4" />
              {t('Editing order')} #{draft.tracking}
            </span>
            <button type="button" className="btn-ghost btn-sm text-amber-900! dark:text-amber-200!" onClick={actions.clear}>
              <Plus className="h-4 w-4" /> {t('New order')}
            </button>
          </div>
        )}
        <div role="radiogroup" aria-label={t('Order Type')} className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
          {config.order_types.map((o) => (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={draft.order_type === o.key}
              onClick={() => actions.setOrderType(o.key)}
              className={clsx(
                'flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-md px-1.5 text-xs font-medium transition sm:px-2 sm:text-sm [&>svg]:hidden min-[400px]:[&>svg]:block [&>svg]:shrink-0',
                draft.order_type === o.key ? 'bg-white text-brand-700 shadow-xs dark:bg-slate-900 dark:text-brand-300' : 'text-slate-600 dark:text-slate-400',
              )}
            >
              {typeIcon[o.key]}
              <span className="truncate">{o.title}</span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2 lg:grid-cols-2">
          {dest && (
            <MetaButton
              icon={dest.icon}
              label={dest.label}
              value={dest.value || (dest.required ? t('Required') : t('Optional'))}
              missing={!dest.value && dest.required}
              onClick={actions.openDestination}
            />
          )}
          <MetaButton
            icon={<User className="h-4 w-4" />}
            label={t('Customer')}
            value={draft.customer?.name || t('Select customer')}
            missing={!draft.customer}
            onClick={actions.openCustomer}
            className={dest ? '' : 'min-[400px]:col-span-2'}
          />
        </div>
      </div>

      {/* Lines */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!items.length ? (
          <EmptyState
            icon={<ShoppingBag className="h-6 w-6" />}
            title={t('Cart is empty')}
            description={t('Tap a product to add it to the order')}
          />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {items.map((item) => (
              <CartLine key={item.cart_uuid} item={item} actions={actions} money={money} itemTax={draft.is_item_based_taxation && modes.taxation} />
            ))}
          </ul>
        )}
      </div>

      {/* Totals & actions */}
      <div className="space-y-3 border-t border-slate-200 p-3 dark:border-slate-800">
        <div className="flex gap-2">
          <AdjustButton icon={<Percent className="h-4 w-4" />} active={Number(draft.discount_rate) > 0} onClick={actions.openDiscount}>
            {Number(draft.discount_rate) > 0
              ? draft.is_discount_in_percentage
                ? `${Number(draft.discount_rate)}%`
                : money(draft.discount_rate)
              : t('Discount')}
          </AdjustButton>
          {modes.taxation && !draft.is_item_based_taxation && (
            <AdjustButton icon={<Receipt className="h-4 w-4" />} active onClick={actions.openTax}>
              <span className="truncate">{tax?.tax_title ?? t('Tax')}</span>
            </AdjustButton>
          )}
          <AdjustButton icon={<MessageSquareText className="h-4 w-4" />} active={!!(draft.note_for_chef || draft.staff_note)} onClick={actions.openNotes}>
            {t('Notes')}
          </AdjustButton>
        </div>

        <dl className="space-y-1 text-sm">
          <Row label={`${t('Subtotal')} (${totals.cartTotalItems} ${t('items')})`} value={money(totals.cartTotalPrice)} />
          {totals.discountAmount > 0 && <Row label={t('Discount')} value={`- ${money(totals.discountAmount)}`} />}
          {(totals.taxAmount > 0 || modes.taxation) && (
            <Row label={`${taxLabel}${taxIncluded ? ` · ${t('Included')}` : ''}`} value={`${taxIncluded ? '' : '+ '}${money(totals.taxAmount)}`} />
          )}
          <div className="flex items-baseline justify-between pt-1 text-xl font-bold">
            <dt>{t('Total')}</dt>
            <dd className="tabular-nums">{money(totals.totalAmount)}</dd>
          </div>
        </dl>

        {editing && (
          <div className="grid grid-cols-3 gap-2">
            <Button className="h-11" icon={<Scissors className="h-4 w-4" />} onClick={actions.split} disabled={items.length < 2}>
              {t('Split')}
            </Button>
            <Button className="h-11" icon={<Printer className="h-4 w-4" />} onClick={actions.print}>
              {t('Print')}
            </Button>
            <Button className="h-11 text-red-600!" icon={<XCircle className="h-4 w-4" />} onClick={actions.cancel}>
              {t('Cancel')}
            </Button>
          </div>
        )}
        <div className="flex gap-2">
          <Button className="h-14 w-14 shrink-0 p-0!" onClick={actions.clear} aria-label={t('Clear cart')} title={t('Clear cart')} disabled={!items.length && !editing}>
            <Trash2 className="h-5 w-5" />
          </Button>
          <Button variant="primary" className="h-14 flex-1 text-base" onClick={actions.submit} loading={submitting} disabled={!items.length}>
            {editing ? t('Update order') : t('Submit order')}
          </Button>
          {editing && can('order_checkout') && (
            <Button variant="success" className="h-14 flex-1 text-base" icon={<CreditCard className="h-5 w-5" />} onClick={actions.checkout} disabled={!items.length || submitting}>
              {t('Pay')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function MetaButton({ icon, label, value, missing, onClick, className }: { icon: ReactNode; label: string; value: ReactNode; missing?: boolean; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'flex min-h-[48px] items-center gap-2 rounded-lg border px-2.5 py-1.5 text-start transition hover:border-brand-400',
        missing ? 'border-dashed border-amber-400 bg-amber-50/50 dark:border-amber-700 dark:bg-amber-950/30' : 'border-slate-200 dark:border-slate-700',
        className,
      )}
    >
      <span className="text-slate-400">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] uppercase tracking-wide text-slate-500">{label}</span>
        <span className="block truncate text-sm font-medium">{value}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 rtl:rotate-180" />
    </button>
  );
}

function AdjustButton({ icon, active, onClick, children }: { icon: ReactNode; active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 text-sm font-medium',
        active ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-800 dark:bg-brand-950 dark:text-brand-300' : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function Row({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-2 text-slate-600 dark:text-slate-300">
      <dt className="truncate">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function CartLine({ item, actions, money, itemTax }: { item: CartItem; actions: CartActions; money: (v: unknown) => string; itemTax: boolean }) {
  const t = useT();
  const mods = sortedModifiers(item);
  const hasModifiers = (item.modifiers?.length ?? 0) > 0;
  return (
    <li className="px-3 py-2.5">
      <div className="flex items-start gap-2">
        <button type="button" className="tap min-w-0 flex-1 text-start" onClick={() => actions.edit(item, 'details')}>
          <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium leading-snug">
            {item.name}
            {item.is_ready && <Badge tone="green">{t('Ready')}</Badge>}
            {item.not_display && <Badge tone="gray">{t('Not sent to kitchen')}</Badge>}
          </p>
          <p className="text-xs tabular-nums text-slate-500">
            {money(item.price)} × {item.qty}
          </p>
          {mods.length > 0 && (
            <ul className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
              {mods.map((m) => (
                <li key={m.id}>
                  + {m.title} × {m.qty} <span className="tabular-nums text-slate-400">({money(Number(m.price) * Number(m.qty))})</span>
                </li>
              ))}
            </ul>
          )}
          {item.note && <p className="mt-0.5 line-clamp-2 text-xs italic text-amber-700 dark:text-amber-400">“{item.note}”</p>}
          {itemTax && Number(item.tax_amount) > 0 && (
            <p className="text-xs tabular-nums text-slate-500">
              {t('Tax')}: {item.tax_setup?.tax_title ? `${item.tax_setup.tax_title} ` : ''}
              {money(item.tax_amount)}
              {truthy(item.tax_setup?.is_tax_included) ? ` (${t('Included')})` : ''}
            </p>
          )}
        </button>
        <p className="text-sm font-semibold tabular-nums">{money(item.sub_total)}</p>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Stepper size="sm" value={Number(item.qty)} min={0} onChange={(q) => actions.setQty(item.cart_uuid, q)} label={`${item.name} ${t('Quantity')}`} />
        {hasModifiers && (
          <button type="button" className="btn-secondary btn-sm h-9" onClick={() => actions.edit(item, 'modifiers')}>
            <Plus className="h-3.5 w-3.5" /> {t('Modifiers')}
            {mods.length > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-[10px] text-white">{mods.length}</span>}
          </button>
        )}
        <button type="button" className="btn-ghost ms-auto h-10 w-10 p-0!" onClick={() => actions.edit(item, 'details')} aria-label={`${t('Edit')} ${item.name}`}>
          <Pencil className="h-4 w-4" />
        </button>
        <button type="button" className="btn-ghost h-10 w-10 p-0! text-red-600" onClick={() => actions.remove(item.cart_uuid)} aria-label={`${t('Remove')} ${item.name}`}>
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}
