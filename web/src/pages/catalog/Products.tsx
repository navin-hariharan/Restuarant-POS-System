import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, UtensilsCrossed } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth, useConfig, useT } from '@/providers/AppProviders';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  PageHeader,
  SearchInput,
  Select,
  TablePagination,
  useConfirm,
  useTableQuery,
  type Column,
} from '@/components/ui';
import { Thumb, useList } from '@/components/catalog/shared';

export type FoodItemRow = {
  id: number;
  uuid: string;
  sku: string;
  name: string;
  cost: number;
  price: number;
  is_bar_type: boolean;
  has_variants: boolean;
  variants: number;
  image: string;
  expiry_date: string | null;
  is_expired: boolean;
  category: { id: number; name: string } | null;
  created_at: string;
};

export default function Products() {
  const t = useT();
  const { money, config } = useConfig();
  const { can } = useAuth();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const category = params.get('category') ?? '';
  const categories = useList<{ id: number; name: string }>('admin/food-categories', { enabled: can('manage_food_categories', 'manage_food_items') });
  const table = useTableQuery<FoodItemRow>('admin/food-items', { filters: { category: category || undefined } });
  const [selected, setSelected] = useState<(string | number)[]>([]);
  const manage = can('manage_food_items');

  useEffect(() => setSelected([]), [table.page, category]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['admin/food-items'] });

  const remove = async (row: FoodItemRow) => {
    if (!(await confirm({ danger: true, title: t('Delete'), message: t('Are you sure you want to delete :name?', { name: row.name }) }))) return;
    const res = await api.delete(`admin/food-items/${row.uuid}`);
    toast.success(res.data?.message ?? t('Data removed successfully'));
    refresh();
  };

  const removeSelected = async () => {
    if (!(await confirm({ danger: true, message: t(':count items will be removed', { count: selected.length }) }))) return;
    const res = await api.delete('admin/food-items-rows-destroy', { data: { rows: selected } });
    toast.success(res.data?.message ?? t('Data removed successfully'));
    setSelected([]);
    refresh();
  };

  const columns: Column<FoodItemRow>[] = [
    {
      key: 'name',
      header: t('Name'),
      sortKey: 'name',
      cell: (r) => (
        <div className="flex min-w-48 items-center gap-3">
          <Thumb src={r.image} alt="" />
          <div className="min-w-0">
            <Link
              to={`/admin/products/${r.uuid}/edit`}
              className="block truncate font-medium text-slate-900 hover:text-brand-600 dark:text-slate-100"
              onClick={(e) => e.stopPropagation()}
            >
              {r.name}
            </Link>
            <span className="block truncate font-mono text-xs text-slate-500">{r.sku}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'category',
      header: t('Category'),
      sortKey: 'food_category_id',
      cell: (r) => (r.category ? <span className="text-sm">{r.category.name}</span> : <span className="text-slate-400">—</span>),
    },
    {
      key: 'price',
      header: t('Price'),
      sortKey: 'price',
      className: 'text-end tabular-nums',
      headerClassName: 'text-end',
      cell: (r) => <span className="font-medium">{money(r.price)}</span>,
    },
    {
      key: 'cost',
      header: t('Cost'),
      sortKey: 'cost',
      className: 'text-end tabular-nums text-slate-600 dark:text-slate-400',
      headerClassName: 'text-end',
      cell: (r) => money(r.cost),
    },
    {
      key: 'margin',
      header: t('Margin'),
      className: 'text-end tabular-nums',
      headerClassName: 'text-end',
      cell: (r) => {
        const p = Number(r.price);
        const m = p > 0 ? ((p - Number(r.cost)) / p) * 100 : 0;
        return <span className={m < 0 ? 'text-red-600' : m < 20 ? 'text-amber-600' : 'text-emerald-600'}>{m.toFixed(0)}%</span>;
      },
    },
    {
      key: 'variants',
      header: t('Variants'),
      className: 'text-center',
      headerClassName: 'text-center',
      cell: (r) => (r.has_variants ? <Badge tone="purple">{r.variants}</Badge> : <span className="text-slate-400">—</span>),
    },
    {
      key: 'type',
      header: t('kitchen/Bar'),
      sortKey: 'is_bar_type',
      cell: (r) => (r.is_bar_type ? <Badge tone="blue">{t('Bar')}</Badge> : <Badge tone="green">{t('Kitchen')}</Badge>),
    },
    ...(config.modes.allow_expiry_date
      ? [
          {
            key: 'expiry_date',
            header: t('Expiry date'),
            sortKey: 'expiry_date',
            cell: (r: FoodItemRow) =>
              r.expiry_date && r.expiry_date !== 'null' ? (
                <span className={r.is_expired ? 'font-medium text-red-600' : ''}>
                  {r.expiry_date}
                  {r.is_expired && <Badge tone="red" className="ms-1.5">{t('Expired')}</Badge>}
                </span>
              ) : (
                <span className="text-slate-400">—</span>
              ),
          } as Column<FoodItemRow>,
        ]
      : []),
    {
      key: '__actions',
      header: <span className="sr-only">{t('Actions')}</span>,
      className: 'text-end',
      cell: (r) =>
        manage && (
          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <Link to={`/admin/products/${r.uuid}/edit`} className="btn-ghost btn-sm" aria-label={`${t('Edit')} ${r.name}`} title={t('Edit')}>
              <Pencil className="h-4 w-4" />
            </Link>
            <button className="btn-ghost btn-sm text-red-600" onClick={() => remove(r)} aria-label={`${t('Delete')} ${r.name}`} title={t('Delete')}>
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ),
    },
  ];

  const filtered = !!(table.search || category);

  return (
    <div>
      <PageHeader
        title={t('Food items')}
        description={t('Menu items sold in the POS, with variants and ingredient consumption.')}
        actions={
          manage && (
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => navigate('/admin/products/new')}>
              {t('Add food item')}
            </Button>
          )
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput className="w-full sm:w-72" value={table.search} onChange={table.setSearch} placeholder={t('Search')} />
        <Select
          aria-label={t('Category')}
          wrapperClassName="w-full sm:w-56"
          options={categories.items.map((c) => ({ value: c.id, label: c.name }))}
          placeholder={t('All categories')}
          value={category}
          onChange={(e) => {
            const next = new URLSearchParams(params);
            if (e.target.value) next.set('category', e.target.value);
            else next.delete('category');
            setParams(next, { replace: true });
            table.setPage(1);
          }}
        />
        {manage && selected.length > 0 && (
          <Button variant="danger" size="sm" icon={<Trash2 className="h-4 w-4" />} onClick={removeSelected}>
            {t('Delete')} ({selected.length})
          </Button>
        )}
      </div>
      <DataTable
        columns={columns}
        rows={table.items}
        loading={table.query.isLoading}
        rowKey={(r) => r.uuid}
        sort={table.sort}
        onSort={table.setSort}
        selectable={manage}
        selected={selected}
        onSelectedChange={setSelected}
        onRowClick={manage ? (r) => navigate(`/admin/products/${r.uuid}/edit`) : undefined}
        empty={
          <EmptyState
            icon={<UtensilsCrossed className="h-6 w-6" />}
            title={filtered ? t('No data found') : t('No food items yet')}
            description={filtered ? undefined : t('Create your first menu item to start selling.')}
            action={
              !filtered && manage ? (
                <Button variant="primary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => navigate('/admin/products/new')}>
                  {t('Add food item')}
                </Button>
              ) : undefined
            }
          />
        }
        footer={<TablePagination table={table} />}
      />
    </div>
  );
}
