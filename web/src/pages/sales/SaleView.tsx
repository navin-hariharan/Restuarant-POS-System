import clsx from 'clsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  ChefHat,
  CircleDollarSign,
  ClipboardList,
  Flame,
  MapPin,
  Pencil,
  Printer,
  Receipt,
  Trash2,
  User as UserIcon,
  XCircle,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { taxRate, truthy, type CartItem, type TaxSetup } from '@/lib/cart';
import { Badge, Button, Card, EmptyState, Skeleton, useConfirm } from '@/components/ui';
import { avatarUrl, Avatar } from '@/layout/AppShell';
import { useAuth, useConfig, useI18n, useT } from '@/providers/AppProviders';
import { CancelSaleModal } from '@/components/sales/CancelSaleModal';
import {
  canEditInPos,
  checkedModifiers,
  formatDateTime,
  itemsOf,
  OrderTypeChip,
  ProgressBar,
  saleStatus,
  StatusBadge,
  type CustomerRef,
  type StaffRef,
  type TableRef,
} from '@/components/sales/saleUtils';

/** GET admin/sales/{uuid} (SaleDetailResource). Optional fields are shown when the API sends them. */
type SaleDetail = {
  id: number;
  uuid: string;
  tracking: string | number;
  items: CartItem[] | string;
  cart_total_price: number | string;
  cart_total_cost: number | string;
  payable_after_all: number | string;
  discount_rate: number | string;
  is_discount_in_percentage: boolean;
  discount_amount: number | string;
  staff_note: string | null;
  payment_note: string | null;
  tax: TaxSetup | null;
  profit_after_all: number | string;
  tax_amount: number | string;
  chef: StaffRef;
  biller: StaffRef;
  taker: StaffRef;
  customer: CustomerRef;
  table: TableRef;
  took_at: string | null;
  is_preparing: boolean;
  progress: number | null;
  is_cancelled: boolean;
  cancellation_reason: string | null;
  completed_at: string | null;
  tip_amount: number | string | null;
  created_at: string;
  updated_at: string;
  order_type?: string;
  prepared_at?: string | null;
  note_for_chef?: string | null;
  payment_method?: { id: number; name: string } | null;
  is_item_based_taxation?: boolean;
  [key: string]: any;
};

/** GET pos/sale/{uuid} (SaleOrderPrintResource) — fills in order type target details. */
type SalePrint = {
  order_type?: string;
  pickup_point?: { place_title?: string; person_name?: string; phone?: string; address?: string } | null;
  shipping_address?: string | null;
  is_item_based_taxation?: boolean;
};

