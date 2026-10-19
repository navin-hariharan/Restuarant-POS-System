import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History, Link2, MapPin } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth, useT } from '@/providers/AppProviders';
import { EmptyState, PageHeader, SearchInput, Skeleton } from '@/components/ui';
import { ReportActions } from '@/components/reports/ReportKit';
import { DeviceCell, shortLink, type ActivityLog } from './logUtils';

export default function MyLogs() {
  const t = useT();
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const q = useQuery({
    queryKey: ['my-activity-logs'],
    queryFn: async () => (await api.get<ActivityLog[]>('admin/my-activity-logs')).data,
  });

  // The endpoint returns the latest 50 entries; keep only the signed-in user's rows.
  const logs = useMemo(() => {
    const mine = (q.data ?? []).filter((l) => !user || l.user === user.name);
    const s = search.trim().toLowerCase();
    return s ? mine.filter((l) => `${l.activity} ${l.ip ?? ''} ${l.link ?? ''} ${l.device ?? ''}`.toLowerCase().includes(s)) : mine;
  }, [q.data, user, search]);

  const groups = useMemo(() => {
    const m = new Map<string, ActivityLog[]>();
    for (const l of logs) {
      const day = String(l.created_at).split(/[ ,T]/)[0];
      m.set(day, [...(m.get(day) ?? []), l]);
    }
    return [...m.entries()];
  }, [logs]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={t('My activity logs')}
        description={t('Your most recent actions in the system.')}
        actions={<ReportActions onRefresh={() => q.refetch()} refreshing={q.isFetching} />}
      />
      <SearchInput className="mb-4" value={search} onChange={setSearch} placeholder={t('Search')} />
      {q.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : !logs.length ? (
        <div className="card">
          <EmptyState icon={<History className="h-6 w-6" />} title={t('No activity yet')} />
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(([day, items]) => (
            <section key={day} aria-label={day}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{day}</h2>
              <ol className="relative space-y-3 border-s border-slate-200 ps-5 dark:border-slate-800">
                {items.map((l) => (
                  <li key={l.id} className="relative">
                    <span className="absolute inset-s-[-25px] top-4 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand-500 dark:border-slate-950" aria-hidden />
                    <div className="card p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="text-sm font-medium">{l.activity}</p>
                        <time className="whitespace-nowrap text-xs tabular-nums text-slate-500">{l.created_at}</time>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                        {l.ip && (
                          <span className="inline-flex items-center gap-1 font-mono">
                            <MapPin className="h-3.5 w-3.5" aria-hidden /> {l.ip}
                          </span>
                        )}
                        <DeviceCell ua={l.device} />
                        {l.link && (
                          <span className="inline-flex min-w-0 items-center gap-1" title={l.link}>
                            <Link2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            <span className="truncate font-mono">{shortLink(l.link)}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
