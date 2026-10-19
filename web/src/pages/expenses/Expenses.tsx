import { useState } from 'react';
import { CrudPage } from '@/components/crud/CrudPage';
import { useAuth, useConfig, useT } from '@/providers/AppProviders';
import { Badge, Select } from '@/components/ui';
import { toDateInput } from '@/lib/format';
import { useList } from '@/components/catalog/shared';

type ExpenseRow = {
  id: number;
  title: string;
  amount: number;
  description: string | null;
  type: { id: number; title: string } | null;
  expense_type_id: number;
  expense_date: string | null;
  created_at: string;
};

export default function Expenses() {
  const t = useT();
  const { money, config } = useConfig();
  const { can } = useAuth();
  const allowed = can('manage_expenses');
  const [type, setType] = useState('');
  const types = useList<{ id: number; title: string }>('admin/expense-types', { enabled: can('manage_expense_types', 'manage_expenses') });

  return (
    <CrudPage<ExpenseRow>
      title="Expenses"
      singular="Expense"
      description={
        config.modes.cashbooks ? 'Running costs of the restaurant. New expenses are recorded in your open cashbook.' : 'Running costs of the restaurant.'
      }
      url="admin/expenses"
      bulkDeleteUrl="admin/expense-rows-destroy"
      permission="manage_expenses"
      canCreate={allowed}
      canEdit={allowed}
      canDelete={allowed}
      filterValues={{ category: type || undefined }}
      filters={
        <Select
          aria-label={t('Expense type')}
          wrapperClassName="w-full sm:w-56"
          options={types.items.map((x) => ({ value: x.id, label: x.title }))}
          placeholder={t('All types')}
          value={type}
          onChange={(e) => setType(e.target.value)}
        />
      }
      fields={[
        { name: 'title', label: 'Title', required: true, full: true },
        { name: 'expense_type_id', label: 'Expense type', type: 'select', required: true, optionsUrl: 'admin/expense-types', optionLabel: 'title' },
        { name: 'amount', label: 'Amount', type: 'number', required: true, step: '0.01' },
        { name: 'expense_date', label: 'Expense date', type: 'date', defaultValue: toDateInput() },
        { name: 'description', label: 'Note', type: 'textarea' },
      ]}
      toForm={(r) => ({
        title: r.title ?? '',
        expense_type_id: r.expense_type_id ?? r.type?.id ?? '',
        amount: r.amount ?? '',
        expense_date: r.expense_date ? String(r.expense_date).slice(0, 10) : '',
        description: r.description && r.description !== 'undefined' && r.description !== 'null' ? r.description : '',
      })}
      columns={[
        {
          key: 'title',
          header: t('Title'),
          sortKey: 'title',
          cell: (r) => (
            <div className="min-w-0">
              <span className="block font-medium">{r.title}</span>
              {r.description && <span className="block max-w-xs truncate text-xs text-slate-500">{r.description}</span>}
            </div>
          ),
        },
        { key: 'type', header: t('Expense type'), sortKey: 'expense_type_id', cell: (r) => (r.type ? <Badge>{r.type.title}</Badge> : '—') },
        {
          key: 'amount',
          header: t('Amount'),
          sortKey: 'amount',
          className: 'text-end tabular-nums font-medium',
          headerClassName: 'text-end',
          cell: (r) => money(r.amount),
        },
        { key: 'expense_date', header: t('Expense date'), sortKey: 'expense_date', className: 'whitespace-nowrap', cell: (r) => r.expense_date ?? '—' },
        { key: 'created_at', header: t('Created at'), sortKey: 'created_at', className: 'whitespace-nowrap text-slate-500' },
      ]}
    />
  );
}
