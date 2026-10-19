import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, CalendarClock, CalendarX } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth, useT } from '@/providers/AppProviders';
import { Badge, EmptyState, PageHeader, Tabs } from '@/components/ui';
import { KpiCard, PrintTitle, ReportActions, ReportMeta } from '@/components/reports/ReportKit';
import { LocalTable, type LocalColumn } from '@/components/reports/LocalTable';
import { downloadCsv } from '@/components/reports/export';
import { usePrintReport } from '@/components/reports/usePrintReport';

type Row = { id: number; uuid: string; name: string; expiry_date: string | null; is_expired: boolean };
type Status = 'expired' | 'soon' | 'later';
const SOON_DAYS = 5;

function daysLeft(date: string | null): number | null {
  if (!date) return null;
  const d = new Date(`${String(date).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

export default function ExpiryAlerts() {
  const t = useT();
  const { can } = useAuth();
  const [tab, setTab] = useState<'all' | Status>('all');
  const q = useQuery({
    queryKey: ['expiry-alerts'],
    queryFn: async () => (await api.get<Row[]>('admin/expiry-alerts')).data,
  });
  const rows = useMemo(
    () =>
      (q.data ?? []).map((r) => {
        const days = daysLeft(r.expiry_date);
        const status: Status = r.is_expired || (days !== null && days < 0) ? 'expired' : days !== null && days <= SOON_DAYS ? 'soon' : 'later';
        return { ...r, days, status };
      }),
    [q.data],
  );
  type R = (typeof rows)[number];
  const counts = { expired: rows.filter((r) => r.status === 'expired').length, soon: rows.filter((r) => r.status === 'soon').length, later: rows.filter((r) => r.status === 'later').length };
  const visible = tab === 'all' ? rows : rows.filter((r) => r.status === tab);
  const title = t('Expiry alerts');
  const { ref, printing, print } = usePrintReport(title);

  const columns: LocalColumn<R>[] = [
    {
      key: 'name',
      header: t('Food item'),
      sortValue: (r) => r.name,
      cell: (r) =>
        can('manage_food_items') ? (
          <Link to={`/admin/products/${r.uuid}/edit`} className="font-medium text-brand-700 hover:underline dark:text-brand-300">
            {r.name}
          </Link>
        ) : (
          <span className="font-medium">{r.name}</span>
        ),
    },
    { key: 'expiry_date', header: t('Expiry date'), sortValue: (r) => r.expiry_date ?? '', cell: (r) => <span className="tabular-nums">{r.expiry_date ? String(r.expiry_date).slice(0, 10) : '—'}</span> },
    {
      key: 'days',
      header: t('Remaining'),
      sortValue: (r) => r.days ?? 0,
      cell: (r) =>
        r.days === null ? '—' : r.days < 0 ? t(':days days ago', { days: Math.abs(r.days) }) : r.days === 0 ? t('Today') : t('in :days days', { days: r.days }),
    },
    {
      key: 'status',
      header: t('Status'),
      sortValue: (r) => (r.status === 'expired' ? 0 : r.status === 'soon' ? 1 : 2),
      cell: (r) =>
        r.status === 'expired' ? (
          <Badge tone="red">
            <CalendarX className="h-3 w-3" aria-hidden /> {t('Expired')}
          </Badge>
        ) : r.status === 'soon' ? (
          <Badge tone="amber">
            <CalendarClock className="h-3 w-3" aria-hidden /> {t('Expiring soon')}
          </Badge>
        ) : (
          <Badge tone="gray">
            <CalendarCheck className="h-3 w-3" aria-hidden /> {t('Valid')}
          </Badge>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={title}
        description={t('Food items that have expired or will expire within :days days.', { days: SOON_DAYS })}
        actions={
          <ReportActions
            onRefresh={() => q.refetch()}
            refreshing={q.isFetching}
            disabled={!visible.length}
            onCsv={() =>
              downloadCsv(
                'expiry_alerts',
                [t('ID'), t('Name'), t('Expiry date'), t('Remaining'), t('Status')],
                visible.map((r) => [r.id, r.name, r.expiry_date ?? '', r.days ?? '', r.status === 'expired' ? t('Expired') : r.status === 'soon' ? t('Expiring soon') : t('Valid')]),
              )
            }
            onPrint={print}
          />
        }
      />
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard loading={q.isLoading} label={t('Expired')} value={counts.expired} icon={<CalendarX className="h-4 w-4" />} tone="red" />
        <KpiCard loading={q.isLoading} label={t('Expiring soon')} value={counts.soon} icon={<CalendarClock className="h-4 w-4" />} tone="amber" hint={t('Within :days days', { days: SOON_DAYS })} />
        <KpiCard loading={q.isLoading} label={t('Tracked items')} value={rows.length} icon={<CalendarCheck className="h-4 w-4" />} tone="gray" />
      </div>
      <Tabs
        className="mb-4 w-fit no-print"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'all', label: t('All'), count: rows.length },
          { value: 'expired', label: t('Expired'), count: counts.expired },
          { value: 'soon', label: t('Expiring soon'), count: counts.soon },
          ...(counts.later ? [{ value: 'later' as const, label: t('Valid'), count: counts.later }] : []),
        ]}
      />
      <div ref={ref}>
        <PrintTitle title={title} subtitle={<ReportMeta period={new Date().toLocaleDateString()} generatedAt={q.dataUpdatedAt} />} />
        <LocalTable
          rows={visible}
          columns={columns}
          rowKey={(r) => r.id}
          loading={q.isLoading}
          printAll={printing}
          searchText={(r) => r.name}
          initialSort={{ column: 'days', order: 'asc' }}
          empty={<EmptyState icon={<CalendarCheck className="h-6 w-6 text-emerald-500" />} title={t('Nothing is expiring')} description={t('No food item has expired or is about to expire.')} />}
        />
      </div>
    </div>
  );
}
