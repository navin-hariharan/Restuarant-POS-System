import { CrudPage } from '@/components/crud/CrudPage';
import { useT } from '@/providers/AppProviders';

type Row = { id: number; title: string; created_at: string; updated_at: string };

export default function ReservationStatuses() {
  const t = useT();
  return (
    <CrudPage<Row>
      title="Reservation statuses"
      singular="Reservation status"
      description="Stages a reservation can be in, e.g. confirmed, tentative or no-show."
      url="admin/reservation-statuses"
      permission="manage_reservation_statuses"
      columns={[
        { key: 'title', header: t('Title'), cell: (r) => <span className="font-medium">{r.title}</span> },
        { key: 'created_at', header: t('Created'), className: 'text-slate-500' },
      ]}
      // The update rule ignores the current row for the unique check via `id`.
      toForm={(r) => ({ id: r.id, title: r.title })}
      fields={[{ name: 'title', label: 'Reservation status title', required: true, full: true }]}
    />
  );
}
