import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, ChevronDown, FlaskConical, Layers, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api, fieldErrors, multipartUpdate, toFormData } from '@/lib/api';
import { useAuth, useConfig, useT } from '@/providers/AppProviders';
import { Badge, Button, Card, ImageInput, Input, PageHeader, Select, Skeleton, Switch, Textarea } from '@/components/ui';
import { IngredientsEditor, consumptionPayload, toConsumption, type Consumption } from '@/components/catalog/IngredientsEditor';
import { num, useList } from '@/components/catalog/shared';

type VariantForm = {
  key: string;
  id: number | null;
  name: string;
  sku: string;
  price: string | number;
  cost: string | number;
  ingredients: Consumption[];
};

type FormState = {
  name: string;
  food_category_id: string | number;
  description: string;
  price: string | number;
  cost: string | number;
  sku: string;
  tax_id: string | number;
  is_bar_type: boolean;
  has_variants: boolean;
  expiry_date: string;
  ingredients: Consumption[];
  variants: VariantForm[];
};

const blank: FormState = {
  name: '',
  food_category_id: '',
  description: '',
  price: '',
  cost: '',
  sku: '',
  tax_id: '',
  is_bar_type: false,
  has_variants: false,
  expiry_date: '',
  ingredients: [],
  variants: [],
};

let keySeq = 0;
const newKey = () => `v${++keySeq}`;
const emptyVariant = (): VariantForm => ({ key: newKey(), id: null, name: '', sku: '', price: '', cost: '', ingredients: [] });
const nullish = (v: unknown) => v === null || v === undefined || v === 'null' || v === 'undefined';

