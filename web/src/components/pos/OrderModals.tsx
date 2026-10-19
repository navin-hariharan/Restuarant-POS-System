import clsx from 'clsx';
import { Banknote, CreditCard, Delete } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { CartItem, TaxSetup } from '@/lib/cart';
import { Button, Checkbox, Input, Modal, Textarea } from '@/components/ui';
import { useConfig, useT } from '@/providers/AppProviders';
import type { PaymentMethod, Tax } from './types';

/* ------------------------------------------------------------- discount */

export function DiscountModal({
  open,
  onClose,
  rate,
  inPercent,
  subtotal,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  rate: number | string;
  inPercent: boolean;
  subtotal: number;
  onApply: (rate: number, inPercent: boolean) => void;
}) {
  const t = useT();
  const { money } = useConfig();
  const [value, setValue] = useState(String(rate ?? 0));
  const [pct, setPct] = useState(inPercent);
  useEffect(() => {
    if (open) {
      setValue(String(Number(rate) || 0));
      setPct(inPercent);
    }
  }, [open, rate, inPercent]);
  const n = Math.max(0, Number(value) || 0);
  const amount = pct ? (n / 100) * subtotal : n;
  const invalid = (pct && n > 100) || (!pct && n > subtotal);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('Discount')}
      size="sm"
      footer={
        <>
          <Button onClick={() => { onApply(0, pct); onClose(); }}>{t('Remove')}</Button>
          <Button variant="primary" disabled={invalid} onClick={() => { onApply(n, pct); onClose(); }}>{t('Apply')}</Button>
        </>
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800" role="radiogroup" aria-label={t('Discount type')}>
        {[
          { v: true, label: t('In percentage') },
          { v: false, label: t('Solid amount') },
        ].map((o) => (
          <button
            key={String(o.v)}
            type="button"
            role="radio"
            aria-checked={pct === o.v}
            onClick={() => setPct(o.v)}
            className={clsx('h-10 rounded-md text-sm font-medium', pct === o.v ? 'bg-white shadow-xs dark:bg-slate-900' : 'text-slate-600 dark:text-slate-400')}
          >
            {o.label}
          </button>
        ))}
      </div>
      <Input
        label={t('Discount rate')}
        type="number"
        inputMode="decimal"
        min={0}
        step="0.01"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-12 text-lg"
        error={invalid ? t('Discount can not exceed the order amount') : undefined}
      />
      {pct && (
        <div className="mt-3 flex flex-wrap gap-2">
          {[5, 10, 15, 20, 25, 50].map((p) => (
            <button key={p} type="button" className="btn-secondary h-11 min-w-14" onClick={() => setValue(String(p))}>
              {p}%
            </button>
          ))}
        </div>
      )}
      <p className="mt-4 flex justify-between text-sm">
        <span className="text-slate-500">{t('Discount')}</span>
        <span className="font-semibold tabular-nums">- {money(amount)}</span>
      </p>
    </Modal>
  );
}

/* ------------------------------------------------------------ order tax */