export default function SaleView() {
  const { uuid = '' } = useParams();
  const t = useT();
  const { locale } = useI18n();
  const { config, money } = useConfig();
  const { can } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [cancelOpen, setCancelOpen] = useState(false);

  const q = useQuery({
    queryKey: ['admin/sales', uuid],
    queryFn: async () => (await api.get<SaleDetail>(`admin/sales/${uuid}`)).data,
  });
  const extra = useQuery({
    queryKey: ['pos/sale', uuid],
    queryFn: async () => (await api.get<SalePrint>(`pos/sale/${uuid}`, { silent: true })).data,
    retry: 0,
  });

  if (q.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-96 lg:col-span-2" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }
  const sale = q.data;
  if (!sale) {
    return (
      <EmptyState
        title={t('Order not found')}
        action={
          <Link to="/admin/sales" className="btn-secondary btn-sm">
            {t('Back')}
          </Link>
        }
      />
    );
  }

  const info = extra.data ?? {};
  const items = itemsOf(sale.items);
  const status = saleStatus(sale);
  const itemBased = sale.is_item_based_taxation ?? info.is_item_based_taxation ?? items.some((i) => i.sub_total_before_tax !== undefined);
  const orderTypeKey = sale.order_type ?? keyFromTitle(config.order_types, info.order_type);
  const allowEditChecked = !!config.modes.allow_to_edit_checked_orders;
  const editable = can('pos_portal') && canEditInPos(sale, allowEditChecked);
  const cancellable = can('pos_portal', 'manage_sales') && !sale.is_cancelled && (!sale.completed_at || allowEditChecked);
  const removable = can('remove_sales');
  const tip = Number(sale.tip_amount ?? 0);
  const discount = Number(sale.discount_amount ?? 0);
  const tax = sale.tax;
  const subtotal = items.reduce((s, i) => s + Number(i.sub_total || 0), 0);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin/sales'] });
    qc.invalidateQueries({ queryKey: ['pos/sale', uuid] });
  };

  const remove = async () => {
    if (!(await confirm({ danger: true, title: t('Delete order'), message: `${t('Order #')}${sale.tracking} — ${t("You won't be able to revert this!")}` }))) return;
    const res = await api.delete(`admin/sales/${sale.uuid}`);
    toast.success(res.data?.message ?? t('Data removed successfully'));
    qc.invalidateQueries({ queryKey: ['admin/sales'] });
    nav('/admin/sales');
  };

  const timeline: { label: string; at?: string | null; done: boolean; icon: ReactNode; tone: string; who?: StaffRef; note?: ReactNode }[] = [
    { label: 'Order taken', at: sale.took_at, done: true, icon: <ClipboardList className="h-4 w-4" />, tone: 'bg-brand-600', who: sale.taker },
    {
      label: 'Cooking started',
      done: !!sale.is_preparing || Number(sale.progress) > 0,
      icon: <Flame className="h-4 w-4" />,
      tone: 'bg-amber-500',
      who: sale.chef,
    },
    {
      label: 'Prepared',
      at: sale.prepared_at,
      done: Number(sale.progress) >= 100 || !!sale.prepared_at,
      icon: <ChefHat className="h-4 w-4" />,
      tone: 'bg-violet-500',
      who: Number(sale.progress) >= 100 ? sale.chef : null,
    },
    { label: 'Completed', at: sale.completed_at, done: !!sale.completed_at, icon: <CheckCircle2 className="h-4 w-4" />, tone: 'bg-emerald-600', who: sale.biller },
  ];
  if (sale.is_cancelled) {
    timeline.push({
      label: 'Cancelled',
      done: true,
      icon: <XCircle className="h-4 w-4" />,
      tone: 'bg-red-600',
      note: sale.cancellation_reason,
    });
  }

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Link to="/admin/sales" className="tap mb-1 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" /> {t('Sale orders')}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">
              {t('Order #')}
              {sale.tracking}
            </h1>
            <StatusBadge status={status} />
            {orderTypeKey && <OrderTypeChip type={orderTypeKey} />}
          </div>
          <p className="mt-1 text-sm text-slate-500">{formatDateTime(sale.took_at, locale) || sale.created_at}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/print/sale/${sale.uuid}`} className="btn-secondary">
            <Printer className="h-4 w-4" /> {t('Print')}
          </Link>
          {editable && (
            <Link to={`/admin/pos/${sale.uuid}`} className="btn-secondary">
              <Pencil className="h-4 w-4" /> {t('Edit in POS')}
            </Link>
          )}
          {cancellable && (
            <Button icon={<Ban className="h-4 w-4" />} onClick={() => setCancelOpen(true)} className="text-red-600!">
              {t('Cancel order')}
            </Button>
          )}
          {removable && (
            <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={remove}>
              {t('Delete')}
            </Button>
          )}
        </div>
      </div>

      {sale.is_cancelled && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
          <XCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-medium">{t('This order was cancelled')}</p>
            {sale.cancellation_reason && <p className="mt-0.5 text-sm">{sale.cancellation_reason}</p>}
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card
            title={
              <span className="flex items-center gap-2">
                <Receipt className="h-4 w-4 text-slate-400" /> {t('Items')}
                <Badge>{items.reduce((s, i) => s + Number(i.qty || 0), 0)}</Badge>
              </span>
            }
            bodyClassName="p-0"
          >
            {items.length ? (
              <div className="relative overflow-x-auto">
                <table className="table-base">
                  <thead className="bg-slate-50 dark:bg-slate-900/60">
                    <tr>
                      <th>{t('Item')}</th>
                      <th className="text-end">{t('Qty')}</th>
                      <th className="text-end">{t('Price')}</th>
                      {itemBased && <th className="text-end">{t('Tax')}</th>}
                      <th className="text-end">{t('Total')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {items.map((item, idx) => {
                      const mods = checkedModifiers(item.modifiers);
                      return (
                        <tr key={item.cart_uuid ?? idx} className="align-top">
                          <td className="align-top!">
                            <div className="flex items-start gap-3">
                              {item.image && <img src={item.image} alt="" className="hidden h-10 w-10 shrink-0 rounded-lg object-cover sm:block" />}
                              <div className="min-w-0">
                                <p className="font-medium">{item.name}</p>
                                <div className="mt-0.5 flex flex-wrap gap-1">
                                  {item.is_ready ? (
                                    <Badge tone="green">{t('Ready')}</Badge>
                                  ) : (
                                    !sale.is_cancelled && !sale.completed_at && <Badge tone="amber">{t('In kitchen')}</Badge>
                                  )}
                                  {item.is_bar_type && <Badge tone="blue">{t('Bar')}</Badge>}
                                  {item.not_display && <Badge>{t('Hidden from kitchen')}</Badge>}
                                </div>
                                {mods.length > 0 && (
                                  <ul className="mt-1 space-y-0.5 text-xs text-slate-600 dark:text-slate-400">
                                    {mods.map((m) => (
                                      <li key={m.id} className="flex justify-between gap-4">
                                        <span>
                                          + {m.qty} × {m.title}
                                        </span>
                                        <span className="tabular-nums">{money(Number(m.price) * Number(m.qty))}</span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                                {item.note && (
                                  <p className="mt-1 rounded-sm bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
                                    {item.note}
                                  </p>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="text-end tabular-nums">{item.qty}</td>
                          <td className="whitespace-nowrap text-end tabular-nums">{money(item.price)}</td>
                          {itemBased && (
                            <td className="whitespace-nowrap text-end text-xs tabular-nums text-slate-500">
                              {money(item.tax_amount)}
                              {item.tax_setup?.tax_title && <span className="block">{item.tax_setup.tax_title}</span>}
                            </td>
                          )}
                          <td className="whitespace-nowrap text-end font-medium tabular-nums">{money(item.sub_total)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title={t('No items')} />
            )}
            <dl className="space-y-1.5 border-t border-slate-200 px-4 py-4 text-sm dark:border-slate-800 sm:ms-auto sm:max-w-sm">
              <Row label={t('Subtotal')} value={money(subtotal)} />
              <Row label={t('Net amount')} value={money(sale.cart_total_price)} muted />
              {discount > 0 && (
                <Row
                  label={`${t('Discount')}${sale.is_discount_in_percentage ? ` (${Number(sale.discount_rate)}%)` : ''}`}
                  value={`− ${money(discount)}`}
                />
              )}
              <Row
                label={
                  itemBased
                    ? t('Tax (item based)')
                    : `${t('Tax')}${tax?.tax_title ? ` · ${tax.tax_title}` : ''}${tax && !truthy(tax.is_tax_fix) && taxRate(tax) ? ` ${taxRate(tax)}%` : ''}${
                        tax && truthy(tax.is_tax_included) ? ` (${t('included')})` : ''
                      }`
                }
                value={money(sale.tax_amount)}
              />
              <Row label={t('Total')} value={money(sale.payable_after_all)} strong />
              {tip > 0 && (
                <>
                  <Row label={t('Tip')} value={money(tip)} />
                  <Row label={t('Total with tip')} value={money(Number(sale.payable_after_all) + tip)} strong />
                </>
              )}
            </dl>
          </Card>

          <Card title={<span className="flex items-center gap-2"><CircleDollarSign className="h-4 w-4 text-slate-400" /> {t('Payment')}</span>}>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
              <Info label={t('Status')} value={sale.completed_at ? t('Paid') : sale.is_cancelled ? t('Cancelled') : t('Unpaid')} />
              <Info label={t('Payment method')} value={sale.payment_method?.name} />
              <Info label={t('Biller')} value={sale.biller?.name} />
              <Info label={t('Cost')} value={money(sale.cart_total_cost)} />
              <Info label={t('Profit')} value={money(sale.profit_after_all)} />
              <Info label={t('Completed at')} value={sale.completed_at ? formatDateTime(sale.completed_at, locale) : undefined} />
              {sale.payment_note && <Info className="sm:col-span-3" label={t('Payment note')} value={sale.payment_note} />}
            </dl>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title={<span className="flex items-center gap-2"><MapPin className="h-4 w-4 text-slate-400" /> {t('Order')}</span>}>
            <dl className="space-y-3 text-sm">
              {orderTypeKey && <Info label={t('Order type')} value={<OrderTypeChip type={orderTypeKey} />} />}
              {sale.table?.title && <Info label={t('Service table')} value={sale.table.title} />}
              {info.pickup_point?.place_title && (
                <Info
                  label={t('Pickup point')}
                  value={
                    <>
                      {info.pickup_point.place_title}
                      {(info.pickup_point.person_name || info.pickup_point.phone) && (
                        <span className="block text-xs text-slate-500">{[info.pickup_point.person_name, info.pickup_point.phone].filter(Boolean).join(' · ')}</span>
                      )}
                    </>
                  }
                />
              )}
              {info.shipping_address && <Info label={t('Shipping address')} value={<span className="whitespace-pre-line">{info.shipping_address}</span>} />}
              {sale.note_for_chef && <Info label={t('Note for chef')} value={sale.note_for_chef} />}
              {sale.staff_note && <Info label={t('Staff note')} value={sale.staff_note} />}
            </dl>
          </Card>

          <Card title={<span className="flex items-center gap-2"><UserIcon className="h-4 w-4 text-slate-400" /> {t('Customer')}</span>}>
            {sale.customer ? (
              <div className="space-y-1 text-sm">
                <p className="font-medium">{sale.customer.name}</p>
                {sale.customer.phone && <p className="text-slate-600 dark:text-slate-400">{sale.customer.phone}</p>}
                {sale.customer.email && <p className="truncate text-slate-600 dark:text-slate-400">{sale.customer.email}</p>}
                {sale.customer.address && <p className="text-slate-500">{sale.customer.address}</p>}
              </div>
            ) : (
              <p className="text-sm text-slate-500">—</p>
            )}
          </Card>

          <Card title={t('Timeline')}>
            {!sale.is_cancelled && !sale.completed_at && (
              <div className="mb-4">
                <div className="mb-1 flex justify-between text-xs text-slate-500">
                  <span>{t('Kitchen progress')}</span>
                  <span className="tabular-nums">{Math.round(Number(sale.progress ?? 0))}%</span>
                </div>
                <ProgressBar value={Number(sale.progress ?? 0)} />
              </div>
            )}
            <ol className="relative space-y-4 border-s border-slate-200 ps-5 dark:border-slate-800">
              {timeline.map((s) => (
                <li key={s.label} className="relative">
                  <span
                    className={clsx(
                      'absolute inset-s-[-31px] flex h-6 w-6 items-center justify-center rounded-full text-white ring-4 ring-white dark:ring-slate-900',
                      s.done ? s.tone : 'bg-slate-300 dark:bg-slate-700',
                    )}
                  >
                    {s.icon}
                  </span>
                  <p className={clsx('text-sm font-medium', !s.done && 'text-slate-400')}>{t(s.label)}</p>
                  {s.at && s.done && <p className="text-xs text-slate-500">{formatDateTime(s.at, locale)}</p>}
                  {s.who && s.done && (
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                      <Avatar name={s.who.name} src={avatarUrl(s.who)} size="h-5 w-5" />
                      {s.who.name}
                    </p>
                  )}
                  {s.note && <p className="mt-1 text-xs text-red-700 dark:text-red-300">{s.note}</p>}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      <CancelSaleModal sale={cancelOpen ? sale : null} onClose={() => setCancelOpen(false)} onDone={refresh} />
    </div>
  );
}

function keyFromTitle(types: { title: string; key: string }[] | undefined, title?: string): string | undefined {
  if (!title) return undefined;
  return types?.find((o) => o.title === title || o.key === title)?.key ?? ({ 'Room Service': 'roomservice', Delivery: 'dilivery' } as Record<string, string>)[title] ?? title.toLowerCase();
}

function Row({ label, value, strong, muted }: { label: ReactNode; value: ReactNode; strong?: boolean; muted?: boolean }) {
  return (
    <div className={clsx('flex justify-between gap-4', strong && 'border-t border-slate-200 pt-1.5 text-base font-semibold dark:border-slate-800', muted && 'text-slate-500')}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function Info({ label, value, className }: { label: ReactNode; value?: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="mt-0.5">{value || <span className="text-slate-400">—</span>}</dd>
    </div>
  );
}
