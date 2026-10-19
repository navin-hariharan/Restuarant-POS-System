import { CrudPage } from '@/components/crud/CrudPage';
import { useAuth, useT } from '@/providers/AppProviders';

type ExpenseType = { id: number; title: string; created_at: string; updated_at: string };

export default function ExpenseTypes() {
  const t = useT();
  const { can } = useAuth();
  const allowed = can('manage_expense_types');
  return (
    <CrudPage<ExpenseType>
      title="Expense types"
      singular="Expense type"
      description="Categories used to group expenses. A type that is used by expenses cannot be deleted."
      url="admin/expense-types"
      permission="manage_expense_types"
      canCreate={allowed}
      canEdit={allowed}
      canDelete={allowed}
      drawerWidth="max-w-md"
      fields={[{ name: 'title', label: 'Title', required: true, full: true }]}
      columns={[
        { key: 'title', header: t('Title'), cell: (r) => <span className="font-medium">{r.title}</span> },
        { key: 'created_at', header: t('Created at'), className: 'whitespace-nowrap text-slate-500' },
        { key: 'updated_at', header: t('Updated at'), className: 'whitespace-nowrap text-slate-500' },
      ]}
    />
  );
}
