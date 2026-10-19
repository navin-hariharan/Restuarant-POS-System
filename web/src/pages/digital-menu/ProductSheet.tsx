import clsx from 'clsx';
import { Check, Minus, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { makeCartItem, recalcItem, type CartItem, type CartModifier, type PosProduct, type TaxSetup } from '@/lib/cart';
import { Modal, Textarea } from '@/components/ui';
import { useConfig, useT } from '@/providers/AppProviders';

/** Old data sometimes stored the text "undefined" or "null" for an empty description. */
export function hasText(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '' && v !== 'undefined' && v !== 'null';
}

export function QtyStepper({
  value,
  onChange,
  min = 1,
  size = 'md',
  label,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  size?: 'sm' | 'md';
  label?: string;
}) {
  const t = useT();
  const btn = size === 'sm' ? 'h-9 w-9 pointer-coarse:h-10 pointer-coarse:w-10' : 'h-11 w-11';
  return (
    <div className="inline-flex items-center rounded-full border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900" role="group" aria-label={label ?? t('Quantity')}>
      <button
        type="button"
        className={clsx(btn, 'flex items-center justify-center rounded-full text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-800')}
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label={t('Decrease')}
      >
        <Minus className="h-4 w-4" />
      </button>
      <span className="min-w-[2ch] text-center font-semibold tabular-nums" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        className={clsx(btn, 'flex items-center justify-center rounded-full text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800')}
        onClick={() => onChange(value + 1)}
        aria-label={t('Increase')}
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

/** Build a cart line for a product/variant with picked modifiers, note and qty. */
export function buildLine(
  product: PosProduct,
  opts: { qty: number; modifiers: CartModifier[]; note: string; itemBasedTax: boolean; isReady: boolean; defaultTax: TaxSetup | null },
): CartItem {
  const line = makeCartItem(product, { isReady: opts.isReady, defaultTax: opts.defaultTax });
  line.qty = opts.qty;
  line.modifiers = opts.modifiers.map((m) => ({ ...m }));
  if (opts.note.trim()) line.note = opts.note.trim();
  return recalcItem(line, opts.itemBasedTax);
}

/** Bottom sheet (on phones) to pick a variant, modifiers, note and quantity. */
export function ProductSheet({
  product,
  onClose,
  onAdd,
  itemBasedTax,
  isReady,
  defaultTax,
}: {
  product: PosProduct | null;
  onClose: () => void;
  onAdd: (line: CartItem) => void;
  itemBasedTax: boolean;
  isReady: boolean;
  defaultTax: TaxSetup | null;
}) {
  const t = useT();
  const { money } = useConfig();
  const variants = product?.variants ?? [];
  const hasVariants = !!product?.has_variants && variants.length > 0;
  const [variantId, setVariantId] = useState<number | null>(null);
  const [mods, setMods] = useState<CartModifier[]>([]);
  const [note, setNote] = useState('');
  const [qty, setQty] = useState(1);

  const chosen: PosProduct | null = hasVariants ? variants.find((v) => v.id === variantId) ?? null : product;

  useEffect(() => {
    if (!product) return;
    setVariantId(hasVariants ? variants[0]?.id ?? null : null);
    setNote('');
    setQty(1);
    setMods((product.modifiers ?? []).map((m) => ({ ...m, qty: 1, is_checked: false })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.uuid]);

  const line = useMemo(
    () => (chosen ? buildLine(chosen, { qty, modifiers: mods, note, itemBasedTax, isReady, defaultTax }) : null),
    [chosen, qty, mods, note, itemBasedTax, isReady, defaultTax],
  );

  const toggleMod = (id: number) =>
    setMods((list) => list.map((m) => (m.id === id ? { ...m, is_checked: !m.is_checked, selected_at: !m.is_checked ? Date.now() : m.selected_at } : m)));
  const setModQty = (id: number, n: number) => setMods((list) => list.map((m) => (m.id === id ? { ...m, qty: n } : m)));

  return (
    <Modal
      open={!!product}
      onClose={onClose}
      size="md"
      title={product?.name}
      footer={
        <div className="flex w-full items-center gap-3">
          <QtyStepper value={qty} onChange={setQty} />
          <button
            type="button"
            className="btn-primary h-12 flex-1 text-base"
            disabled={!line}
            onClick={() => {
              if (line) onAdd(line);
            }}
          >
            {t('Add to Cart')}
            {line && <span className="tabular-nums opacity-90">· {money(line.sub_total)}</span>}
          </button>
        </div>
      }
    >
      {product && (
        <div className="space-y-5">
          {product.image && <img src={product.image} alt="" className="h-48 w-full rounded-xl object-cover sm:h-56" />}
          {hasText(product.description) && <p className="text-sm text-slate-600 dark:text-slate-300">{product.description}</p>}

          {hasVariants && (
            <fieldset>
              <legend className="mb-2 text-sm font-semibold">
                {t('Variants')} <span className="text-xs font-normal text-slate-500">· {t('Choose one')}</span>
              </legend>
              <div className="space-y-2">
                {variants.map((v) => (
                  <label
                    key={v.id}
                    className={clsx(
                      'flex min-h-[48px] cursor-pointer items-center justify-between gap-3 rounded-xl border-2 px-3 py-2 transition',
                      variantId === v.id ? 'border-brand-600 bg-brand-50 dark:bg-brand-950/40' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700',
                    )}
                  >
                    <span className="flex items-center gap-3">
                      <input type="radio" name="variant" className="h-4 w-4 accent-brand-600" checked={variantId === v.id} onChange={() => setVariantId(v.id)} />
                      <span className="font-medium">{v.name}</span>
                    </span>
                    <span className="tabular-nums text-sm font-semibold">{money(v.price)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {mods.length > 0 && (
            <fieldset>
              <legend className="mb-2 text-sm font-semibold">
                {t('Modifiers')} <span className="text-xs font-normal text-slate-500">· {t('Optional')}</span>
              </legend>
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
                {mods.map((m) => (
                  <div key={m.id} className="flex min-h-[52px] items-center justify-between gap-3 px-3 py-2">
                    <button type="button" className="flex flex-1 items-center gap-3 text-start" onClick={() => toggleMod(m.id)} role="checkbox" aria-checked={!!m.is_checked}>
                      <span
                        className={clsx(
                          'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2',
                          m.is_checked ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 dark:border-slate-600',
                        )}
                        aria-hidden="true"
                      >
                        {m.is_checked && <Check className="h-4 w-4" strokeWidth={3} />}
                      </span>
                      <span>
                        <span className="block text-sm font-medium">{m.title}</span>
                        <span className="block text-xs text-slate-500">+ {money(m.price)}</span>
                      </span>
                    </button>
                    {m.is_checked && <QtyStepper size="sm" value={Number(m.qty) || 1} onChange={(n) => setModQty(m.id, n)} label={m.title} />}
                  </div>
                ))}
              </div>
            </fieldset>
          )}

          <Textarea label={t('Special instructions')} placeholder={t('e.g. no onions, extra spicy')} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      )}
    </Modal>
  );
}