export default function ProductForm() {
  const t = useT();
  const { uuid } = useParams();
  const editing = !!uuid;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { config, money } = useConfig();
  const { can } = useAuth();
  const consumption = config.modes.item_consumption_mode;

  const [form, setForm] = useState<FormState>(blank);
  const [image, setImage] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [originalVariantIds, setOriginalVariantIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [openVariant, setOpenVariant] = useState<string | null>(null);

  const record = useQuery({
    queryKey: ['admin/food-items', uuid, 'detail'],
    queryFn: async () => (await api.get(`admin/food-items/${uuid}`)).data,
    enabled: editing,
    staleTime: 0,
    gcTime: 0,
  });
  const categories = useList<{ id: number; name: string }>('admin/food-categories');
  const taxes = useList<{ id: number; tax_title: string; tax_rate: number; is_tax_fix: boolean }>('admin/taxes');
  const modifiers = useList<{ id: number; title: string; price: number }>('admin/modifiers', {
    enabled: !!form.food_category_id && can('manage_modifiers'),
    params: { category: form.food_category_id },
  });

  useEffect(() => {
    const r = record.data;
    if (!r) return;
    const variants: VariantForm[] = (r.variants ?? []).map((v: any) => ({
      key: newKey(),
      id: v.id,
      name: v.name ?? '',
      sku: v.sku ?? '',
      price: v.price ?? '',
      cost: v.cost ?? '',
      ingredients: (v.ingredients ?? []).map(toConsumption),
    }));
    setForm({
      name: r.name ?? '',
      food_category_id: r.category?.id ?? '',
      description: r.description && r.description !== 'undefined' && r.description !== 'null' ? r.description : '',
      price: r.price ?? '',
      cost: r.cost ?? '',
      sku: r.sku ?? '',
      tax_id: nullish(r.tax_id) ? '' : r.tax_id,
      is_bar_type: !!r.is_bar_type,
      has_variants: !!r.has_variants,
      expiry_date: nullish(r.expiry_date) ? '' : String(r.expiry_date).slice(0, 10),
      // For items with variants the item-level list mixes every variant's pivot rows; ignore it.
      ingredients: r.has_variants ? [] : (r.ingredients ?? []).map(toConsumption),
      variants,
    });
    setOriginalVariantIds(variants.map((v) => v.id!).filter(Boolean));
  }, [record.data]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k as string]) setErrors(({ [k as string]: _, ...rest }) => rest);
  };
  const setVariant = (key: string, patch: Partial<VariantForm>) =>
    setForm((f) => ({ ...f, variants: f.variants.map((v) => (v.key === key ? { ...v, ...patch } : v)) }));

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = t('The name field is required.');
    if (Number.isNaN(num(form.price))) e.price = t('The price field is required.');
    if (Number.isNaN(num(form.cost))) e.cost = t('The cost field is required.');
    if (!e.price && !e.cost && num(form.price) < num(form.cost)) e.price = t('Price must be equal or greater then cost');
    if (form.has_variants) {
      if (!form.variants.length) e.variants = t('Add at least one variant or turn variants off.');
      form.variants.forEach((v) => {
        if (!v.name.trim()) e[`variant.${v.key}.name`] = t('Required');
        if (Number.isNaN(num(v.price))) e[`variant.${v.key}.price`] = t('Required');
        if (Number.isNaN(num(v.cost))) e[`variant.${v.key}.cost`] = t('Required');
        else if (num(v.price) < num(v.cost)) e[`variant.${v.key}.price`] = t('Price must be equal or greater then cost');
      });
    }
    return e;
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const local = validate();
    if (Object.keys(local).length) {
      setErrors(local);
      toast.error(t('Please fix the highlighted fields'));
      return;
    }
    const payload: Record<string, any> = {
      name: form.name.trim(),
      food_category_id: form.food_category_id ?? '',
      description: form.description ?? '',
      price: form.price,
      cost: form.cost,
      sku: form.sku.trim() || 'null',
      tax_id: form.tax_id === '' ? 'null' : form.tax_id,
      is_bar_type: form.is_bar_type ? 'true' : 'false',
      has_variants: form.has_variants ? 'true' : 'false',
      expiry_date: form.expiry_date || 'null',
      ingredients: JSON.stringify(form.has_variants ? [] : consumptionPayload(form.ingredients)),
      variants: JSON.stringify(
        form.has_variants
          ? form.variants.map((v) => ({
              id: v.id ?? null,
              name: v.name.trim(),
              sku: v.sku.trim() || null,
              price: Number(v.price),
              cost: Number(v.cost),
              ingredients: consumptionPayload(v.ingredients),
            }))
          : [],
      ),
    };
    if (image) payload.image = image;
    setSaving(true);
    try {
      const res = editing ? await multipartUpdate(`admin/food-items/${uuid}`, payload) : await api.post('admin/food-items', toFormData(payload));
      // Variants removed in the form (or all of them when variants were switched off).
      const keep = new Set(form.has_variants ? form.variants.map((v) => v.id).filter(Boolean) : []);
      const removed = originalVariantIds.filter((id) => !keep.has(id));
      for (const id of removed) await api.delete(`admin/food-items-attributes/${id}`);
      toast.success(res.data?.message ?? t('Data saved successfully'));
      qc.invalidateQueries({ queryKey: ['admin/food-items'] });
      navigate('/admin/products');
    } catch (e) {
      setErrors(fieldErrors(e));
    } finally {
      setSaving(false);
    }
  };

  if (editing && record.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-96 lg:col-span-2" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }
  if (editing && record.isError) {
    return (
      <div className="py-16 text-center">
        <p className="font-medium">{t('Unable to load this food item')}</p>
        <Link to="/admin/products" className="btn-secondary mt-4 inline-flex">
          {t('Back')}
        </Link>
      </div>
    );
  }

  const price = num(form.price);
  const cost = num(form.cost);
  const margin = price > 0 && !Number.isNaN(cost) ? ((price - cost) / price) * 100 : null;
  const selectedTax = taxes.items.find((x) => String(x.id) === String(form.tax_id));

  return (
    <form onSubmit={submit} noValidate>
      <PageHeader
        title={editing ? t('Edit food item') : t('Add food item')}
        description={editing ? form.name : t('Enter information for new food item with ingredients')}
        actions={
          <Link to="/admin/products" className="btn-ghost">
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" /> {t('Back')}
          </Link>
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title={t('General')}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label={t('Name')}
                required
                wrapperClassName="sm:col-span-2"
                value={form.name}
                error={errors.name}
                onChange={(e) => set('name', e.target.value)}
                autoFocus={!editing}
              />
              <Select
                label={t('Category')}
                options={categories.items.map((c) => ({ value: c.id, label: c.name }))}
                placeholder={t('Select category')}
                value={form.food_category_id}
                error={errors.food_category_id}
                onChange={(e) => set('food_category_id', e.target.value)}
              />
              <Input
                label={t('SKU')}
                value={form.sku}
                error={errors.sku}
                help={t('Leave empty to generate automatically')}
                onChange={(e) => set('sku', e.target.value)}
                className="font-mono"
              />
              <Textarea
                label={t('Description')}
                wrapperClassName="sm:col-span-2"
                value={form.description}
                error={errors.description}
                onChange={(e) => set('description', e.target.value)}
              />
            </div>
          </Card>

          <Card title={t('Pricing')}>
            <div className="grid gap-4 sm:grid-cols-3">
              <Input
                label={t('Price')}
                required
                type="number"
                step="any"
                min="0"
                inputMode="decimal"
                value={form.price}
                error={errors.price}
                help={form.has_variants ? t('Base price; each variant has its own price') : undefined}
                onChange={(e) => set('price', e.target.value)}
              />
              <Input
                label={t('Cost')}
                required
                type="number"
                step="any"
                min="0"
                inputMode="decimal"
                value={form.cost}
                error={errors.cost}
                onChange={(e) => set('cost', e.target.value)}
              />
              <div>
                <span className="label">{t('Margin')}</span>
                <div className="flex h-[38px] items-center gap-2 text-sm tabular-nums">
                  {margin === null ? (
                    <span className="text-slate-400">—</span>
                  ) : (
                    <>
                      <span className={clsx('font-semibold', margin < 0 ? 'text-red-600' : margin < 20 ? 'text-amber-600' : 'text-emerald-600')}>
                        {margin.toFixed(1)}%
                      </span>
                      <span className="text-slate-500">({money(price - cost)})</span>
                    </>
                  )}
                </div>
              </div>
              <Select
                label={t('Tax')}
                wrapperClassName="sm:col-span-3"
                options={taxes.items.map((x) => ({
                  value: x.id,
                  label: `${x.tax_title} (${x.is_tax_fix ? money(x.tax_rate) : `${x.tax_rate}%`})`,
                }))}
                placeholder={t('Default tax')}
                value={form.tax_id}
                error={errors.tax_id}
                help={
                  config.modes.item_based_tax
                    ? selectedTax
                      ? undefined
                      : t('The default tax from the settings is applied')
                    : t('Applied only when item based taxation is enabled in the settings')
                }
                onChange={(e) => set('tax_id', e.target.value)}
              />
            </div>
          </Card>

          <Card
            title={
              <span className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-slate-400" aria-hidden="true" />
                {t('Variants')}
                {form.has_variants && <Badge tone="purple">{form.variants.length}</Badge>}
              </span>
            }
          >
            <Switch
              label={t('Product has variants?')}
              description={t('Sizes or versions sold at different prices, e.g. small / large.')}
              checked={form.has_variants}
              onChange={(v) => {
                setForm((f) => ({ ...f, has_variants: v, variants: v && !f.variants.length ? [emptyVariant()] : f.variants }));
              }}
            />
            {form.has_variants && (
              <div className="mt-4 space-y-2">
                {editing && originalVariantIds.length > 0 && (
                  <p className="help">{t('Removed variants are deleted when you save.')}</p>
                )}
                <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 px-1 text-xs font-medium uppercase tracking-wide text-slate-500 md:grid">
                  <span>{t('Name')}</span>
                  <span>{t('SKU')}</span>
                  <span>{t('Price')}</span>
                  <span>{t('Cost')}</span>
                  <span className="w-20" />
                </div>
                {form.variants.map((v, idx) => {
                  const ek = (f: string) => errors[`variant.${v.key}.${f}`];
                  const open = openVariant === v.key;
                  return (
                    <div key={v.key} className="rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                      <div className="grid grid-cols-2 gap-2 md:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-start">
                        <Input
                          aria-label={`${t('Variant')} ${idx + 1} ${t('Name')}`}
                          placeholder={t('Enter Variant name')}
                          wrapperClassName="col-span-2 md:col-span-1"
                          value={v.name}
                          error={ek('name')}
                          onChange={(e) => setVariant(v.key, { name: e.target.value })}
                        />
                        <Input
                          aria-label={`${t('Variant')} ${idx + 1} ${t('SKU')}`}
                          placeholder={t('SKU')}
                          wrapperClassName="col-span-2 md:col-span-1"
                          className="font-mono"
                          value={v.sku}
                          onChange={(e) => setVariant(v.key, { sku: e.target.value })}
                        />
                        <Input
                          aria-label={`${t('Variant')} ${idx + 1} ${t('Price')}`}
                          placeholder={t('Price')}
                          type="number"
                          step="any"
                          min="0"
                          value={v.price}
                          error={ek('price')}
                          onChange={(e) => setVariant(v.key, { price: e.target.value })}
                        />
                        <Input
                          aria-label={`${t('Variant')} ${idx + 1} ${t('Cost')}`}
                          placeholder={t('Cost')}
                          type="number"
                          step="any"
                          min="0"
                          value={v.cost}
                          error={ek('cost')}
                          onChange={(e) => setVariant(v.key, { cost: e.target.value })}
                        />
                        <div className="col-span-2 flex justify-end gap-1 md:col-span-1">
                          {consumption && (
                            <button
                              type="button"
                              className={clsx('btn-ghost btn-sm', v.ingredients.length && 'text-brand-600')}
                              aria-expanded={open}
                              aria-label={`${t('Ingredients Consumption')} — ${v.name || idx + 1}`}
                              title={t('Ingredients Consumption')}
                              onClick={() => setOpenVariant(open ? null : v.key)}
                            >
                              <FlaskConical className="h-4 w-4" />
                              <span className="tabular-nums">{v.ingredients.length}</span>
                              <ChevronDown className={clsx('h-3 w-3 transition', open && 'rotate-180')} />
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn-ghost btn-sm text-red-600"
                            aria-label={`${t('Remove')} ${v.name || `${t('Variant')} ${idx + 1}`}`}
                            title={t('Remove')}
                            onClick={() => setForm((f) => ({ ...f, variants: f.variants.filter((x) => x.key !== v.key) }))}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      {consumption && open && (
                        <div className="mt-2">
                          <IngredientsEditor
                            compact
                            description={t('Deducted from stock for every :name sold', { name: v.name || t('Variant') })}
                            value={v.ingredients}
                            onChange={(rows) => setVariant(v.key, { ingredients: rows })}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
                {errors.variants && <p className="error-text">{errors.variants}</p>}
                <Button
                  size="sm"
                  icon={<Plus className="h-4 w-4" />}
                  onClick={() => {
                    const v = emptyVariant();
                    setForm((f) => ({ ...f, variants: [...f.variants, v] }));
                  }}
                >
                  {t('Add more Variants')}
                </Button>
              </div>
            )}
          </Card>

          {consumption && !form.has_variants && (
            <Card title={t('Ingredients Consumption')}>
              <IngredientsEditor
                compact
                description={t('Ingredients deducted from stock for every unit sold.')}
                value={form.ingredients}
                onChange={(rows) => set('ingredients', rows)}
                error={errors.ingredients}
              />
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card title={t('Image')}>
            <ImageInput label={undefined} value={image} currentUrl={record.data?.image ?? null} onChange={setImage} error={errors.image} />
          </Card>

          <Card title={t('For kitchen/Bar')}>
            <fieldset>
              <legend className="help mb-2">{t('Should it be prepared in the kitchen or the bar?')}</legend>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { v: false, label: t('Kitchen') },
                  { v: true, label: t('Bar') },
                ].map((o) => (
                  <label
                    key={String(o.v)}
                    className={clsx(
                      'tap flex cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition',
                      form.is_bar_type === o.v
                        ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                        : 'border-slate-200 hover:border-slate-300 dark:border-slate-700',
                    )}
                  >
                    <input
                      type="radio"
                      name="is_bar_type"
                      className="sr-only"
                      checked={form.is_bar_type === o.v}
                      onChange={() => set('is_bar_type', o.v)}
                    />
                    {o.label}
                  </label>
                ))}
              </div>
            </fieldset>
          </Card>

          {config.modes.allow_expiry_date && (
            <Card title={t('Expiry date')}>
              <Input
                aria-label={t('Expiry date')}
                type="date"
                value={form.expiry_date}
                error={errors.expiry_date}
                help={t('Expired items are hidden from the POS')}
                onChange={(e) => set('expiry_date', e.target.value)}
              />
            </Card>
          )}

          {can('manage_modifiers') && (
            <Card title={t('Modifiers')}>
              <ModifiersInfo
                hasCategory={!!form.food_category_id}
                loading={modifiers.isLoading && modifiers.fetchStatus !== 'idle'}
                items={modifiers.items.map((m) => (
                  <li key={m.id} className="flex justify-between gap-2 py-1 text-sm">
                    <span className="truncate">{m.title}</span>
                    <span className="tabular-nums text-slate-500">+{money(m.price)}</span>
                  </li>
                ))}
              />
            </Card>
          )}
        </div>
      </div>

      <div className="sticky bottom-0 z-20 -mx-3 mt-4 border-t border-slate-200 bg-white/90 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-950/90 sm:-mx-6">
        <div className="flex items-center justify-end gap-2 px-3 py-3 sm:px-6">
          <Link to="/admin/products" className="btn-secondary">
            {t('Cancel')}
          </Link>
          <Button variant="primary" type="submit" loading={saving}>
            {editing ? t('Update') : t('Save')}
          </Button>
        </div>
      </div>
    </form>
  );
}

function ModifiersInfo({ hasCategory, loading, items }: { hasCategory: boolean; loading: boolean; items: ReactNode[] }) {
  const t = useT();
  if (!hasCategory) return <p className="text-sm text-slate-500">{t('Modifiers are linked to food categories. Select a category to see them.')}</p>;
  return (
    <div>
      <p className="help mb-2">{t('Modifiers of the selected category are offered with this item.')}</p>
      {loading ? (
        <Skeleton className="h-16" />
      ) : items.length ? (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">{items}</ul>
      ) : (
        <p className="text-sm text-slate-500">{t('No modifiers in this category yet.')}</p>
      )}
      <Link to="/admin/modifiers" className="tap mt-2 inline-flex items-center text-sm font-medium text-brand-600 hover:underline">
        {t('Manage modifiers')}
      </Link>
    </div>
  );
}
