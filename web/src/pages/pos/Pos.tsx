import clsx from 'clsx';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BedDouble, ClipboardList, Landmark, Settings2, ShoppingCart, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { addToCart, recalcItem, type CartItem, type PosProduct } from '@/lib/cart';
import { FocusShell } from '@/layout/AppShell';
import { Button, FullScreenLoader, Menu, useConfirm } from '@/components/ui';
import { useAuth, useConfig, useT } from '@/providers/AppProviders';
import { CartPanel, type CartActions } from '@/components/pos/CartPanel';
import {
  checkoutPayload,
  defaultOrderType,
  draftFromOrder,
  emptyDraft,
  fingerprint,
  loadDraft,
  orderPayload,
  readCols,
  readPerPage,
  saveDraft,
  slimCustomer,
  totalsFor,
  writeCols,
  writeDefaultOrderType,
  writePerPage,
  type Draft,
} from '@/components/pos/draft';
import { LineEditor, VariantPicker, type LineEditorTab } from '@/components/pos/ItemModals';
import { CancelOrderModal, CheckoutModal, DiscountModal, NotesModal, SplitModal, TaxModal, type CheckoutValues } from '@/components/pos/OrderModals';
import { AddressPicker, CustomerPicker, PickupPicker, RoomPicker, TablePicker } from '@/components/pos/Pickers';
import { ProductBrowser, type ProductBrowserHandle } from '@/components/pos/ProductBrowser';
import { posKeys, useCustomerSearch, usePaymentMethods, useSubmittedOrders, useTaxes } from '@/components/pos/queries';
import { OpenRegister, RegisterModal, useRegisterCheck } from '@/components/pos/Register';
import { SubmittedOrdersDrawer, useReadyBell } from '@/components/pos/SubmittedOrders';
import type { BillingOrder, SubmittedOrder } from '@/components/pos/types';

export default function Pos() {
  const t = useT();
  const { config } = useConfig();
  const register = useRegisterCheck(config.modes.cashbooks);
  if (config.modes.cashbooks) {
    if (register.isLoading) return <FullScreenLoader />;
    if (register.data && !register.data.has_open_register) {
      return (
        <FocusShell title={t('Point of sale')}>
          <OpenRegister />
        </FocusShell>
      );
    }
  }
  return <PosScreen />;
}

type Picker = null | 'table' | 'pickup' | 'address' | 'room' | 'customer' | 'discount' | 'tax' | 'notes' | 'split' | 'register' | 'reservations';

