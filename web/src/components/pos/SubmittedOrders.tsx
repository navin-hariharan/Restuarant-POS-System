import clsx from 'clsx';
import { BellRing, CheckCheck, ClipboardList, CreditCard, Pencil, Printer, RefreshCw, Trash2, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Drawer, EmptyState, Select, Spinner, Tabs } from '@/components/ui';
import { useAuth, useConfig, useT } from '@/providers/AppProviders';
import { orderTypeLabel, readAcknowledged, writeAcknowledged } from './draft';
import type { SubmittedOrder } from './types';
import { CHIME_URL } from '@/lib/sound';


export function playBell() {
  try {
    const a = new Audio(CHIME_URL);
    a.loop = false;
    void a.play().catch(() => {});
  } catch {
    /* audio unavailable */
  }
}

/** Ready (progress 100) orders that the cashier has not acknowledged yet. */
export function unacknowledgedReady(orders: SubmittedOrder[] | undefined, acked: string[]) {
  return (orders ?? []).filter((o) => Number(o.progress) > 99 && !acked.includes(String(o.tracking)));
}

/** Rings the bell after every refresh that finds ready orders not yet acknowledged (old UI behaviour). */
export function useReadyBell(orders: SubmittedOrder[] | undefined, updatedAt: number, enabled: boolean) {
  const [acked, setAcked] = useState<string[]>(() => readAcknowledged());
  const pending = useMemo(() => unacknowledgedReady(orders, acked), [orders, acked]);
  useEffect(() => {
    if (enabled && pending.length) playBell();
    // only when fresh data arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updatedAt]);
  const acknowledge = () => {
    const ids = (orders ?? []).filter((o) => Number(o.progress) > 99).map((o) => String(o.tracking));
    writeAcknowledged(ids);
    setAcked(ids);
  };
  return { pending, acknowledge };
}

type Tab = 'all' | 'progress' | 'ready';

export function SubmittedOrdersDrawer({
  open,
  onClose,
  orders,
  loading,
  fetching,
  onRefresh,
  pendingCount,
  onAcknowledge,
  currentUuid,
  onEdit,
  onCheckout,
  onCancel,
  onPrint,
  onDelete,
  showProgress,
}: {
  open: boolean;
  onClose: () => void;
  orders: SubmittedOrder[];
  loading: boolean;
  fetching: boolean;
  onRefresh: () => void;
  pendingCount: number;
  onAcknowledge: () => void;
  currentUuid: string | null;
  onEdit: (o: SubmittedOrder) => void;
  onCheckout: (o: SubmittedOrder) => void;
  onCancel: (o: SubmittedOrder) => void;
  onPrint: (o: SubmittedOrder) => void;
  onDelete?: (o: SubmittedOrder) => void;
  showProgress: boolean;
}) {
  const t = useT();
  const { config, money } = useConfig();
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('all');
  const [type, setType] = useState('');
  const [table, setTable] = useState('');

  const tables = useMemo(() => {
    const map = new Map<number, string>();
    for (const o of orders) if (o.service_table?.id) map.set(o.service_table.id, o.service_table.title);
    return [...map.entries()].map(([value, label]) => ({ value, label }));
  }, [orders]);

  const filtered = orders.filter(
    (o) => (!type || o.order_type === type) && (!table || String(o.service_table?.id ?? '') === table),
  );
  const inProgress = filtered.filter((o) => Number(o.progress) < 100);
  const ready = filtered.filter((o) => Number(o.progress) > 99);
  const list = tab === 'progress' ? inProgress : tab === 'ready' ? ready : filtered;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="max-w-2xl"
      title={
        <span className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5" /> {t('Orders in process')}
          {fetching && <Spinner className="h-4 w-4 text-brand-600" />}
        </span>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'all', label: t('All'), count: filtered.length },
            ...(showProgress ? [{ value: 'progress' as Tab, label: t('In Process'), count: inProgress.length }] : []),
            { value: 'ready', label: t('Ready'), count: ready.length },
          ]}
        />
        <div className="ms-auto flex gap-2">
          <Button size="sm" variant="ghost" icon={<RefreshCw className="h-4 w-4" />} onClick={onRefresh}>
            {t('Reload')}
          </Button>
          <Button
            size="sm"
            variant={pendingCount ? 'success' : 'secondary'}
            icon={<CheckCheck className="h-4 w-4" />}
            onClick={onAcknowledge}
            disabled={!pendingCount}
          >
            {t('Acknowledge')}
            {pendingCount > 0 && ` (${pendingCount})`}
          </Button>
        </div>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-2">
        <Select
          aria-label={t('Order Type')}
          value={type}
          onChange={(e) => setType(e.target.value)}
          placeholder={t('All order types')}
          options={config.order_types.map((o) => ({ value: o.key, label: o.title }))}
        />
        <Select
          aria-label={t('Filter by table')}
          value={table}
          onChange={(e) => setTable(e.target.value)}
          placeholder={t('Filter by table')}
          options={tables}
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-10 text-brand-600"><Spinner className="h-6 w-6" /></div>
      ) : !list.length ? (
        <EmptyState title={t('No orders')} icon={<ClipboardList className="h-6 w-6" />} />
      ) : (
        <ul className="space-y-3">
          {list.map((o) => {
            const isReady = Number(o.progress) > 99;
            return (
              <li
                key={o.uuid}
                className={clsx(
                  'rounded-xl border p-3',
                  isReady ? 'border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/30' : 'border-slate-200 dark:border-slate-800',
                  currentUuid === o.uuid && 'ring-2 ring-brand-500',
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-semibold">
                      #{o.tracking}
                      <Badge tone="blue">{orderTypeLabel(config.order_types, o.order_type)}</Badge>
                      {isReady && <Badge tone="green"><BellRing className="h-3 w-3" />{t('Ready')}</Badge>}
                    </p>
                    <p className="mt-0.5 truncate text-sm text-slate-500">
                      {[o.service_table?.title, o.pickup_point?.place_title, o.customer?.name].filter(Boolean).join(' · ')}
                    </p>
                    <p className="text-xs text-slate-400">{o.created_at}</p>
                  </div>
                  <p className="text-lg font-semibold tabular-nums">{money(o.payable_after_all)}</p>
                </div>
                {showProgress && (
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800" role="progressbar" aria-valuenow={Number(o.progress)} aria-valuemin={0} aria-valuemax={100}>
                      <div className={clsx('h-full rounded-full', isReady ? 'bg-emerald-500' : 'bg-brand-500')} style={{ width: `${Math.min(100, Number(o.progress) || 0)}%` }} />
                    </div>
                    <span className="w-10 text-end text-xs tabular-nums text-slate-500">{Math.round(Number(o.progress) || 0)}%</span>
                  </div>
                )}
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Button className="h-11" icon={<Pencil className="h-4 w-4" />} onClick={() => onEdit(o)}>{t('Edit')}</Button>
                  {can('order_checkout') && (
                    <Button className="h-11" variant="success" icon={<CreditCard className="h-4 w-4" />} onClick={() => onCheckout(o)}>{t('Payment')}</Button>
                  )}
                  <Button className="h-11" icon={<Printer className="h-4 w-4" />} onClick={() => onPrint(o)}>{t('Print')}</Button>
                  <Button className="h-11 text-red-600" icon={<XCircle className="h-4 w-4" />} onClick={() => onCancel(o)}>{t('Cancel')}</Button>
                  {onDelete && (
                    <Button className="col-span-2 h-11 text-red-600 sm:col-span-4" variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => onDelete(o)}>
                      {t('Delete submitted order')}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Drawer>
  );
}
