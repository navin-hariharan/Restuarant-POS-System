import { Badge } from '@/components/ui';
import { CrudPage } from '@/components/crud/CrudPage';
import { useConfig, useT } from '@/providers/AppProviders';

type GuestRoom = {
  id: number;
  room_name: string;
  capactity: number | string;
  per_hour_charges: number | string;
  per_use_charges: number | string;
  layout: string | null;
  reserved_slots: unknown[];
};

export default function GuestRooms() {
  const t = useT();
  const { money } = useConfig();
  return (
    <CrudPage<GuestRoom>
      title="Guest rooms"
      singular="Guest Room"
      description="Rooms and halls that can be reserved, with their hourly and per-use rates."
      url="admin/guest-rooms"
      permission="manage_guest_rooms"
      columns={[
        { key: 'room_name', header: t('Room name'), cell: (r) => <span className="font-medium">{r.room_name}</span> },
        { key: 'capactity', header: t('Max capactity'), cell: (r) => r.capactity },
        { key: 'per_hour_charges', header: t('Charges per hour'), className: 'tabular-nums', cell: (r) => money(r.per_hour_charges) },
        { key: 'per_use_charges', header: t('Charges per use'), className: 'tabular-nums', cell: (r) => money(r.per_use_charges) },
        {
          key: 'reserved_slots',
          header: t('Reservations'),
          cell: (r) => <Badge tone={r.reserved_slots?.length ? 'blue' : 'gray'}>{r.reserved_slots?.length ?? 0}</Badge>,
        },
      ]}
      // The update rule ignores the current row for the unique check via `id`.
      toForm={(r) => ({ id: r.id, room_name: r.room_name, capactity: r.capactity, per_hour_charges: r.per_hour_charges, per_use_charges: r.per_use_charges, layout: r.layout ?? '' })}
      fields={[
        { name: 'room_name', label: 'Room name/number/title', required: true, full: true },
        { name: 'capactity', label: 'Max capactity', type: 'number', required: true, step: '1', help: 'Number of guests' },
        { name: 'per_hour_charges', label: 'Charges per hour', type: 'number', required: true, step: '0.01' },
        { name: 'per_use_charges', label: 'Charges per use', type: 'number', required: true, step: '0.01', help: 'Flat price when booked per use instead of per hour' },
        { name: 'layout', label: 'Layout information', type: 'textarea', help: 'Floor, beds, facilities…' },
      ]}
    />
  );
}
