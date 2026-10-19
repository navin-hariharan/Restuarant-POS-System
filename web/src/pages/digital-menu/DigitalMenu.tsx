import clsx from 'clsx';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronRight, ImageOff, LayoutGrid, Plus, ShoppingBag, Trash2, Utensils } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api, fieldErrors, type Paginated } from '@/lib/api';
import { money as round2, orderTotals, recalcItem, type CartItem, type PosProduct, type TaxSetup } from '@/lib/cart';
import { storage } from '@/lib/format';
import { BrandIcon, fallbackTo } from '@/components/ui/BrandIcon';
import { Drawer, FullScreenLoader, Input, SearchInput, Skeleton, Spinner, Textarea, useDebounced } from '@/components/ui';
import { ThemeToggle } from '@/layout/AppShell';
import { useConfig, useT } from '@/providers/AppProviders';
import { checkedModifiers } from '@/components/sales/saleUtils';
import { buildLine, hasText, ProductSheet, QtyStepper } from './ProductSheet';

type Category = { id: number; name: string; image?: string };
type Table = { id: number; title: string; is_booked?: boolean };
type Customer = { name: string; phone: string; email: string };
type Placed = { tracking: string | number; at: number; total: number; items: number };

const PER_PAGE = 18;

/** API tax resources can come back as `null` or `[]`; treat those as "no own tax". */
function normalizeTax(tax: unknown): TaxSetup | null {
  if (!tax || Array.isArray(tax) || typeof tax !== 'object') return null;
  const t = tax as TaxSetup;
  return t.tax_rate === undefined && t.rate === undefined ? null : t;
}
function normalizeProduct(p: PosProduct): PosProduct {
  return {
    ...p,
    tax_setup: normalizeTax(p.tax_setup),
    variants: (p.variants ?? []).map((v) => ({ ...v, tax_setup: normalizeTax(v.tax_setup) })),
  };
}

const sameModifiers = (a: CartItem, b: CartItem) =>
  JSON.stringify(checkedModifiers(a.modifiers).map((m) => [m.id, Number(m.qty)])) ===
  JSON.stringify(checkedModifiers(b.modifiers).map((m) => [m.id, Number(m.qty)]));

