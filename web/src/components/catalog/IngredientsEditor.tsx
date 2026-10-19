import { FlaskConical, Trash2 } from 'lucide-react';
import { useId } from 'react';
import { useConfig, useT } from '@/providers/AppProviders';
import { useList } from './shared';

export type Consumption = {
  id: number;
  name: string;
  unit?: string | null;
  cost?: number | string | null;
  quantity_using: number | string;
};

type Ingredient = { id: number; name: string; unit: string; cost: number; price: number; quantity: number; alert_quantity: number | string };

/** Map an API ingredient (IngredientWithPivotResource) to an editor row. */
export const toConsumption = (r: any): Consumption => ({
  id: r.id,
  name: r.name,
  unit: r.unit,
  cost: r.cost,
  quantity_using: r.quantity_using ?? 1,
});

/** Shape the backend expects ({id, quantity_using}). */
export const consumptionPayload = (rows: Consumption[]) =>
  rows.filter((r) => r.id).map((r) => ({ id: Number(r.id), quantity_using: Number(r.quantity_using) || 0 }));

/**
 * Ingredient consumption editor: which ingredients (and how much of each) are
 * deducted from stock when one unit is sold. Used by food items, variants and modifiers.
 */
export function IngredientsEditor({
  value,
  onChange,
  label,
  description,
  error,
  compact,
}: {
  value: Consumption[];
  onChange: (rows: Consumption[]) => void;
  label?: string;
  description?: string;
  error?: string;
  compact?: boolean;
}) {
  const t = useT();
  const { money } = useConfig();
  const selectId = useId();
  const list = useList<Ingredient>('admin/food-ingredients');
  const used = new Set(value.map((v) => Number(v.id)));
  const available = list.items.filter((i) => !used.has(Number(i.id)));
  const byId = new Map(list.items.map((i) => [Number(i.id), i]));
  const totalCost = value.reduce((sum, r) => {
    const c = Number(r.cost ?? byId.get(Number(r.id))?.cost ?? 0);
    return sum + c * (Number(r.quantity_using) || 0);
  }, 0);

  const update = (idx: number, patch: Partial<Consumption>) => onChange(value.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  return (
    <div className={compact ? '' : 'rounded-lg border border-slate-200 p-3 dark:border-slate-800'}>
      {(label || description) && (
        <div className="mb-2">
          {label && (
            <label htmlFor={selectId} className="label mb-0 flex items-center gap-1.5">
              <FlaskConical className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              {label}
            </label>
          )}
          {description && <p className="help mt-0.5">{description}</p>}
        </div>
      )}
      {value.length > 0 && (
        <ul className="mb-2 divide-y divide-slate-100 rounded-md border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {value.map((row, idx) => {
            const meta = byId.get(Number(row.id));
            const unit = row.unit ?? meta?.unit ?? '';
            return (
              <li key={row.id} className="flex items-center gap-2 px-2 py-1.5">
                <span className="min-w-0 flex-1 truncate text-sm">
                  {row.name ?? meta?.name}
                  {meta && Number(meta.quantity) < Number(meta.alert_quantity) && (
                    <span className="ms-2 text-xs text-amber-600">{t('Low stock')}</span>
                  )}
                </span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    required
                    className="input w-24 py-1 text-end tabular-nums"
                    aria-label={`${t('Quantity')} — ${row.name}`}
                    value={row.quantity_using}
                    onChange={(e) => update(idx, { quantity_using: e.target.value })}
                  />
                  <span className="w-12 truncate text-xs text-slate-500" title={unit}>
                    {unit}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn-ghost btn-sm text-red-600"
                  onClick={() => onChange(value.filter((_, i) => i !== idx))}
                  aria-label={`${t('Remove')} ${row.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <select
          id={selectId}
          className="input w-full py-1.5 sm:w-64"
          value=""
          disabled={list.isLoading || !available.length}
          onChange={(e) => {
            const ing = byId.get(Number(e.target.value));
            if (ing) onChange([...value, { id: ing.id, name: ing.name, unit: ing.unit, cost: ing.cost, quantity_using: 1 }]);
          }}
        >
          <option value="">
            {list.isLoading ? t('Loading...') : available.length ? `+ ${t('Add ingredient')}` : t('No more ingredients')}
          </option>
          {available.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} ({i.unit})
            </option>
          ))}
        </select>
        {value.length > 0 && (
          <span className="text-xs text-slate-500">
            {t('Ingredient cost')}: <span className="font-medium tabular-nums text-slate-700 dark:text-slate-300">{money(totalCost)}</span>
          </span>
        )}
      </div>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
