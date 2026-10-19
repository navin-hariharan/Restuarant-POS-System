import { Link } from 'react-router-dom';
import { CrudPage } from '@/components/crud/CrudPage';
import { useAuth, useT } from '@/providers/AppProviders';
import { Badge } from '@/components/ui';
import { Thumb } from '@/components/catalog/shared';

type Category = { id: number; name: string; slug: string | null; image: string; linked: number; created_at: string };

export default function Categories() {
  const t = useT();
  const { can } = useAuth();
  const allowed = can('manage_food_categories');
  return (
    <CrudPage<Category>
      title="Food categories"
      singular="Category"
      description="Group menu items. Deleting a category also deletes every food item in it."
      url="admin/food-categories"
      bulkDeleteUrl="admin/food-category-rows-destroy"
      permission="manage_food_categories"
      canCreate={allowed}
      canEdit={allowed}
      canDelete={allowed}
      multipart
      fields={[
        { name: 'name', label: 'Name', required: true, full: true },
        { name: 'image', label: 'Image', type: 'image', full: true },
      ]}
      columns={[
        {
          key: 'name',
          header: t('Name'),
          sortKey: 'name',
          cell: (r) => (
            <div className="flex items-center gap-3">
              <Thumb src={r.image} />
              <span className="font-medium">{r.name}</span>
            </div>
          ),
        },
        {
          key: 'linked',
          header: t('Food items'),
          cell: (r) =>
            can('manage_food_items') ? (
              <Link
                to={`/admin/products?category=${r.id}`}
                onClick={(e) => e.stopPropagation()}
                className="hover:underline"
                aria-label={`${t('Food items')}: ${r.name}`}
              >
                <Badge tone={r.linked ? 'blue' : 'gray'}>{r.linked}</Badge>
              </Link>
            ) : (
              <Badge tone={r.linked ? 'blue' : 'gray'}>{r.linked}</Badge>
            ),
        },
        { key: 'created_at', header: t('Created at'), sortKey: 'created_at', className: 'text-slate-500 whitespace-nowrap' },
      ]}
    />
  );
}