export default function DigitalMenu() {
  const t = useT();
  const { config, money } = useConfig();
  const [params] = useSearchParams();
  const tableId = params.get('t') ?? '';
  const itemBasedTax = !!config.modes.item_based_tax;
  const isReady = !!config.modes.bypass_kitchen_bar;
  const orderTax = normalizeTax(config.tax_setup);
  const cartKey = `dm_cart_${tableId}`;

  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 350);
  const [category, setCategory] = useState<number | null>(null);
  const [cart, setCart] = useState<CartItem[]>(() => storage.get<CartItem[]>(cartKey, []));
  const [sheet, setSheet] = useState<PosProduct | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [customer, setCustomer] = useState<Customer>(() => storage.get<Customer>('dm_customer', { name: '', phone: '', email: '' }));
  const [chefNote, setChefNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [placing, setPlacing] = useState(false);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const [lastOrder, setLastOrder] = useState<Placed | null>(() => storage.get<Placed | null>(`dm_last_order_${tableId}`, null));

  const enabled = !!config.modes.digital_menu && !!tableId;

  useEffect(() => storage.set(cartKey, cart), [cart, cartKey]);
  useEffect(() => {
    document.title = `${t('Digital Menu')} · ${config.name}`;
  }, [t, config.name]);

  const tables = useQuery({
    queryKey: ['digital-menu/tables'],
    queryFn: async () => (await api.get<Table[]>('digital-menu/tables', { silent: true })).data,
    enabled,
    staleTime: 60_000,
  });
  const categories = useQuery({
    queryKey: ['digital-menu/categories'],
    queryFn: async () => (await api.get<Category[]>('digital-menu/categories', { silent: true })).data,
    enabled,
    staleTime: 60_000,
  });
  const products = useInfiniteQuery({
    queryKey: ['digital-menu/products', debounced, category],
    queryFn: async ({ pageParam }) =>
      (
        await api.get<Paginated<PosProduct>>('digital-menu/products', {
          params: { page: pageParam, perPage: PER_PAGE, search: debounced || undefined, category: category ?? undefined, sort: { column: 'name', order: 'asc' } },
          silent: true,
        })
      ).data,
    initialPageParam: 1,
    getNextPageParam: (last) => (last.pagination.currentPage < last.pagination.totalPages ? last.pagination.currentPage + 1 : undefined),
    enabled,
  });
  const productList = useMemo(() => (products.data?.pages ?? []).flatMap((p) => p.items).map(normalizeProduct), [products.data]);

  const table = tables.data?.find((x) => String(x.id) === String(tableId));
  const totals = useMemo(
    () => orderTotals({ items: cart, isItemBasedTaxation: itemBasedTax, tax: orderTax, discountRate: 0, isDiscountInPercentage: false }),
    [cart, itemBasedTax, orderTax],
  );

  /* ------------------------------------------------------------ cart ops */

  const addLine = (line: CartItem) => {
    setCart((items) => {
      const idx = items.findIndex(
        (i) => i.uuid === line.uuid && i.id === line.id && !i.is_ready === !line.is_ready && (i.note ?? '') === (line.note ?? '') && sameModifiers(i, line),
      );
      if (idx >= 0) {
        const next = items.map((i) => ({ ...i }));
        next[idx].qty = Number(next[idx].qty) + Number(line.qty);
        recalcItem(next[idx], itemBasedTax);
        return next;
      }
      return [...items, line];
    });
    toast.success(t(':name added to your order', { name: line.name }), { duration: 1500 });
  };

  const quickAdd = (p: PosProduct) => {
    const needsSheet = (p.has_variants && (p.variants?.length ?? 0) > 0) || (p.modifiers?.length ?? 0) > 0;
    if (needsSheet) {
      setSheet(p);
      return;
    }
    addLine(buildLine(p, { qty: 1, modifiers: p.modifiers ?? [], note: '', itemBasedTax, isReady, defaultTax: orderTax }));
  };

  const setQty = (cartUuid: string, qty: number) =>
    setCart((items) =>
      qty <= 0
        ? items.filter((i) => i.cart_uuid !== cartUuid)
        : items.map((i) => (i.cart_uuid === cartUuid ? recalcItem({ ...i, qty }, itemBasedTax) : i)),
    );

  /* ----------------------------------------------------------- placement */

  const placeOrder = async () => {
    const errs: Record<string, string> = {};
    if (!customer.name.trim()) errs.name = t('Name is required');
    if (customer.email && !/^\S+@\S+\.\S+$/.test(customer.email)) errs.email = t('Enter a valid email address');
    setErrors(errs);
    if (Object.keys(errs).length || !cart.length) return;
    setPlacing(true);
    const payload = {
      order_type: 'dining',
      table_id: Number(tableId),
      name: customer.name.trim(),
      phone: customer.phone.trim() || null,
      email: customer.email.trim() || null,
      items: cart,
      tax: orderTax ?? config.tax_setup,
      tax_amount: round2(totals.taxAmount),
      cart_total_items: totals.cartTotalItems,
      cart_total_price: round2(totals.netAmount),
      cart_total_cost: round2(totals.cartTotalCost),
      payable_after_all: round2(totals.totalAmount),
      profit_after_all: round2(totals.profit),
      discount_amount: 0,
      discount_rate: 0,
      is_discount_in_percentage: false,
      progress: totals.progress,
      is_spliting: false,
      is_item_based_taxation: itemBasedTax,
      note_for_chef: chefNote.trim() || null,
      shipping_address: null,
      pickup_point_id: null,
      guest_room_reservation_id: null,
    };
    try {
      const res = await api.post<{ message: string; order: string | number }>('digital-menu/order-collect', payload);
      const info: Placed = { tracking: res.data.order, at: Date.now(), total: totals.totalAmount, items: totals.cartTotalItems };
      storage.set('dm_customer', customer);
      storage.set(`dm_last_order_${tableId}`, info);
      setLastOrder(info);
      setPlaced(info);
      setCart([]);
      setChefNote('');
      setCartOpen(false);
      window.scrollTo({ top: 0 });
    } catch (e) {
      setErrors(fieldErrors(e));
    } finally {
      setPlacing(false);
    }
  };

  /* -------------------------------------------------------------- guards */

  if (!config.modes.digital_menu) {
    return <Notice icon={<Utensils className="h-10 w-10" />} title={t('Digital menu is disabled')} text={t('Please ask a member of staff to take your order.')} />;
  }
  if (!tableId) {
    return <Notice icon={<AlertTriangle className="h-10 w-10" />} title={t('Invalid Url for digital menu')} text={t('Scan the QR code on your table again.')} />;
  }
  if (tables.isLoading) return <FullScreenLoader />;
  if (tables.isError) {
    return (
      <Notice
        icon={<AlertTriangle className="h-10 w-10" />}
        title={t('Unable to load the menu')}
        text={t('Check your connection and try again.')}
        action={
          <button className="btn-primary" onClick={() => tables.refetch()}>
            {t('Retry')}
          </button>
        }
      />
    );
  }
  if (!table) {
    return <Notice icon={<AlertTriangle className="h-10 w-10" />} title={t('No table was found')} text={t('Scan the QR code on your table again.')} />;
  }

  /* --------------------------------------------------------- confirmation */

  if (placed) {
    return (
      <Shell tableTitle={table.title} count={0}>
        <div className="flex flex-col items-center px-6 py-14 text-center">
          <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
            <CheckCircle2 className="h-11 w-11" />
          </div>
          <h1 className="text-2xl font-bold">{t('Thank you!')}</h1>
          <p className="mt-3 text-sm text-slate-500">{t('Order #')}</p>
          <p className="text-4xl font-bold tabular-nums tracking-tight text-brand-600 dark:text-brand-400">{placed.tracking}</p>
          <p className="mt-4 max-w-sm text-slate-600 dark:text-slate-300">
            {t('The order has been sent successfully.')} {t('You will served your ordered food once prepared.')}
          </p>
          <dl className="mt-6 grid w-full max-w-xs grid-cols-2 gap-3 text-sm">
            <div className="card p-3">
              <dt className="text-xs text-slate-500">{t('Service table')}</dt>
              <dd className="font-semibold">{table.title}</dd>
            </div>
            <div className="card p-3">
              <dt className="text-xs text-slate-500">{t('Total')}</dt>
              <dd className="font-semibold tabular-nums">{money(placed.total)}</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-slate-500">{t('Show this number to staff if you have any questions about your order.')}</p>
          <button className="btn-primary btn-lg mt-8 w-full max-w-xs" onClick={() => setPlaced(null)}>
            {t('Great, thanks!')}
          </button>
        </div>
      </Shell>
    );
  }

  /* ---------------------------------------------------------------- menu */

  const cats = categories.data ?? [];
  return (
    <Shell tableTitle={table.title} count={totals.cartTotalItems} onCart={() => setCartOpen(true)}>
      <div className="sticky top-[calc(60px+env(safe-area-inset-top))] z-20 space-y-3 bg-slate-50/95 px-4 pb-3 pt-3 backdrop-blur-sm dark:bg-slate-950/95">
        <SearchInput value={search} onChange={setSearch} placeholder={t('Search for products...')} />
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none" role="tablist" aria-label={t('Categories')}>
          <CategoryChip active={category === null} onClick={() => setCategory(null)} icon={<LayoutGrid className="h-4 w-4" />} label={t('All')} />
          {categories.isLoading
            ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-24 shrink-0 rounded-full" />)
            : cats.map((c) => (
                <CategoryChip
                  key={c.id}
                  active={category === c.id}
                  onClick={() => setCategory(c.id)}
                  label={c.name}
                  icon={c.image ? <img src={c.image} alt="" className="h-6 w-6 rounded-full object-cover" onError={fallbackTo('category')} /> : undefined}
                />
              ))}
        </div>
      </div>

      {lastOrder && Date.now() - lastOrder.at < 6 * 3600_000 && (
        <div className="mx-4 mb-3 flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {t('Your last order')}: <strong className="tabular-nums">#{lastOrder.tracking}</strong>
            <span className="text-xs opacity-75">{new Date(lastOrder.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </span>
          <button
            className="text-xs underline"
            onClick={() => {
              storage.remove(`dm_last_order_${tableId}`);
              setLastOrder(null);
            }}
          >
            {t('Hide')}
          </button>
        </div>
      )}

      <section className="px-4 pb-32" aria-label={t('Products')}>
        {products.isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-56 rounded-2xl" />
            ))}
          </div>
        ) : productList.length ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
              {productList.map((p) => (
                <ProductCard key={p.uuid} product={p} onOpen={() => setSheet(p)} onAdd={() => quickAdd(p)} inCart={cart.filter((i) => (i.food_item_id ?? i.id) === p.id).reduce((s, i) => s + Number(i.qty), 0)} />
              ))}
            </div>
            {products.hasNextPage && (
              <button className="btn-secondary mx-auto mt-5 flex h-11 w-full max-w-xs" onClick={() => products.fetchNextPage()} disabled={products.isFetchingNextPage}>
                {products.isFetchingNextPage ? <Spinner /> : null}
                {t('Load more')}
              </button>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-slate-500">
            <Utensils className="h-10 w-10 text-slate-300" />
            <p className="font-medium">{t('Attention! record not found')}</p>
            {(search || category) && (
              <button
                className="btn-ghost btn-sm"
                onClick={() => {
                  setSearch('');
                  setCategory(null);
                }}
              >
                {t('Show all products')}
              </button>
            )}
          </div>
        )}
      </section>

      {/* Floating cart bar */}
      {cart.length > 0 && !cartOpen && (
        <div className="fixed inset-x-0 bottom-0 z-30 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            className="mx-auto flex h-14 w-full max-w-2xl items-center justify-between gap-3 rounded-2xl bg-brand-600 px-5 text-white shadow-xl hover:bg-brand-700"
            onClick={() => setCartOpen(true)}
          >
            <span className="flex items-center gap-3">
              <span className="flex h-8 min-w-8 items-center justify-center rounded-full bg-white/20 px-2 text-sm font-bold tabular-nums">{totals.cartTotalItems}</span>
              <span className="font-semibold">{t('View order')}</span>
            </span>
            <span className="flex items-center gap-1 font-semibold tabular-nums">
              {money(totals.totalAmount)}
              <ChevronRight className="h-5 w-5 rtl:rotate-180" />
            </span>
          </button>
        </div>
      )}

      <ProductSheet
        product={sheet}
        onClose={() => setSheet(null)}
        onAdd={(line) => {
          addLine(line);
          setSheet(null);
        }}
        itemBasedTax={itemBasedTax}
        isReady={isReady}
        defaultTax={orderTax}
      />

      {/* Cart */}
      <Drawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        title={
          <span className="flex items-center gap-2">
            <ShoppingBag className="h-5 w-5" /> {t('Your order')} · {table.title}
          </span>
        }
        width="max-w-lg"
        footer={
          cart.length ? (
            <div className="w-full space-y-3">
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between text-slate-600 dark:text-slate-300">
                  <dt>{t('Subtotal')}</dt>
                  <dd className="tabular-nums">{money(itemBasedTax ? totals.netAmount : totals.cartTotalPrice)}</dd>
                </div>
                {totals.taxAmount > 0 && (
                  <div className="flex justify-between text-slate-600 dark:text-slate-300">
                    <dt>
                      {t('Tax')}
                      {!itemBasedTax && orderTax?.tax_title ? ` · ${orderTax.tax_title}` : ''}
                    </dt>
                    <dd className="tabular-nums">{money(totals.taxAmount)}</dd>
                  </div>
                )}
                <div className="flex justify-between text-base font-bold">
                  <dt>{t('Total')}</dt>
                  <dd className="tabular-nums">{money(totals.totalAmount)}</dd>
                </div>
              </dl>
              <button className="btn-primary h-12 w-full text-base" onClick={placeOrder} disabled={placing}>
                {placing && <Spinner />}
                {t('Place order')} · {money(totals.totalAmount)}
              </button>
            </div>
          ) : undefined
        }
      >
        {cart.length ? (
          <div className="space-y-6">
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {cart.map((item) => {
                const mods = checkedModifiers(item.modifiers);
                return (
                  <li key={item.cart_uuid} className="flex gap-3 py-3">
                    {item.image ? (
                      <img src={item.image} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" onError={fallbackTo('product')} />
                    ) : (
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-300 dark:bg-slate-800">
                        <ImageOff className="h-5 w-5" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between gap-2">
                        <p className="font-medium leading-snug">{item.name}</p>
                        <p className="shrink-0 font-semibold tabular-nums">{money(item.sub_total)}</p>
                      </div>
                      {mods.length > 0 && (
                        <p className="mt-0.5 text-xs text-slate-500">{mods.map((m) => `+ ${Number(m.qty) > 1 ? `${m.qty}× ` : ''}${m.title}`).join(', ')}</p>
                      )}
                      {item.note && <p className="mt-0.5 text-xs italic text-amber-700 dark:text-amber-400">“{item.note}”</p>}
                      <div className="mt-2 flex items-center justify-between">
                        <QtyStepper size="sm" min={0} value={Number(item.qty)} onChange={(n) => setQty(item.cart_uuid, n)} label={item.name} />
                        <button className="btn-ghost btn-sm text-red-600" onClick={() => setQty(item.cart_uuid, 0)} aria-label={`${t('Remove')} ${item.name}`}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>

            <button className="btn-ghost btn-sm" onClick={() => setCartOpen(false)}>
              <Plus className="h-4 w-4" /> {t('Add more items')}
            </button>

            <form
              className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800"
              onSubmit={(e) => {
                e.preventDefault();
                placeOrder();
              }}
            >
              <h3 className="text-sm font-semibold">{t('Your details')}</h3>
              <Input
                label={t('Name')}
                required
                autoComplete="name"
                value={customer.name}
                error={errors.name}
                onChange={(e) => setCustomer({ ...customer, name: e.target.value })}
              />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input
                  label={t('Phone')}
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  value={customer.phone}
                  error={errors.phone}
                  onChange={(e) => setCustomer({ ...customer, phone: e.target.value })}
                />
                <Input
                  label={t('Email')}
                  type="email"
                  autoComplete="email"
                  value={customer.email}
                  error={errors.email}
                  onChange={(e) => setCustomer({ ...customer, email: e.target.value })}
                />
              </div>
              <Textarea label={t('Note for chef')} rows={2} value={chefNote} onChange={(e) => setChefNote(e.target.value)} placeholder={t('Allergies or anything the kitchen should know')} />
              {errors.table_id && <p className="error-text">{errors.table_id}</p>}
              <button type="submit" className="sr-only">
                {t('Place order')}
              </button>
            </form>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-16 text-center text-slate-500">
            <ShoppingBag className="h-10 w-10 text-slate-300" />
            <p>{t('Your order is empty')}</p>
            <button className="btn-secondary" onClick={() => setCartOpen(false)}>
              <ArrowLeft className="h-4 w-4 rtl:rotate-180" /> {t('Browse the menu')}
            </button>
          </div>
        )}
      </Drawer>
    </Shell>
  );
}

/* ================================================================ pieces */

function Shell({ tableTitle, count, onCart, children }: { tableTitle: string; count: number; onCart?: () => void; children: React.ReactNode }) {
  const t = useT();
  const { config } = useConfig();
  return (
    <div className="min-h-full bg-slate-50 dark:bg-slate-950">
      <div className="mx-auto min-h-dvh max-w-3xl bg-slate-50 px-[env(safe-area-inset-left)] dark:bg-slate-950 sm:border-x sm:border-slate-200 sm:dark:border-slate-800 lg:max-w-5xl 2xl:max-w-7xl">
        <header className="sticky top-0 z-30 flex h-[calc(60px+env(safe-area-inset-top))] items-center gap-3 border-b pt-[env(safe-area-inset-top)] border-slate-200 bg-white/95 px-4 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/95">
          <BrandIcon src={config.icon} className="h-9 w-9 rounded-lg object-contain" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-tight">{config.name}</p>
            <p className="truncate text-xs text-slate-500">
              {t('Digital Menu')} · <span className="font-medium text-brand-600 dark:text-brand-400">{tableTitle}</span>
            </p>
          </div>
          <ThemeToggle />
          {onCart && (
            <button className="btn-secondary relative h-11 w-11 p-0!" onClick={onCart} aria-label={`${t('Your order')}: ${count}`}>
              <ShoppingBag className="h-5 w-5" />
              {count > 0 && (
                <span className="absolute -inset-e-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white">
                  {count}
                </span>
              )}
            </button>
          )}
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}

function Notice({ icon, title, text, action }: { icon: React.ReactNode; title: string; text?: string; action?: React.ReactNode }) {
  const { config } = useConfig();
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-slate-50 p-6 text-center dark:bg-slate-950">
      <BrandIcon src={config.icon} className="mb-4 h-12 w-12 rounded-xl object-contain" />
      <div className="text-slate-400">{icon}</div>
      <h1 className="text-xl font-semibold">{title}</h1>
      {text && <p className="max-w-sm text-sm text-slate-500">{text}</p>}
      {action}
    </div>
  );
}

function CategoryChip({ active, onClick, label, icon }: { active: boolean; onClick: () => void; label: string; icon?: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={clsx(
        'flex h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium transition',
        active
          ? 'border-brand-600 bg-brand-600 text-white shadow-sm'
          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200',
        icon && 'ps-1.5',
      )}
    >
      {icon && <span className={clsx('flex h-8 w-8 items-center justify-center rounded-full', active ? 'bg-white/20' : 'bg-slate-100 dark:bg-slate-800')}>{icon}</span>}
      {label}
    </button>
  );
}

function ProductCard({ product, onOpen, onAdd, inCart }: { product: PosProduct; onOpen: () => void; onAdd: () => void; inCart: number }) {
  const t = useT();
  const { money } = useConfig();
  const fromPrice =
    product.has_variants && product.variants?.length ? Math.min(...product.variants.map((v) => Number(v.price) || 0)) : Number(product.price);
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
      <button type="button" onClick={onOpen} className="flex flex-1 flex-col text-start" aria-label={product.name}>
        <div className="relative aspect-4/3 w-full overflow-hidden bg-slate-100 dark:bg-slate-800">
          {product.image ? (
            <img src={product.image} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" onError={fallbackTo('product')} />
          ) : (
            <div className="flex h-full items-center justify-center text-slate-300">
              <ImageOff className="h-8 w-8" />
            </div>
          )}
          {inCart > 0 && (
            <span className="absolute inset-s-2 top-2 rounded-full bg-brand-600 px-2 py-0.5 text-xs font-bold text-white shadow-sm">
              {inCart} {t('in order')}
            </span>
          )}
        </div>
        <div className="p-3 pb-12">
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug">{product.name}</h3>
          {hasText(product.description) && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{product.description}</p>}
        </div>
      </button>
      <div className="absolute inset-x-3 bottom-3 flex items-center justify-between">
        <span className="text-sm font-bold tabular-nums">
          {product.has_variants && product.variants?.length ? <span className="me-1 text-[11px] font-normal text-slate-500">{t('from')}</span> : null}
          {money(fromPrice)}
        </span>
        <button
          type="button"
          onClick={onAdd}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white shadow-sm hover:bg-brand-700"
          aria-label={`${t('Add to Cart')}: ${product.name}`}
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>
    </article>
  );
}
