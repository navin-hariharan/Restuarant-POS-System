import { CrudPage } from '@/components/crud/CrudPage';
import { useAuth, useT } from '@/providers/AppProviders';

type PaymentMethod = { id: number; title: string; created_at: string; updated_at: string };

export default function PaymentMethods() {
  const t = useT();
  const { can } = useAuth();
  const allowed = can('manage_payment_methods');
  return (
    <CrudPage<PaymentMethod>
      title="Payment methods"
      singular="Payment method"
      description="Ways customers can pay at checkout, e.g. cash, card or bank transfer."
      url="admin/payment-methods"
      permission="manage_payment_methods"
      canCreate={allowed}
      canEdit={allowed}
      canDelete={allowed}
      drawerWidth="max-w-md"
      // The update rule ignores the current row by the `id` sent in the body.
      toForm={(r) => ({ id: r.id, title: r.title ?? '' })}
      toPayload={(v, editing) => (editing ? { id: v.id, title: v.title } : { title: v.title })}
      fields={[{ name: 'title', label: 'Title', required: true, full: true }]}
      columns={[
        { key: 'title', header: t('Title'), cell: (r) => <span className="font-medium">{r.title}</span> },
        { key: 'created_at', header: t('Created at'), className: 'whitespace-nowrap text-slate-500' },
        { key: 'updated_at', header: t('Updated at'), className: 'whitespace-nowrap text-slate-500' },
      ]}
    />
  );
}