export function TaxModal({
  open,
  onClose,
  taxes,
  value,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  taxes: Tax[];
  value: TaxSetup;
  onApply: (tax: TaxSetup) => void;
}) {
  const t = useT();
  const currentId = (value as any)?.id;
  return (
    <Modal open={open} onClose={onClose} title={t('Tax')} size="md">
      <div className="grid gap-2">
        {taxes.map((x) => {
          const rate = x.tax_rate ?? x.rate;
          const desc = [
            x.is_tax_fix ? `${rate} ${t('fix')}` : `${rate}%`,
            x.is_vat ? t('VAT') : null,
            x.is_tax_included ? t('Included') : t('Excluded'),
          ].filter(Boolean).join(' · ');
          return (
            <button
              key={x.id}
              type="button"
              onClick={() => { onApply(x); onClose(); }}
              className={clsx(
                'flex min-h-[52px] items-center justify-between rounded-xl border px-4 text-start',
                currentId === x.id ? 'border-brand-500 bg-brand-50 dark:bg-brand-950' : 'border-slate-200 hover:border-brand-400 dark:border-slate-700',
              )}
            >
              <span className="font-medium">{x.tax_title}</span>
              <span className="text-xs text-slate-500">{desc}</span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- notes */

export function NotesModal({
  open,
  onClose,
  chefNote,
  staffNote,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  chefNote: string;
  staffNote: string;
  onApply: (chef: string, staff: string) => void;
}) {
  const t = useT();
  const [chef, setChef] = useState(chefNote);
  const [staff, setStaff] = useState(staffNote);
  useEffect(() => {
    if (open) {
      setChef(chefNote);
      setStaff(staffNote);
    }
  }, [open, chefNote, staffNote]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('Notes')}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="primary" onClick={() => { onApply(chef, staff); onClose(); }}>{t('Save')}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Textarea label={t('kitchen note')} help={t('Visible on the kitchen display')} value={chef} onChange={(e) => setChef(e.target.value)} />
        <Textarea label={t('Staff note')} help={t('Staff note for internal use')} value={staff} onChange={(e) => setStaff(e.target.value)} />
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- split */

export function SplitModal({
  open,
  onClose,
  items,
  onSplit,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  items: CartItem[];
  onSplit: (cartUuids: string[]) => void;
  loading?: boolean;
}) {
  const t = useT();
  const { money } = useConfig();
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => {
    if (open) setPicked([]);
  }, [open]);
  const valid = picked.length > 0 && picked.length < items.length;
  const splitTotal = items.filter((i) => picked.includes(i.cart_uuid)).reduce((s, i) => s + Number(i.sub_total || 0), 0);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('Split Pay')}
      description={t('Pick the items to move into a new order. The rest stays on this order.')}
      size="lg"
      footer={
        <>
          <span className="me-auto text-sm text-slate-500">
            {t('New order')}: <strong className="tabular-nums text-slate-900 dark:text-white">{money(splitTotal)}</strong>
          </span>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="primary" disabled={!valid} loading={loading} onClick={() => onSplit(picked)}>
            {t('Split order')}
          </Button>
        </>
      }
    >
      <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
        {items.map((i) => (
          <li key={i.cart_uuid} className="flex min-h-[52px] items-center gap-3 px-3">
            <Checkbox
              className="flex-1 py-2"
              checked={picked.includes(i.cart_uuid)}
              onChange={(v) => setPicked((p) => (v ? [...p, i.cart_uuid] : p.filter((x) => x !== i.cart_uuid)))}
              label={
                <span>
                  <span className="font-medium">{i.qty} × {i.name}</span>
                </span>
              }
            />
            <span className="text-sm tabular-nums">{money(i.sub_total)}</span>
          </li>
        ))}
      </ul>
      {picked.length > 0 && !valid && (
        <p className="mt-3 text-sm text-amber-600">{t('Exclude or uncheck at least one item for current order')}</p>
      )}
    </Modal>
  );
}

/* --------------------------------------------------------------- cancel */

export function CancelOrderModal({
  open,
  onClose,
  tracking,
  onConfirm,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  tracking?: string | null;
  onConfirm: (reason: string) => void;
  loading?: boolean;
}) {
  const t = useT();
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) setReason('');
  }, [open]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${t('Cancelling order')}${tracking ? ` #${tracking}` : ''}`}
      footer={
        <>
          <Button onClick={onClose}>{t('Back')}</Button>
          <Button variant="danger" disabled={!reason.trim()} loading={loading} onClick={() => onConfirm(reason.trim())}>
            {t('Cancel order')}
          </Button>
        </>
      }
    >
      <Textarea
        label={t('Make sure it will not be able to undone, What is the reason behind cancelling order?')}
        required
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
    </Modal>
  );
}

/* ------------------------------------------------------------- checkout */

export type CheckoutValues = {
  payment_method_id: number;
  recipient_amount: number;
  tip_amount: number;
  payment_note: string;
  staff_note: string;
};

function quickAmounts(total: number): number[] {
  const out = new Set<number>();
  for (const step of [1, 5, 10, 20, 50, 100, 500, 1000]) {
    const v = Math.ceil(total / step) * step;
    if (v > total + 0.0001) out.add(v);
    if (out.size >= 3) break;
  }
  return [...out].sort((a, b) => a - b);
}

export function CheckoutModal({
  open,
  onClose,
  tracking,
  total,
  tipEnabled,
  initialTip,
  methods,
  initialMethodId,
  initialPaymentNote,
  initialStaffNote,
  loading,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  tracking?: string | null;
  /** Payable after discount and tax, before tip. */
  total: number;
  tipEnabled: boolean;
  initialTip: number;
  methods: PaymentMethod[];
  initialMethodId?: number | null;
  initialPaymentNote?: string;
  initialStaffNote?: string;
  loading?: boolean;
  onConfirm: (v: CheckoutValues) => void;
}) {
  const t = useT();
  const { money } = useConfig();
  const [method, setMethod] = useState<number | null>(null);
  const [tip, setTip] = useState('0');
  const [received, setReceived] = useState('0');
  const [touched, setTouched] = useState(false);
  const [paymentNote, setPaymentNote] = useState('');
  const [staffNote, setStaffNote] = useState('');

  useEffect(() => {
    if (!open) return;
    setMethod(initialMethodId && methods.some((m) => m.id === initialMethodId) ? initialMethodId : methods[0]?.id ?? null);
    setTip(String(Number(initialTip) || 0));
    setReceived(String(Math.round((total + (Number(initialTip) || 0)) * 100) / 100));
    setTouched(false);
    setPaymentNote(initialPaymentNote ?? '');
    setStaffNote(initialStaffNote ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const tipN = tipEnabled ? Math.max(0, Number(tip) || 0) : 0;
  const withTip = total + tipN;
  // Like the old UI, the received amount follows the payable until the cashier types one.
  useEffect(() => {
    if (open && !touched) setReceived(String(Math.round(withTip * 100) / 100));
  }, [withTip, open, touched]);
  const receivedN = Number(received) || 0;
  const change = receivedN - withTip;
  const quick = useMemo(() => quickAmounts(withTip), [withTip]);

  const type = (key: string) => {
    setTouched(true);
    setReceived((r) => {
      const cur = touched ? r : '0';
      if (key === 'C') return '0';
      if (key === '⌫') return cur.length > 1 ? cur.slice(0, -1) : '0';
      if (key === '.') return cur.includes('.') ? cur : `${cur}.`;
      return cur === '0' ? key : `${cur}${key}`;
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={`${t('Payment')}${tracking ? ` · #${tracking}` : ''}`}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button
            variant="success"
            size="lg"
            loading={loading}
            disabled={!method}
            onClick={() =>
              method &&
              onConfirm({ payment_method_id: method, recipient_amount: receivedN, tip_amount: tipN, payment_note: paymentNote, staff_note: staffNote })
            }
          >
            {t('Complete payment')} · {money(withTip)}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-4">
          <div>
            <p className="label">{t('Payment method')}</p>
            <div className="grid grid-cols-2 gap-2">
              {methods.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={method === m.id}
                  onClick={() => setMethod(m.id)}
                  className={clsx(
                    'flex min-h-[52px] items-center gap-2 rounded-xl border px-3 text-start text-sm font-medium',
                    method === m.id ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500/30 dark:bg-brand-950' : 'border-slate-200 hover:border-brand-400 dark:border-slate-700',
                  )}
                >
                  {/cash/i.test(m.title) ? <Banknote className="h-5 w-5 text-emerald-600" /> : <CreditCard className="h-5 w-5 text-brand-600" />}
                  {m.title}
                </button>
              ))}
            </div>
          </div>

          <dl className="space-y-1.5 rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-800/60">
            <div className="flex justify-between"><dt className="text-slate-500">{t('Payable')}</dt><dd className="tabular-nums">{money(total)}</dd></div>
            {tipEnabled && <div className="flex justify-between"><dt className="text-slate-500">{t('Tip')}</dt><dd className="tabular-nums">+ {money(tipN)}</dd></div>}
            <div className="flex justify-between text-lg font-semibold"><dt>{t('Total')}</dt><dd className="tabular-nums">{money(withTip)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">{t('Received')}</dt><dd className="tabular-nums">{money(receivedN)}</dd></div>
            <div className={clsx('flex justify-between text-base font-semibold', change < 0 ? 'text-red-600' : 'text-emerald-600')}>
              <dt>{change < 0 ? t('Due') : t('Change')}</dt>
              <dd className="tabular-nums">{money(Math.abs(change))}</dd>
            </div>
          </dl>

          {tipEnabled && (
            <div>
              <Input label={t('Tip')} type="number" inputMode="decimal" min={0} step="0.01" value={tip} onChange={(e) => setTip(e.target.value)} />
              <div className="mt-2 flex flex-wrap gap-2">
                {[0, 5, 10, 15, 20].map((p) => (
                  <button key={p} type="button" className="btn-secondary h-10 min-w-14" onClick={() => setTip(String(Math.round(total * p) / 100))}>
                    {p ? `${p}%` : t('None')}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <Input
            label={t('Received amount')}
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            className="h-12 text-right text-xl font-semibold tabular-nums"
            value={received}
            onChange={(e) => { setTouched(true); setReceived(e.target.value); }}
          />
          <div className="grid grid-cols-4 gap-2">
            <button type="button" className="btn-secondary h-12" onClick={() => { setTouched(true); setReceived(String(Math.round(withTip * 100) / 100)); }}>
              {t('Exact')}
            </button>
            {quick.map((q) => (
              <button key={q} type="button" className="btn-secondary h-12 tabular-nums" onClick={() => { setTouched(true); setReceived(String(q)); }}>
                {money(q)}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2" aria-label={t('Keypad')}>
            {['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '⌫'].map((k) => (
              <button key={k} type="button" className="btn-secondary h-14 text-lg font-semibold" onClick={() => type(k)} aria-label={k === '⌫' ? t('Backspace') : k}>
                {k === '⌫' ? <Delete className="h-5 w-5" /> : k}
              </button>
            ))}
            <button type="button" className="btn-ghost col-span-3 h-10" onClick={() => type('C')}>{t('Clear')}</button>
          </div>
          <Textarea label={t('Payment note')} rows={2} help={t('Payment note for internal use')} value={paymentNote} onChange={(e) => setPaymentNote(e.target.value)} />
          <Textarea label={t('Staff note')} rows={2} value={staffNote} onChange={(e) => setStaffNote(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

