import { CrudPage } from '@/components/crud/CrudPage';
import { useAuth, useConfig, useT } from '@/providers/AppProviders';
import { Badge } from '@/components/ui';
import { formatNumber } from '@/lib/format';

type IngredientRow = {
  id: number;
  name: string;
  price: number;
  cost: number;
  unit: string;
  alert_quantity: number | string;
  quantity: number | string;
  /** Backend naming is inverted: true means the ingredient is NOT used and can be deleted. */
  is_being_used: boolean;
  created_at: string;
};

export default function Ingredients() {
  const t = useT();
  const { money } = useConfig();
  const { can } = useAuth();
  const allowed = can('manage_ingredients');
  const isLow = (r: IngredientRow) => Number(r.quantity) < Number(r.alert_quantity);

  return (
    <CrudPage<IngredientRow>
      title="Ingredients"
      singular="Ingredient"
      description="Stock items consumed by food items and modifiers. Ingredients that are in use cannot be deleted."
      url="admin/ingredients"
      bulkDeleteUrl="admin/ingredients-rows-destroy"
      permission="manage_ingredients"
      canCreate={allowed}
      canEdit={allowed}
      canDelete={allowed}
      fields={[
        { name: 'name', label: 'Name', required: true },
        { name: 'unit', label: 'Unit', required: true, placeholder: 'kg, ltr, pcs…' },
        { name: 'price', label: 'Price', type: 'number', required: true, help: 'Price must be equal or greater then cost' },
        { name: 'cost', label: 'Cost', type: 'number', required: true },
        { name: 'quantity', label: 'Quantity', type: 'number', required: true, help: 'Current stock quantity' },
        { name: 'alert_quantity', label: 'Alert Quantity', type: 'number', required: true, help: 'Show a stock alert below this quantity' },
      ]}
      columns={[
        { key: 'name', header: t('Name'), sortKey: 'name', cell: (r) => <span className="font-medium">{r.name}</span> },
        { key: 'unit', header: t('Unit'), sortKey: 'unit', className: 'text-slate-600 dark:text-slate-400' },
        { key: 'price', header: t('Price'), sortKey: 'price', className: 'text-end tabular-nums', headerClassName: 'text-end', cell: (r) => money(r.price) },
        {
          key: 'cost',
          header: t('Cost'),
          sortKey: 'cost',
          className: 'text-end tabular-nums text-slate-600 dark:text-slate-400',
          headerClassName: 'text-end',
          cell: (r) => money(r.cost),
        },
        {
          key: 'quantity',
          header: t('Quantity'),
          sortKey: 'quantity',
          className: 'text-end tabular-nums',
          headerClassName: 'text-end',
          cell: (r) => (
            <span className={isLow(r) ? 'font-semibold text-red-600' : ''}>
              {formatNumber(r.quantity)} <span className="text-xs font-normal text-slate-500">{r.unit}</span>
            </span>
          ),
        },
        {
          key: 'alert_quantity',
          header: t('Alert Quantity'),
          sortKey: 'alert_quantity',
          className: 'text-end tabular-nums text-slate-600 dark:text-slate-400',
          headerClassName: 'text-end',
          cell: (r) => formatNumber(r.alert_quantity),
        },
        {
          key: 'status',
          header: t('Status'),
          cell: (r) => (
            <div className="flex flex-wrap gap-1">
              {isLow(r) ? <Badge tone="red">{t('Low stock')}</Badge> : <Badge tone="green">{t('In stock')}</Badge>}
              {r.is_being_used && <Badge tone="blue">{t('In use')}</Badge>}
            </div>
          ),
        },
      ]}
    />
  );
}