function PosScreen() {
  const t = useT();
  const { config, money } = useConfig();
  const { can } = useAuth();
  const modes = config.modes;
  const navigate = useNavigate();
  const params = useParams<{ uuid?: string }>();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const browserRef = useRef<ProductBrowserHandle>(null);

  const newDraft = useCallback(
    (customer?: Draft['customer']) =>
      emptyDraft({ orderType: defaultOrderType(config.order_types), tax: config.tax_setup, itemBasedTax: !!modes.item_based_tax, customer }),
    [config.order_types, config.tax_setup, modes.item_based_tax],
  );

  const [draft, setDraft] = useState<Draft>(() => {
    const saved = loadDraft();
    if (saved && config.order_types.some((o) => o.key === saved.order_type)) return saved;
    return newDraft();
  });
  useEffect(() => saveDraft(draft), [draft]);

  // UI state
  const [picker, setPicker] = useState<Picker>(null);
  const [variantProduct, setVariantProduct] = useState<PosProduct | null>(null);
  const [editing, setEditing] = useState<{ item: CartItem; tab: LineEditorTab } | null>(null);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<{ uuid: string; tracking?: string | null } | null>(null);
  const [cartOpen, setCartOpen] = useState(false); // small screens
  const [cols, setCols] = useState(readCols);
  const [perPage, setPerPage] = useState(readPerPage);
  const [loadingOrder, setLoadingOrder] = useState(false);

  // Data
  const taxes = useTaxes(modes.taxation);
  const methods = usePaymentMethods(can('order_checkout'));
  const walkIn = useCustomerSearch('');
  const submitted = useSubmittedOrders();
  const bell = useReadyBell(submitted.data, submitted.dataUpdatedAt, true);

  // Default customer: the walk-in customer returned by pos/customers without search.
  useEffect(() => {
    if (!draft.customer && walkIn.data?.[0]) setDraft((d) => (d.customer ? d : { ...d, customer: slimCustomer(walkIn.data![0]) }));
  }, [draft.customer, walkIn.data]);

  const totals = useMemo(() => totalsFor(draft), [draft]);
  const dirty = !!draft.uuid && fingerprint(draft) !== draft.snapshot;
  const tableRequired = !modes.table_is_option;

  /* ------------------------------------------------------------ cart ops */

  const addProduct = useCallback(
    (p: PosProduct) => {
      if (Number(p.in_stock ?? 1) <= 0) {
        toast.warning(t('This item is out of stock'));
        return;
      }
      setDraft((d) => ({
        ...d,
        items: addToCart(d.items, p, { itemBasedTax: d.is_item_based_taxation, isReady: !!modes.bypass_kitchen_bar, defaultTax: config.tax_setup }),
      }));
    },
    [config.tax_setup, modes.bypass_kitchen_bar, t],
  );

  const pickProduct = useCallback(
    (p: PosProduct) => {
      if (p.has_variants && (p.variants?.length ?? 0) > 0) setVariantProduct(p);
      else addProduct(p);
    },
    [addProduct],
  );

  const updateLine = (item: CartItem) =>
    setDraft((d) => ({ ...d, items: d.items.map((i) => (i.cart_uuid === item.cart_uuid ? recalcItem({ ...item }, d.is_item_based_taxation) : i)) }));

  const resetDraft = useCallback(() => {
    // Keep the walk-in customer, drop any named customer. Saved right away because a
    // navigation (print on submit) may unmount the page before the persist effect runs.
    const keep = draft.customer && draft.customer.id === walkIn.data?.[0]?.id ? draft.customer : walkIn.data?.[0] ? slimCustomer(walkIn.data[0]) : null;
    const next = newDraft(keep);
    saveDraft(next);
    setDraft(next);
    setCartOpen(false);
  }, [newDraft, walkIn.data, draft.customer]);

  /* ------------------------------------------------------- load an order */

  const loadOrder = useCallback(
    async (uuid: string): Promise<Draft | null> => {
      setLoadingOrder(true);
      try {
        const r = await api.post<BillingOrder & { message?: string }>('pos/submited-sale', { uuid });
        if ((r.data as any)?.message && !(r.data as any)?.uuid) {
          toast.warning(String((r.data as any).message));
          return null;
        }
        const d = draftFromOrder(r.data, config.tax_setup);
        setDraft(d);
        return d;
      } catch {
        return null;
      } finally {
        setLoadingOrder(false);
      }
    },
    [config.tax_setup],
  );

  // /admin/pos/:uuid → load that submitted order into the cart, then drop the param.
  useEffect(() => {
    if (!params.uuid) return;
    const uuid = params.uuid;
    navigate('/admin/pos', { replace: true });
    void loadOrder(uuid);
  }, [params.uuid, navigate, loadOrder]);

  const guardDiscard = async (targetUuid?: string) => {
    if (targetUuid && draft.uuid === targetUuid) return true;
    if (draft.items.length && (!draft.uuid || dirty)) {
      return confirm({
        title: t('Discard current cart?'),
        message: t('The items in the current cart have not been submitted.'),
        confirmText: t('Discard'),
      });
    }
    return true;
  };

  /* --------------------------------------------------------- submit/update */

  const validate = (d: Draft): boolean => {
    if (!d.items.length) return false;
    if (d.order_type === 'dining' && tableRequired && !d.table) {
      toast.warning(t('Service table is required for dinning order'));
      setPicker('table');
      return false;
    }
    if (d.order_type === 'roomservice' && !d.reservation) {
      toast.warning(t('Please select guest room.'));
      setPicker('room');
      return false;
    }
    if (!d.customer) {
      toast.warning(t('Customer is required'));
      setPicker('customer');
      return false;
    }
    return true;
  };

  const afterChange = () => {
    qc.invalidateQueries({ queryKey: posKeys.submitted });
    qc.invalidateQueries({ queryKey: posKeys.tables });
    qc.invalidateQueries({ queryKey: posKeys.reservations });
  };

  const submit = useMutation({
    mutationFn: async (d: Draft) => {
      const body = orderPayload(d);
      const r = d.uuid
        ? await api.patch<{ message: string; order: string }>(`admin/sales/${d.uuid}`, body)
        : await api.post<{ message: string; order: string }>('admin/sales', body);
      return r.data;
    },
    onSuccess: (r) => {
      afterChange();
      resetDraft();
      if (modes.print_on_submit && r.order) {
        navigate(`/print/sale/${r.order}`);
        return;
      }
      toast.success(r.message);
    },
  });

  const checkout = useMutation({
    mutationFn: async ({ d, v }: { d: Draft; v: CheckoutValues }) => {
      if (fingerprint(d) !== d.snapshot) await api.patch(`admin/sales/${d.uuid}`, orderPayload(d));
      const r = await api.post<{ message: string }>(`pos/checkout/${d.uuid}`, checkoutPayload(d, v));
      return { ...r.data, uuid: d.uuid! };
    },
    onSuccess: (r) => {
      toast.success(r.message);
      setCheckoutOpen(false);
      afterChange();
      resetDraft();
      navigate(`/print/sale/${r.uuid}`);
    },
  });

  const split = useMutation({
    mutationFn: async (picked: string[]) => {
      const keep = draft.items.filter((i) => !picked.includes(i.cart_uuid));
      const moved = draft.items.filter((i) => picked.includes(i.cart_uuid));
      const r = await api.patch<{ message: string; order: string }>(`admin/sales/${draft.uuid}`, orderPayload({ ...draft, items: keep }));
      // Like the old UI the split-off order keeps destination, customer and staff, starts without discount and is marked prepared.
      const splitDraft: Draft = { ...draft, uuid: null, items: moved, discount_rate: 0, note_for_chef: '', staff_note: '' };
      const s = await api.post<{ message: string; order: string }>('admin/sales', orderPayload(splitDraft, { isSpliting: true, progress: 100 }));
      return { original: r.data.order, message: s.data.message };
    },
    onSuccess: (r) => {
      setPicker(null);
      afterChange();
      resetDraft();
      if (modes.print_on_submit && r.original) {
        navigate(`/print/sale/${r.original}`);
        return;
      }
      toast.success(t('Order has been split'));
    },
  });

  const cancel = useMutation({
    mutationFn: async ({ uuid, reason }: { uuid: string; reason: string }) =>
      (await api.post<{ message: string }>(`pos/pos.cancel-orders/${uuid}`, { is_cancelled: true, cancellation_reason: reason })).data,
    onSuccess: (r, vars) => {
      toast.success(r.message);
      setCancelTarget(null);
      if (draft.uuid === vars.uuid) resetDraft();
      afterChange();
    },
  });

  const remove = useMutation({
    mutationFn: async (uuid: string) => (await api.delete<{ message: string }>(`admin/sales/${uuid}`)).data,
    onSuccess: (r, uuid) => {
      toast.success(r.message);
      if (draft.uuid === uuid) resetDraft();
      afterChange();
    },
  });

  /* ------------------------------------------------------------- actions */

  const actions: CartActions = {
    setOrderType: (key) => {
      writeDefaultOrderType(key);
      setDraft((d) => ({ ...d, order_type: key }));
    },
    openDestination: () => {
      const map: Record<string, Picker> = { dining: 'table', pickup: 'pickup', dilivery: 'address', roomservice: 'room' };
      setPicker(map[draft.order_type] ?? null);
    },
    openCustomer: () => setPicker('customer'),
    setQty: (id, qty) =>
      setDraft((d) => ({
        ...d,
        items:
          qty <= 0
            ? d.items.filter((i) => i.cart_uuid !== id)
            : d.items.map((i) => (i.cart_uuid === id ? recalcItem({ ...i, qty }, d.is_item_based_taxation) : i)),
      })),
    remove: (id) => setDraft((d) => ({ ...d, items: d.items.filter((i) => i.cart_uuid !== id) })),
    edit: (item, tab) => setEditing({ item, tab }),
    openDiscount: () => setPicker('discount'),
    openTax: () => setPicker('tax'),
    openNotes: () => setPicker('notes'),
    clear: async () => {
      if (draft.items.length && !draft.uuid && !(await confirm({ title: t('Clear cart'), message: t('Remove all items from the cart?'), confirmText: t('Clear') })))
        return;
      if (draft.uuid && dirty && !(await guardDiscard())) return;
      resetDraft();
    },
    submit: () => {
      if (validate(draft)) submit.mutate(draft);
    },
    checkout: () => {
      if (!validate(draft)) return;
      setCheckoutOpen(true);
    },
    split: () => setPicker('split'),
    cancel: () => draft.uuid && setCancelTarget({ uuid: draft.uuid, tracking: draft.tracking }),
    print: () => draft.uuid && navigate(`/print/sale/${draft.uuid}`),
  };

  /* -------------------------------------------------- submitted orders UI */

  const editOrder = async (o: SubmittedOrder, thenCheckout = false) => {
    if (!(await guardDiscard(o.uuid))) return;
    setOrdersOpen(false);
    const d = draft.uuid === o.uuid && !thenCheckout ? draft : await loadOrder(o.uuid);
    if (d && thenCheckout) setCheckoutOpen(true);
    if (d) setCartOpen(true);
  };

  /* -------------------------------------------------- keyboard / scanner */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
      if (document.querySelector('[role="dialog"]')) return;
      browserRef.current?.focusSearch();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const qtyInCart = (uuid: string) => draft.items.filter((i) => i.uuid === uuid).reduce((s, i) => s + Number(i.qty), 0);
  const pendingReady = bell.pending.length;
  const roomsEnabled = !!modes.room_reservations_enabled;

  /* ------------------------------------------------------------- render */

  const headerActions = (
    <>
      <Button
        className={clsx('relative h-10', pendingReady > 0 && 'animate-pulse border-emerald-500! text-emerald-700! dark:text-emerald-300!')}
        icon={<ClipboardList className="h-4 w-4" />}
        onClick={() => setOrdersOpen(true)}
      >
        <span className="hidden sm:inline">{t('Orders')}</span>
        {(submitted.data?.length ?? 0) > 0 && (
          <span className={clsx('rounded-full px-1.5 text-xs font-semibold text-white', pendingReady ? 'bg-emerald-600' : 'bg-slate-500')}>
            {submitted.data!.length}
          </span>
        )}
      </Button>
      {roomsEnabled && (
        <Button className="h-10" icon={<BedDouble className="h-4 w-4" />} onClick={() => setPicker('reservations')} aria-label={t('Reservations')}>
          <span className="hidden md:inline">{t('Reservations')}</span>
        </Button>
      )}
      {modes.cashbooks && (
        <Button className="h-10" icon={<Landmark className="h-4 w-4" />} onClick={() => setPicker('register')} aria-label={t('Register')}>
          <span className="hidden md:inline">{t('Register')}</span>
        </Button>
      )}
      <Menu
        trigger={({ toggle }) => (
          <button className="btn-ghost h-10 w-10 p-0!" onClick={toggle} aria-label={t('Display settings')} title={t('Display settings')}>
            <Settings2 className="h-5 w-5" />
          </button>
        )}
      >
        <div className="space-y-3 p-3">
          <label className="block text-sm">
            <span className="label">{t('items in row')}</span>
            <select
              className="input"
              value={cols}
              onChange={(e) => {
                const n = Number(e.target.value);
                setCols(n);
                writeCols(n);
              }}
            >
              <option value={0}>{t('Automatic')}</option>
              {[3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="label">{t('per page')}</span>
            <select
              className="input"
              value={perPage}
              onChange={(e) => {
                const n = Number(e.target.value);
                setPerPage(n);
                writePerPage(n);
              }}
            >
              {[12, 15, 18, 24, 30, 36, 48, 60].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
        </div>
      </Menu>
    </>
  );

  return (
    <FocusShell title={t('Point of sale')} actions={headerActions}>
      <div className="relative flex h-full min-h-0">
        <div className="min-w-0 flex-1 pb-16 lg:pb-0">
          <ProductBrowser ref={browserRef} cols={cols} perPage={perPage} onPick={pickProduct} onAdd={addProduct} />
        </div>

        {/* Cart: side panel on large screens, slide-over on small ones */}
        <aside
          aria-label={t('Cart')}
          className={clsx(
            'border-s border-slate-200 dark:border-slate-800',
            'lg:static lg:flex lg:w-[400px] lg:shrink-0 xl:w-[440px]',
            cartOpen ? 'fixed inset-0 z-30 flex flex-col' : 'hidden',
          )}
        >
          <div className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900 lg:hidden">
            <span className="font-semibold">{t('Cart')}</span>
            <button className="btn-ghost h-10 w-10 p-0!" onClick={() => setCartOpen(false)} aria-label={t('Close')}>
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="min-h-0 w-full flex-1">
            <CartPanel draft={draft} totals={totals} actions={actions} submitting={submit.isPending || loadingOrder} tableRequired={tableRequired} />
          </div>
        </aside>

        {/* Mobile cart bar */}
        {!cartOpen && (
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="fixed inset-x-3 bottom-3 z-20 flex h-14 items-center justify-between rounded-2xl bg-brand-600 px-4 text-white shadow-lg lg:hidden"
          >
            <span className="flex items-center gap-2 font-medium">
              <ShoppingCart className="h-5 w-5" />
              {totals.cartTotalItems} {t('items')}
              {draft.uuid && <span className="rounded-sm bg-white/20 px-1.5 text-xs">#{draft.tracking}</span>}
            </span>
            <span className="text-lg font-semibold tabular-nums">{money(totals.totalAmount)}</span>
          </button>
        )}
      </div>

      {/* Modals */}
      <VariantPicker product={variantProduct} onClose={() => setVariantProduct(null)} onAdd={addProduct} qtyInCart={qtyInCart} />
      {editing && (
        <LineEditor
          item={editing.item}
          initialTab={editing.tab}
          onClose={() => setEditing(null)}
          onSave={(item) => {
            updateLine(item);
            setEditing(null);
          }}
          itemBasedTax={draft.is_item_based_taxation}
          taxation={!!modes.taxation}
          bypassKitchen={!!modes.bypass_kitchen_bar}
          taxes={taxes.data ?? []}
        />
      )}
      <TablePicker
        open={picker === 'table'}
        onClose={() => setPicker(null)}
        value={draft.table}
        ownTableId={draft.uuid ? draft.own_table_id ?? null : null}
        allowReselect={!!modes.allow_table_reselect}
        autoClose={!!modes.autoclose_service_table_model}
        onChange={(table) => setDraft((d) => ({ ...d, table }))}
      />
      <PickupPicker
        open={picker === 'pickup'}
        onClose={() => setPicker(null)}
        value={draft.pickup_point}
        autoClose={!!modes.autoclose_pickup_model}
        onChange={(pickup_point) => setDraft((d) => ({ ...d, pickup_point }))}
      />
      <AddressPicker
        open={picker === 'address'}
        onClose={() => setPicker(null)}
        value={draft.shipping_address}
        customer={draft.customer}
        autoClose={!!modes.autoclose_shipping_model}
        onChange={(shipping_address) => setDraft((d) => ({ ...d, shipping_address }))}
        onCustomerUpdated={(customer) => setDraft((d) => ({ ...d, customer }))}
      />
      <RoomPicker open={picker === 'room'} onClose={() => setPicker(null)} value={draft.reservation} onChange={(reservation) => setDraft((d) => ({ ...d, reservation }))} />
      <RoomPicker open={picker === 'reservations'} onClose={() => setPicker(null)} value={null} pickable={false} />
      <CustomerPicker
        open={picker === 'customer'}
        onClose={() => setPicker(null)}
        value={draft.customer}
        onChange={(customer) =>
          setDraft((d) => ({
            ...d,
            customer,
            // a delivery address belongs to the previous customer
            shipping_address: d.customer?.id === customer.id ? d.shipping_address : null,
          }))
        }
      />
      <DiscountModal
        open={picker === 'discount'}
        onClose={() => setPicker(null)}
        rate={draft.discount_rate}
        inPercent={draft.is_discount_in_percentage}
        subtotal={totals.cartTotalPrice}
        onApply={(discount_rate, is_discount_in_percentage) => setDraft((d) => ({ ...d, discount_rate, is_discount_in_percentage }))}
      />
      <TaxModal open={picker === 'tax'} onClose={() => setPicker(null)} taxes={taxes.data ?? []} value={draft.tax} onApply={(tax) => setDraft((d) => ({ ...d, tax }))} />
      <NotesModal
        open={picker === 'notes'}
        onClose={() => setPicker(null)}
        chefNote={draft.note_for_chef}
        staffNote={draft.staff_note}
        onApply={(note_for_chef, staff_note) => setDraft((d) => ({ ...d, note_for_chef, staff_note }))}
      />
      <SplitModal open={picker === 'split'} onClose={() => setPicker(null)} items={draft.items} loading={split.isPending} onSplit={(ids) => split.mutate(ids)} />
      {modes.cashbooks && <RegisterModal open={picker === 'register'} onClose={() => setPicker(null)} />}
      <CancelOrderModal
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        tracking={cancelTarget?.tracking}
        loading={cancel.isPending}
        onConfirm={(reason) => cancelTarget && cancel.mutate({ uuid: cancelTarget.uuid, reason })}
      />
      <CheckoutModal
        open={checkoutOpen && !!draft.uuid}
        onClose={() => setCheckoutOpen(false)}
        tracking={draft.tracking}
        total={totals.totalAmount}
        tipEnabled={!!modes.customer_tip_collection}
        initialTip={Number(draft.tip_amount) || 0}
        methods={methods.data ?? []}
        initialMethodId={draft.payment_method_id}
        initialPaymentNote={draft.payment_note}
        initialStaffNote={draft.staff_note}
        loading={checkout.isPending}
        onConfirm={(v) => checkout.mutate({ d: draft, v })}
      />
      <SubmittedOrdersDrawer
        open={ordersOpen}
        onClose={() => setOrdersOpen(false)}
        orders={submitted.data ?? []}
        loading={submitted.isLoading}
        fetching={submitted.isFetching}
        onRefresh={() => submitted.refetch()}
        pendingCount={pendingReady}
        onAcknowledge={bell.acknowledge}
        currentUuid={draft.uuid}
        onEdit={(o) => void editOrder(o)}
        onCheckout={(o) => void editOrder(o, true)}
        onCancel={(o) => setCancelTarget({ uuid: o.uuid, tracking: o.tracking })}
        onPrint={(o) => navigate(`/print/sale/${o.uuid}`)}
        onDelete={
          can('remove_sales')
            ? async (o) => {
                if (await confirm({ title: t('Delete submitted order'), message: `#${o.tracking}` })) remove.mutate(o.uuid);
              }
            : undefined
        }
        showProgress={!modes.bypass_kitchen_bar}
      />
    </FocusShell>
  );
}
