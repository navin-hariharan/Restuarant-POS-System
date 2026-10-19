import clsx from 'clsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, ChefHat, Maximize, Minimize, RefreshCw, Settings2, Volume2, VolumeX } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { CHIME_URL } from '@/lib/sound';
import { orderTotals, type CartItem } from '@/lib/cart';
import { FocusShell } from '@/layout/AppShell';
import { Menu, Spinner, Tabs } from '@/components/ui';
import { useAuth, useConfig, useT } from '@/providers/AppProviders';
import { KitchenTicket, ticketBackgrounds, type Chef, type KitchenOrder } from '@/components/kitchen/KitchenTicket';
import { orderTypeOptions } from '@/components/sales/saleUtils';

type View = 'all' | 'kitchen' | 'bar';
type KitchenResponse = { orders: KitchenOrder[]; chefs: Chef[] };

const ACK_KEY = 'acknowledged-kitchen-orders';
const SYNC_MS = 30_000;

/* The old UI stored these prefs as raw strings, so read/write them raw. */
function rawGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function rawSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}
function readAck(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(ACK_KEY) ?? '[]');
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}
function writeAck(list: string[]) {
  rawSet(ACK_KEY, JSON.stringify(list));
}

const gridCols: Record<number, string> = {
  0: 'grid-cols-[repeat(auto-fill,minmax(min(100%,19rem),1fr))]',
  1: 'grid-cols-1',
  2: 'grid-cols-1 md:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
  5: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5',
  6: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6',
};

function visibleFor(order: KitchenOrder, view: View) {
  return (order.items ?? [])
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !item.not_display && (view === 'all' || !!item.is_bar_type === (view === 'bar')));
}

