import { CrudPage } from '@/components/crud/CrudPage';
import { useAuth, useT } from '@/providers/AppProviders';

type PickupPoint = {
  id: number;
  place_title: string;
  person_name: string | null;
  phone: string | null;
  address: string | null;
  created_at: string;
};

export default function PickupPoints() {
  const t = useT();
  const { can } = useAuth();
  const allowed = can('manage_pickup_points');
  return (
    <CrudPage<PickupPoint>
      title="Pickup points"
      singular="Pickup point"
      description="Places where customers collect their pickup orders."
      url="admin/pickup-points"
      permission="manage_pickup_points"
      canCreate={allowed}
      canEdit={allowed}
      canDelete={allowed}
      // The update rule ignores the current row by the `id` sent in the body.
      toForm={(r) => ({ id: r.id, place_title: r.place_title ?? '', person_name: r.person_name ?? '', phone: r.phone ?? '', address: r.address ?? '' })}
      toPayload={(v, editing) => ({
        ...(editing ? { id: v.id } : {}),
        place_title: v.place_title,
        person_name: v.person_name || null,
        phone: v.phone || null,
        address: v.address || null,
      })}
      fields={[
        { name: 'place_title', label: 'Place Title', required: true, full: true },
        { name: 'person_name', label: 'Person Name' },
        { name: 'phone', label: 'Phone', type: 'tel' },
        { name: 'address', label: 'Address', type: 'textarea' },
      ]}
      columns={[
        { key: 'place_title', header: t('Place Title'), cell: (r) => <span className="font-medium">{r.place_title}</span> },
        { key: 'person_name', header: t('Person Name'), cell: (r) => r.person_name || '—' },
        { key: 'phone', header: t('Phone'), className: 'whitespace-nowrap', cell: (r) => r.phone || '—' },
        { key: 'address', header: t('Address'), cell: (r) => <span className="line-clamp-2 max-w-xs text-sm">{r.address || '—'}</span> },
        { key: 'created_at', header: t('Created at'), className: 'whitespace-nowrap text-slate-500' },
      ]}
    />
  );
}
