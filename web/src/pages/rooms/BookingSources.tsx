import { CrudPage } from '@/components/crud/CrudPage';
import { useT } from '@/providers/AppProviders';

type Row = { id: number; title: string; created_at: string; updated_at: string };

export default function BookingSources() {
  const t = useT();
  return (
    <CrudPage<Row>
      title="Booking sources"
      singular="Booking source"
      description="Where reservations come from, e.g. walk-in, phone, website or an agency."
      url="admin/booking-sources"
      permission="manage_booking_sources"
      columns={[
        { key: 'title', header: t('Title'), cell: (r) => <span className="font-medium">{r.title}</span> },
        { key: 'created_at', header: t('Created'), className: 'text-slate-500' },
      ]}
      // The update rule ignores the current row for the unique check via `id`.
      toForm={(r) => ({ id: r.id, title: r.title })}
      fields={[{ name: 'title', label: 'Booking source title', required: true, full: true }]}
    />
  );
}
