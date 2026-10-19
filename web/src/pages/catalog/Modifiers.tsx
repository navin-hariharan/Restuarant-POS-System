import { useState } from 'react';
import { CrudPage, FieldRenderer, type FieldDef } from '@/components/crud/CrudPage';
import { useAuth, useConfig, useT } from '@/providers/AppProviders';
import { Select } from '@/components/ui';
import { IngredientsEditor, consumptionPayload, toConsumption } from '@/components/catalog/IngredientsEditor';
import { useList } from '@/components/catalog/shared';

type ModifierRow = {
  id: number;
  title: string;
  price: number;
  cost: number;
  category: { id: number; name: string } | null;
  created_at: string;
};

const fields: FieldDef[] = [
  { name: 'title', label: 'Title', required: true, full: true },
  { name: 'food_category_id', label: 'Category', type: 'select', required: true, optionsUrl: 'admin/food-categories', full: true },
  { name: 'price', label: 'Price', type: 'number', required: true },
  { name: 'cost', label: 'Cost', type: 'number', required: true },
];

export default function Modifiers() {
  const t = useT();
  const { money, config } = useConfig();
  const { can } = useAuth();
  const [category, setCategory] = useState('');
  const categories = useList<{ id: number; name: string }>('admin/food-categories');
  const allowed = can('manage_modifiers');

  return (
    <CrudPage<ModifierRow>
      title="Modifiers"
      singular="Modifier"
      description="Extras and add-ons offered with every item of a food category."
      url="admin/modifiers"
      bulkDeleteUrl="admin/modifiers-rows-destroy"
      permission="manage_modifiers"
      canCreate={allowed}
      canEdit={allowed}
      canDelete={allowed}
      drawerWidth="max-w-2xl"
      showUrl={(r) => `admin/modifiers/${r.id}`}
      filterValues={{ category: category || undefined }}
      filters={
        <Select
          aria-label={t('Category')}
          wrapperClassName="w-full sm:w-56"
          options={categories.items.map((c) => ({ value: c.id, label: c.name }))}
          placeholder={t('All categories')}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        />
      }
      fields={[...fields, { name: 'ingredients', label: 'Ingredients', defaultValue: [] }]}
      toForm={(r) => ({
        id: r.id,
        title: r.title ?? '',
        food_category_id: r.food_category_id ?? r.category?.id ?? '',
        price: r.price ?? '',
        cost: r.cost ?? '',
        ingredients: (r.ingredients ?? []).map(toConsumption),
      })}
      toPayload={(v) => ({
        id: v.id,
        title: v.title,
        food_category_id: v.food_category_id,
        price: v.price,
        cost: v.cost,
        ingredients: consumptionPayload(v.ingredients ?? []),
      })}
      renderForm={({ values, setValue, errors, current }) => (
        <>
          {fields.map((f) => (
            <div key={f.name} className={f.full ? 'sm:col-span-2' : ''}>
              <FieldRenderer field={f} values={values} setValue={setValue} errors={errors} current={current} />
            </div>
          ))}
          {config.modes.item_consumption_mode && (
            <div className="sm:col-span-2">
              <IngredientsEditor
                label={t('Ingredients Consumption')}
                description={t('Ingredients deducted from stock every time this modifier is sold.')}
                value={values.ingredients ?? []}
                onChange={(rows) => setValue('ingredients', rows)}
                error={errors.ingredients}
              />
            </div>
          )}
        </>
      )}
      columns={[
        { key: 'title', header: t('Title'), sortKey: 'title', cell: (r) => <span className="font-medium">{r.title}</span> },
        { key: 'category', header: t('Category'), sortKey: 'food_category_id', cell: (r) => r.category?.name ?? <span className="text-slate-400">—</span> },
        { key: 'price', header: t('Price'), sortKey: 'price', className: 'text-end tabular-nums', headerClassName: 'text-end', cell: (r) => money(r.price) },
        {
          key: 'cost',
          header: t('Cost'),
          sortKey: 'cost',
          className: 'text-end tabular-nums text-slate-600 dark:text-slate-400',
          headerClassName: 'text-end',
          cell: (r) => money(r.cost),
        },
        { key: 'created_at', header: t('Created at'), sortKey: 'created_at', className: 'whitespace-nowrap text-slate-500' },
      ]}
    />
  );
}