export default function KitchenDisplay() {
  const t = useT();
  const { config } = useConfig();
  const { user } = useAuth();
  const qc = useQueryClient();

  const [view, setViewState] = useState<View>(() => (rawGet('kitchen_view') as View) || 'all');
  const [serviceType, setServiceType] = useState<string>(() => rawGet('kitchen_order_type') ?? '');
  const [cols, setCols] = useState<number>(() => {
    const raw = rawGet('orders_in_a_row');
    const n = Number(raw);
    // unset or "0": automatic, as many tickets per row as fit the screen
    return raw && n >= 1 && n <= 6 ? n : 0;
  });
  const [bg, setBg] = useState<string>(() => {
    const v = rawGet('orders_bg');
    return v && ticketBackgrounds[v] ? v : 'bg-white';
  });
  const [compact, setCompact] = useState(() => rawGet('kitchen_compact') === '1');
  const [sound, setSound] = useState(() => rawGet('kitchen_sound') !== '0');
  const [ack, setAck] = useState<string[]>(readAck);
  const [chefSel, setChefSel] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [now, setNow] = useState(() => Date.now());
  const [fullscreen, setFullscreen] = useState(false);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);

  const queryKey = useMemo(() => ['pos/kitchen-orders', serviceType], [serviceType]);
  const q = useQuery({
    queryKey,
    queryFn: async () =>
      (await api.get<KitchenResponse>('pos/kitchen-orders', { params: serviceType ? { order_type: serviceType } : {}, silent: true })).data,
    refetchInterval: SYNC_MS,
    refetchIntervalInBackground: true,
    staleTime: 0,
  });
  const orders = q.data?.orders ?? [];
  const chefs = q.data?.chefs ?? [];

  // Tick the timers.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const unacknowledged = useMemo(() => orders.filter((o) => !ack.includes(String(o.tracking))), [orders, ack]);

  const playBell = useCallback(() => {
    try {
      if (!audio.current) audio.current = new Audio(CHIME_URL);
      audio.current.currentTime = 0;
      const p = audio.current.play();
      if (p) {
        p.then(() => setSoundBlocked(false)).catch(() => setSoundBlocked(true));
      }
    } catch {
      setSoundBlocked(true);
    }
  }, []);

  // Ring on every sync while there are orders nobody acknowledged (same as the old board).
  useEffect(() => {
    if (!q.dataUpdatedAt || !sound) return;
    if (unacknowledged.length > 0) playBell();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.dataUpdatedAt]);

  const acknowledge = (trackings: (string | number)[]) => {
    const live = new Set(orders.map((o) => String(o.tracking)));
    // Keep the list small: drop orders that left the board (only when the board is unfiltered).
    const kept = serviceType ? ack : ack.filter((x) => live.has(x));
    const next = Array.from(new Set([...kept, ...trackings.map(String)]));
    setAck(next);
    writeAck(next);
  };
  const acknowledgeAll = () => {
    acknowledge(orders.map((o) => o.tracking));
    if (audio.current) audio.current.pause();
  };

  const chefFor = (order: KitchenOrder): number | null =>
    chefSel[order.uuid] ?? order.chef_id ?? chefs[0]?.id ?? user?.id ?? null;

  const update = async (order: KitchenOrder, items: CartItem[], chefId: number | null) => {
    // Items hidden from the board never get ticked; mark them ready with the rest
    // so the order can reach 100% and leave the board.
    if (items.filter((i) => !i.not_display).every((i) => i.is_ready)) {
      items = items.map((i) => (i.not_display ? { ...i, is_ready: true } : i));
    }
    const { progress } = orderTotals({ items, isItemBasedTaxation: false, tax: null, discountRate: 0, isDiscountInPercentage: false });
    acknowledge([order.tracking]);
    await qc.cancelQueries({ queryKey });
    const previous = qc.getQueryData<KitchenResponse>(queryKey);
    qc.setQueryData<KitchenResponse>(queryKey, (old) =>
      old ? { ...old, orders: old.orders.map((o) => (o.uuid === order.uuid ? { ...o, items, chef_id: chefId } : o)) } : old,
    );
    setBusy((b) => ({ ...b, [order.uuid]: true }));
    try {
      await api.post(`pos/order-progress/${order.uuid}`, { progress, items, chef_id: chefId });
      if (progress >= 100) toast.success(t('Order #:tracking is ready', { tracking: String(order.tracking) }));
    } catch {
      if (previous) qc.setQueryData(queryKey, previous);
    } finally {
      setBusy((b) => ({ ...b, [order.uuid]: false }));
      qc.invalidateQueries({ queryKey: ['pos/kitchen-orders'] });
    }
  };

  const toggleItem = (order: KitchenOrder, index: number) => {
    const items = order.items.map((it, i) => (i === index ? { ...it, is_ready: !it.is_ready } : it));
    update(order, items, chefFor(order));
  };
  const markAll = (order: KitchenOrder) => {
    const visible = new Set(visibleFor(order, view).map((v) => v.index));
    const items = order.items.map((it, i) => (visible.has(i) ? { ...it, is_ready: true } : it));
    update(order, items, chefFor(order));
  };
  const changeChef = (order: KitchenOrder, id: number) => {
    setChefSel((s) => ({ ...s, [order.uuid]: id }));
    update(order, order.items, id);
  };

  const setView = (v: View) => {
    setViewState(v);
    rawSet('kitchen_view', v);
  };

  // Oldest first so the most urgent ticket is top-left.
  const board = useMemo(
    () =>
      orders
        .map((o) => ({ order: o, visible: visibleFor(o, view) }))
        .filter((x) => x.visible.length > 0)
        .sort((a, b) => (a.order.took_at ?? '').localeCompare(b.order.took_at ?? '')),
    [orders, view],
  );
  const counts = useMemo(() => {
    const c = { all: 0, kitchen: 0, bar: 0 };
    for (const o of orders) {
      if (visibleFor(o, 'all').length) c.all++;
      if (visibleFor(o, 'kitchen').length) c.kitchen++;
      if (visibleFor(o, 'bar').length) c.bar++;
    }
    return c;
  }, [orders]);
  const pendingItems = board.reduce((s, x) => s + x.visible.filter((v) => !v.item.is_ready).length, 0);
  const lastSync = q.dataUpdatedAt ? new Date(q.dataUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
  const nextSyncIn = q.dataUpdatedAt ? Math.max(0, Math.ceil((q.dataUpdatedAt + SYNC_MS - now) / 1000)) : null;

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };

  const actions = (
    <>
      {unacknowledged.length > 0 && (
        <button type="button" className="btn-primary h-10 animate-pulse" onClick={acknowledgeAll}>
          <BellRing className="h-4 w-4" />
          <span className="hidden sm:inline">{t('Acknowledge')}</span>
          <span className="rounded-full bg-white/25 px-1.5 text-xs">{unacknowledged.length}</span>
        </button>
      )}
      <button
        type="button"
        className="btn-secondary h-10"
        onClick={() => q.refetch()}
        aria-label={t('Synchronize')}
        title={lastSync ? `${t('Last update')}: ${lastSync}` : t('Synchronize')}
      >
        <RefreshCw className={clsx('h-4 w-4', q.isFetching && 'animate-spin')} />
        <span className="hidden tabular-nums text-xs text-slate-500 lg:inline">{nextSyncIn !== null ? `${nextSyncIn}s` : ''}</span>
      </button>
      <button
        type="button"
        className="btn-ghost btn-icon h-10 w-10"
        onClick={() => {
          const v = !sound;
          setSound(v);
          rawSet('kitchen_sound', v ? '1' : '0');
          if (v) playBell();
        }}
        aria-label={sound ? t('Mute') : t('Unmute')}
        title={sound ? t('Mute') : t('Unmute')}
        aria-pressed={sound}
      >
        {sound ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
      </button>
      <Menu
        trigger={({ toggle }) => (
          <button type="button" className="btn-ghost btn-icon h-10 w-10" onClick={toggle} aria-label={t('Display settings')} title={t('Display settings')}>
            <Settings2 className="h-5 w-5" />
          </button>
        )}
      >
        <div className="w-72 space-y-4 p-3">
          <fieldset>
            <legend className="label">{t('Orders in a row')}</legend>
            <div className="grid grid-cols-7 gap-1">
              {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={cols === n}
                  onClick={() => {
                    setCols(n);
                    rawSet('orders_in_a_row', String(n));
                  }}
                  className={clsx(
                    'h-10 rounded-lg border text-sm font-semibold first:text-xs',
                    cols === n ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800',
                  )}
                >
                  {n || t('Auto')}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="label">{t('Background')}</legend>
            <div className="grid grid-cols-5 gap-1.5">
              {Object.entries(ticketBackgrounds).map(([key, b]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={bg === key}
                  aria-label={b.label}
                  title={b.label}
                  onClick={() => {
                    setBg(key);
                    rawSet('orders_bg', key);
                  }}
                  className={clsx('h-10 rounded-lg border-2', b.swatch, bg === key ? 'border-brand-600 ring-2 ring-brand-500/40' : 'border-slate-300 dark:border-slate-600')}
                />
              ))}
            </div>
          </fieldset>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>{t('Compact tickets')}</span>
            <input
              type="checkbox"
              className="h-5 w-5 accent-brand-600"
              checked={compact}
              onChange={(e) => {
                setCompact(e.target.checked);
                rawSet('kitchen_compact', e.target.checked ? '1' : '0');
              }}
            />
          </label>
        </div>
      </Menu>
      <button
        type="button"
        className="btn-ghost btn-icon hidden h-10 w-10 sm:inline-flex"
        onClick={toggleFullscreen}
        aria-label={fullscreen ? t('Exit full screen') : t('Full screen')}
        title={fullscreen ? t('Exit full screen') : t('Full screen')}
      >
        {fullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
      </button>
    </>
  );

  return (
    <FocusShell
      title={
        <span className="flex items-center gap-2">
          <ChefHat className="h-5 w-5 text-brand-600" />
          <span className="hidden sm:inline">{t('Kitchen display')}</span>
        </span>
      }
      actions={actions}
    >
      <div className="flex h-full flex-col bg-slate-100 dark:bg-slate-950">
        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
          <Tabs<View>
            value={view}
            onChange={setView}
            className="[&_button]:min-h-[40px] [&_button]:px-4"
            tabs={[
              { value: 'all', label: t('All'), count: counts.all },
              { value: 'kitchen', label: t('Kitchen'), count: counts.kitchen },
              { value: 'bar', label: t('Bar'), count: counts.bar },
            ]}
          />
          <label className="sr-only" htmlFor="kds-order-type">
            {t('Order type')}
          </label>
          <select
            id="kds-order-type"
            className="input h-11 w-auto py-0"
            value={serviceType}
            onChange={(e) => {
              setServiceType(e.target.value);
              rawSet('kitchen_order_type', e.target.value);
            }}
          >
            <option value="">{t('All order types')}</option>
            {orderTypeOptions(config).map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.label)}
              </option>
            ))}
          </select>
          <div className="ms-auto flex items-center gap-3 text-sm text-slate-600 dark:text-slate-400">
            <span>
              <strong className="tabular-nums text-slate-900 dark:text-white">{board.length}</strong> {t('Orders')}
            </span>
            <span>
              <strong className="tabular-nums text-slate-900 dark:text-white">{pendingItems}</strong> {t('Items to prepare')}
            </span>
            <span className="hidden items-center gap-2 md:flex" aria-hidden="true">
              <span className="h-3 w-3 rounded-xs bg-slate-800" />
              {'<10′'}
              <span className="h-3 w-3 rounded-xs bg-amber-400" />
              {'10–20′'}
              <span className="h-3 w-3 rounded-xs bg-red-600" />
              {'>20′'}
            </span>
          </div>
        </div>

        {sound && soundBlocked && unacknowledged.length > 0 && (
          <button type="button" onClick={playBell} className="tap bg-amber-100 px-3 py-2.5 text-sm font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {t('Your browser blocked the bell. Tap here once to enable sound.')}
          </button>
        )}
        {q.isError && (
          <div className="flex items-center justify-between gap-3 bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-300" role="alert">
            {t('Unable to reach the server. Retrying automatically.')}
            <button type="button" className="btn-secondary btn-sm" onClick={() => q.refetch()}>
              {t('Retry')}
            </button>
          </div>
        )}

        {/* Board */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {q.isLoading ? (
            <div className="flex h-full items-center justify-center text-brand-600">
              <Spinner className="h-8 w-8" />
            </div>
          ) : board.length ? (
            <div className={clsx('grid items-start gap-3', gridCols[cols] ?? gridCols[0])}>
              {board.map(({ order, visible }) => (
                <KitchenTicket
                  key={order.uuid}
                  order={order}
                  visibleItems={visible}
                  chefs={chefs}
                  chefId={chefFor(order)}
                  now={now}
                  isNew={!ack.includes(String(order.tracking))}
                  busy={!!busy[order.uuid]}
                  bg={bg}
                  compact={compact}
                  onToggleItem={(i) => toggleItem(order, i)}
                  onMarkAll={() => markAll(order)}
                  onChef={(id) => changeChef(order, id)}
                  onAcknowledge={() => acknowledge([order.tracking])}
                />
              ))}
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-slate-400">
              <ChefHat className="h-16 w-16" />
              <p className="text-xl font-medium">{t('All caught up')}</p>
              <p className="text-sm">{t('New orders appear here automatically.')}</p>
            </div>
          )}
        </div>
      </div>
    </FocusShell>
  );
}
