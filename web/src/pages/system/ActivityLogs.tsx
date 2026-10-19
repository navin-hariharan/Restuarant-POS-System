import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, listItems, type Paginated } from '@/lib/api';
import { useAuth, useT } from '@/providers/AppProviders';
import { DataTable, PageHeader, SearchInput, TablePagination, useTableQuery, type Column } from '@/components/ui';
import { ReportActions } from '@/components/reports/ReportKit';
import { downloadCsv } from '@/components/reports/export';
import { DeviceCell, shortLink, type ActivityLog } from './logUtils';

export default function ActivityLogs() {
  const t = useT();
  const { can } = useAuth();
  const [user, setUser] = useState('');
  const table = useTableQuery<ActivityLog>('admin/activity-logs', {
    filters: { user: user || undefined },
    defaultSort: { column: 'created_at', order: 'desc' },
    perPageKey: 'activity_logs_per_page',
  });
  const usersQ = useQuery({
    queryKey: ['admin/users', 'all-for-filter'],
    queryFn: async () =>
      listItems((await api.get<Paginated<{ id: number; name: string; email: string }>>('admin/users', { params: { perPage: 500 } })).data),
    enabled: can('manage_users'),
  });

  const columns: Column<ActivityLog>[] = [
    { key: 'created_at', header: t('Date'), sortKey: 'created_at', cell: (l) => <span className="whitespace-nowrap tabular-nums text-slate-500">{l.created_at}</span> },
    { key: 'user', header: t('User'), cell: (l) => <span className="font-medium">{l.user}</span> },
    { key: 'activity', header: t('Activity'), sortKey: 'activity', cell: (l) => <span className="line-clamp-2 min-w-48">{l.activity}</span> },
    {
      key: 'link',
      header: t('Link'),
      cell: (l) =>
        l.link ? (
          <code className="block max-w-56 truncate rounded-sm bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800" title={l.link}>
            {shortLink(l.link)}
          </code>
        ) : null,
    },
    { key: 'ip', header: t('IP address'), sortKey: 'ip', cell: (l) => <span className="font-mono text-xs">{l.ip}</span> },
    { key: 'device', header: t('Device'), cell: (l) => <DeviceCell ua={l.device} /> },
  ];

  return (
    <div>
      <PageHeader
        title={t('User activity logs')}
        description={t('Everything users did in the system, newest first.')}
        actions={
          <ReportActions
            onRefresh={() => table.query.refetch()}
            refreshing={table.query.isFetching}
            disabled={!table.items.length}
            onCsv={() =>
              downloadCsv(
                'activity_logs',
                [t('ID'), t('Date'), t('User'), t('Activity'), t('Link'), t('IP address'), t('Device')],
                table.items.map((l) => [l.id, l.created_at, l.user, l.activity, l.link ?? '', l.ip ?? '', l.device ?? '']),
              )
            }
          />
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <SearchInput
          className="w-full sm:w-72"
          value={table.search}
          onChange={table.setSearch}
          placeholder={t('Search activity, IP, device or link')}
        />
        {usersQ.data && (
          <div className="w-full sm:w-56">
            <label htmlFor="log-user" className="sr-only">
              {t('User')}
            </label>
            <select
              id="log-user"
              className="input"
              value={user}
              onChange={(e) => {
                setUser(e.target.value);
                table.setPage(1);
              }}
            >
              <option value="">{t('All users')}</option>
              {usersQ.data.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <DataTable
        columns={columns}
        rows={table.items}
        rowKey={(l) => l.id}
        loading={table.query.isLoading}
        sort={table.sort}
        onSort={table.setSort}
        footer={<TablePagination table={table} />}
      />
    </div>
  );
}
