import clsx from 'clsx';
import { Check, Minus, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { CartItem, CartModifier, PosProduct, TaxSetup } from '@/lib/cart';
import { Button, Checkbox, Input, Modal, SearchInput, Select, Tabs, Textarea } from '@/components/ui';
import { useConfig, useT } from '@/providers/AppProviders';
import type { Tax } from './types';

/* ------------------------------------------------------------- stepper */

export function Stepper({
  value,
  onChange,
  min = 0,
  size = 'md',
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  size?: 'sm' | 'md';
  label: string;
}) {
  const t = useT();
  const btn = size === 'sm' ? 'h-9 w-9 pointer-coarse:h-10 pointer-coarse:w-10' : 'h-11 w-11';
  return (
    <div className="inline-flex items-center rounded-lg border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900" role="group" aria-label={label}>
      <button type="button" className={clsx(btn, 'flex items-center justify-center rounded-s-lg hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-800')} onClick={() => onChange(value - 1)} disabled={value <= min} aria-label={t('Decrease')}>
        <Minus className="h-4 w-4" />
      </button>
      <span className="min-w-9 text-center text-sm font-semibold tabular-nums" aria-live="polite">
        {value}
      </span>
      <button type="button" className={clsx(btn, 'flex items-center justify-center rounded-e-lg hover:bg-slate-100 dark:hover:bg-slate-800')} onClick={() => onChange(value + 1)} aria-label={t('Increase')}>
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------- variant picker */

export function VariantPicker({
  product,
  onClose,
  onAdd,
  qtyInCart,
}: {
  product: PosProduct | null;
  onClose: () => void;
  onAdd: (v: PosProduct) => void;
  qtyInCart: (uuid: string) => number;
}) {
  const t = useT();
  const { money } = useConfig();
  return (
    <Modal
      open={!!product}
      onClose={onClose}
      title={product?.name}
      description={t('Select a variant')}
      size="lg"
      footer={<Button variant="primary" size="lg" onClick={onClose}>{t('Done')}</Button>}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {(product?.variants ?? []).map((v) => {
          const qty = qtyInCart(v.uuid);
          return (
            <button
              key={v.uuid}
              type="button"
              onClick={() => onAdd(v)}
              className={clsx(
                'relative flex min-h-20 flex-col items-start justify-between gap-2 rounded-xl border p-3 text-start transition active:scale-[0.98]',
                qty ? 'border-brand-500 bg-brand-50 dark:bg-brand-950' : 'border-slate-200 hover:border-brand-400 dark:border-slate-700',
              )}
            >
              <span className="text-sm font-medium">{v.name}</span>
              <span className="text-sm font-semibold tabular-nums text-brand-700 dark:text-brand-300">{money(v.price)}</span>
              {qty > 0 && (
                <span className="absolute inset-e-2 top-2 rounded-full bg-brand-600 px-2 py-0.5 text-xs font-semibold text-white">×{qty}</span>
              )}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------- line editor */

export type LineEditorTab = 'details' | 'modifiers';

export function LineEditor({
  item,
  initialTab,
  onClose,
  onSave,
  itemBasedTax,
  taxation,
  bypassKitchen,
  taxes,
}: {
  item: CartItem | null;
  initialTab: LineEditorTab;
  onClose: () => void;
  onSave: (item: CartItem) => void;
  itemBasedTax: boolean;
  taxation: boolean;
  bypassKitchen: boolean;
  taxes: Tax[];
}) {
  const t = useT();
  const { money } = useConfig();
  const [draft, setDraft] = useState<CartItem | null>(item);
  const [tab, setTab] = useState<LineEditorTab>(initialTab);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setDraft(item ? { ...item, modifiers: (item.modifiers ?? []).map((m) => ({ ...m })) } : null);
    setTab(initialTab);
    setSearch('');
  }, [item, initialTab]);

  const modifiers = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (draft?.modifiers ?? []).filter((m) => !s || String(m.title).toLowerCase().includes(s));
  }, [draft, search]);

  if (!draft) return null;
  const set = (patch: Partial<CartItem>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const setMod = (id: number, patch: Partial<CartModifier>) =>
    setDraft((d) => (d ? { ...d, modifiers: d.modifiers.map((m) => (m.id === id ? { ...m, ...patch } : m)) } : d));
  const toggleMod = (m: CartModifier) =>
    setMod(m.id, m.is_checked ? { is_checked: false } : { is_checked: true, selected_at: Date.now(), qty: Math.max(1, Number(m.qty) || 1) });

  const hasModifiers = (draft.modifiers?.length ?? 0) > 0;
  const checkedCount = draft.modifiers?.filter((m) => m.is_checked).length ?? 0;

  const save = () => {
    const qty = Math.max(1, Math.floor(Number(draft.qty) || 1));
    onSave({ ...draft, qty, price: Number(draft.price) || 0 });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={item?.name}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="primary" onClick={save}>
            {t('Apply')}
          </Button>
        </>
      }
    >
      {hasModifiers && (
        <Tabs
          className="mb-4"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'details', label: t('Details') },
            { value: 'modifiers', label: t('Modifiers'), count: checkedCount },
          ]}
        />
      )}

      {tab === 'details' || !hasModifiers ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label={t('Food item name')} value={draft.name} onChange={(e) => set({ name: e.target.value })} wrapperClassName="sm:col-span-2" />
          <Input label={t('Price per unit')} type="number" inputMode="decimal" min={0} step="0.01" value={draft.price} onChange={(e) => set({ price: e.target.value })} />
          <div>
            <span className="label">{t('Quantity')}</span>
            <Stepper value={Number(draft.qty) || 1} min={1} onChange={(qty) => set({ qty })} label={t('Quantity')} />
          </div>
          {itemBasedTax && taxation && (
            <Select
              label={t('Tax method')}
              wrapperClassName="sm:col-span-2"
              value={draft.tax_id ?? ''}
              options={taxes.map((x) => ({ value: x.id, label: x.tax_title }))}
              placeholder={t('Select an option')}
              onChange={(e) => {
                const tax = taxes.find((x) => String(x.id) === e.target.value);
                set({ tax_id: tax?.id ?? null, tax_setup: (tax ?? {}) as TaxSetup });
              }}
            />
          )}
          <Textarea
            label={t('Spacific note or instructions')}
            wrapperClassName="sm:col-span-2"
            rows={2}
            value={draft.note ?? ''}
            onChange={(e) => set({ note: e.target.value })}
            placeholder={t('e.g. no onions, extra spicy')}
          />
          {!bypassKitchen && (
            <div className="flex flex-col gap-3 sm:col-span-2">
              <Checkbox checked={!!draft.is_ready} onChange={(v) => set({ is_ready: v, not_display: v ? draft.not_display : false })} label={t('Mark as ready')} />
              {draft.is_ready && (
                <Checkbox checked={!!draft.not_display} onChange={(v) => set({ not_display: v })} label={t('Dont send to kitchen')} />
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <SearchInput value={search} onChange={setSearch} placeholder={t('Search modifiers')} />
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {modifiers.map((m) => (
              <li key={m.id} className={clsx('flex items-center gap-3 px-3 py-2', m.is_checked && 'bg-brand-50/60 dark:bg-brand-950/40')}>
                <button
                  type="button"
                  onClick={() => toggleMod(m)}
                  aria-pressed={!!m.is_checked}
                  className="flex min-h-[44px] flex-1 items-center gap-3 text-start"
                >
                  <span
                    className={clsx(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border',
                      m.is_checked ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 dark:border-slate-600',
                    )}
                  >
                    {m.is_checked && <Check className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{m.title}</span>
                    <span className="text-xs tabular-nums text-slate-500">+ {money(m.price)}</span>
                  </span>
                </button>
                {m.is_checked && (
                  <Stepper size="sm" value={Number(m.qty) || 1} min={1} onChange={(qty) => setMod(m.id, { qty })} label={`${m.title} ${t('Quantity')}`} />
                )}
              </li>
            ))}
            {!modifiers.length && <li className="px-3 py-6 text-center text-sm text-slate-500">{t('No data found')}</li>}
          </ul>
        </div>
      )}
    </Modal>
  );
}
