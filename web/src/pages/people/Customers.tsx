import { MapPin, Plus, Trash2 } from 'lucide-react';
import { CrudPage, FieldRenderer, type FieldDef } from '@/components/crud/CrudPage';
import { useAuth, useT } from '@/providers/AppProviders';
import { Badge, Button } from '@/components/ui';

type CustomerRow = {
  id: number;
  uuid: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  shipping_addresses: string[];
  created_at: string;
};

const fields: FieldDef[] = [
  { name: 'name', label: 'Name', required: true, full: true },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'phone', label: 'Phone', type: 'tel' },
  { name: 'address', label: 'Address', full: true },
];

function ShippingAddresses({ value, onChange, errors }: { value: string[]; onChange: (v: string[]) => void; errors: Record<string, string> }) {
  const t = useT();
  return (
    <fieldset className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <legend className="flex items-center gap-1.5 px-1 text-sm font-medium">
        <MapPin className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" /> {t('Shipping address')}
      </legend>
      <p className="help mb-2">{t('Delivery addresses offered when this customer orders for delivery.')}</p>
      <div className="space-y-2">
        {value.map((addr, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="flex-1">
              <textarea
                rows={2}
                className="input"
                aria-label={`${t('Shipping address')} ${i + 1}`}
                value={addr}
                onChange={(e) => onChange(value.map((a, j) => (j === i ? e.target.value : a)))}
              />
              {errors[`shipping_addresses.${i}`] && <p className="error-text">{errors[`shipping_addresses.${i}`]}</p>}
            </div>
            <button
              type="button"
              className="btn-ghost btn-sm mt-1 text-red-600"
              aria-label={`${t('Remove')} ${t('Shipping address')} ${i + 1}`}
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => onChange([...value, ''])}>
          {t('Add shipping addresses')}
        </Button>
      </div>
    </fieldset>
  );
}

export default function Customers() {
  const t = useT();
  const { can } = useAuth();
  const allowed = can('manage_customers');
  return (
    <CrudPage<CustomerRow>
      title="Customers"
      singular="Customer"
      description="Customers with sales or the default walk-in customer cannot be deleted."
      url="admin/customers"
      idKey="uuid"
      permission="manage_customers"
      canCreate={allowed}
      canEdit={allowed}
      canDelete={allowed}
      fields={[...fields, { name: 'shipping_addresses', label: 'Shipping address', defaultValue: [] }]}
      toForm={(r) => ({
        name: r.name ?? '',
        email: r.email ?? '',
        phone: r.phone ?? '',
        address: r.address ?? '',
        shipping_addresses: Array.isArray(r.shipping_addresses) ? [...r.shipping_addresses] : [],
      })}
      toPayload={(v) => ({
        name: v.name,
        email: v.email || null,
        phone: v.phone || null,
        address: v.address || null,
        shipping_addresses: (v.shipping_addresses ?? []).map((a: string) => a.trim()).filter(Boolean),
      })}
      renderForm={({ values, setValue, errors, current }) => (
        <>
          {fields.map((f) => (
            <div key={f.name} className={f.full ? 'sm:col-span-2' : ''}>
              <FieldRenderer field={f} values={values} setValue={setValue} errors={errors} current={current} />
            </div>
          ))}
          <div className="sm:col-span-2">
            <ShippingAddresses value={values.shipping_addresses ?? []} onChange={(v) => setValue('shipping_addresses', v)} errors={errors} />
          </div>
        </>
      )}
      columns={[
        {
          key: 'name',
          header: t('Name'),
          sortKey: 'name',
          cell: (r) => (
            <div className="min-w-0">
              <span className="block font-medium">{r.name}</span>
              {r.email && <span className="block truncate text-xs text-slate-500">{r.email}</span>}
            </div>
          ),
        },
        { key: 'phone', header: t('Phone'), sortKey: 'phone', className: 'whitespace-nowrap', cell: (r) => r.phone ?? '—' },
        { key: 'address', header: t('Address'), cell: (r) => <span className="line-clamp-2 max-w-xs text-sm">{r.address ?? '—'}</span> },
        {
          key: 'shipping',
          header: t('Shipping address'),
          className: 'text-center',
          headerClassName: 'text-center',
          cell: (r) => <Badge tone={r.shipping_addresses?.length ? 'blue' : 'gray'}>{r.shipping_addresses?.length ?? 0}</Badge>,
        },
        { key: 'created_at', header: t('Created at'), sortKey: 'created_at', className: 'whitespace-nowrap text-slate-500' },
      ]}
    />
  );
}
