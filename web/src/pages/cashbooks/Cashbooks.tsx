import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, LockKeyhole, LockKeyholeOpen, Wallet } from 'lucide-react';
import { useConfig, useT } from '@/providers/AppProviders';
import { Badge, DataTable, PageHeader, TablePagination, useTableQuery, type Column } from '@/components/ui';
import { ReportActions } from '@/components/reports/ReportKit';
import { downloadCsv } from '@/components/reports/export';
import type { Cashbook } from './types';

const num = (v: unknown) => Number(v) || 0;

export default function Cashbooks() {
  const t = useT();
  const { money } = useConfig();
  const nav = useNavigate();
  const table = useTableQuery<Cashbook>('admin/cash-books', { defaultSort: { column: 'created_at', order: 'desc' }, perPageKey: 'cashbooks_per_page' });
  const rows = table.items;

  const columns: Column<Cashbook>[] = [
    { key: 'id', header: t('ID'), sortKey: 'id', cell: (c) => <span className="text-slate-500">#{c.id}</span> },
    {
      key: 'user',
      header: t('User'),
      cell: (c) => (
        <div>
          <Link to={`/admin/cashbook/${c.uuid}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
            {c.user}
          </Link>
          <p className="text-xs text-slate-500">{c.created_at}</p>
        </div>
      ),
    },
    {
      key: 'closed',
      header: t('Status'),
      sortKey: 'closed',
      cell: (c) =>
        c.closed ? (
          <Badge tone="gray">
            <LockKeyhole className="h-3 w-3" aria-hidden /> {t('Closed')}
          </Badge>
        ) : (
          <Badge tone="green">
            <LockKeyholeOpen className="h-3 w-3" aria-hidden /> {t('Open')}
          </Badge>
        ),
    },
    {
      key: 'orders',
      header: t('Orders'),
      cell: (c) => (
        <div className="text-xs">
          <span className="font-semibold tabular-nums text-sm">{c.sales}</span>
          {(c.in_progress > 0 || c.in_cancelled > 0) && (
            <span className="ms-1 text-slate-500">
              ({c.in_progress > 0 ? `${c.in_progress} ${t('in progress')}` : ''}
              {c.in_progress > 0 && c.in_cancelled > 0 ? ', ' : ''}
              {c.in_cancelled > 0 ? `${c.in_cancelled} ${t('cancelled')}` : ''})
            </span>
          )}
        </div>
      ),
    },
    { key: 'opening_amount', header: t('Opening amount'), sortKey: 'opening_amount', cell: (c) => money(c.opening_amount), className: 'text-end tabular-nums', headerClassName: 'text-end' },
    { key: 'sales_amount', header: t('Sales amount'), cell: (c) => money(c.sales_amount), className: 'text-end tabular-nums', headerClassName: 'text-end' },
    { key: 'expenses_amount', header: t('Expenses'), cell: (c) => money(c.expenses_amount), className: 'text-end tabular-nums', headerClassName: 'text-end' },
    { key: 'final_amount', header: t('Closing amount'), cell: (c) => <span className="font-semibold">{money(c.final_amount)}</span>, className: 'text-end tabular-nums', headerClassName: 'text-end' },
    {
      key: 'total_profit',
      header: t('Profit'),
      cell: (c) => <span className={num(c.total_profit) < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}>{money(c.total_profit)}</span>,
      className: 'text-end tabular-nums',
      headerClassName: 'text-end',
    },
    { key: 'go', header: <span className="sr-only">{t('View')}</span>, cell: () => <ChevronRight className="h-4 w-4 text-slate-400 rtl:rotate-180" aria-hidden /> },
  ];

  return (
    <div>
      <PageHeader
        title={t('Cashbooks report')}
        description={t('Cash register sessions: who opened them, balances and the sales taken.')}
        actions={
          <ReportActions
            onRefresh={() => table.query.refetch()}
            refreshing={table.query.isFetching}
            disabled={!rows.length}
            onCsv={() =>
              downloadCsv(
                'cashbooks',
                [t('ID'), t('User'), t('Status'), t('Opened at'), t('Updated at'), t('Opening amount'), t('Orders'), t('Sold items'), t('Sales amount'), t('Discount'), t('Tax'), t('Expenses'), t('Closing amount'), t('Profit')],
                rows.map((c) => [c.id, c.user, c.closed ? t('Closed') : t('Open'), c.created_at, c.updated_at, c.opening_amount, c.sales, c.sold_items, c.sales_amount, c.discount_amount, c.tax_amount, c.expenses_amount, c.final_amount, c.total_profit]),
              )
            }
          />
        }
      />
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(c) => c.id}
        loading={table.query.isLoading}
        sort={table.sort}
        onSort={table.setSort}
        onRowClick={(c) => nav(`/admin/cashbook/${c.uuid}`)}
        empty={
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <Wallet className="h-8 w-8 text-slate-300" />
            <p className="text-sm font-medium">{t('No cash registers yet')}</p>
            <p className="max-w-sm text-sm text-slate-500">{t('Registers are opened from the point of sale when cashbook mode is on.')}</p>
          </div>
        }
        footer={<TablePagination table={table} />}
      />
    </div>
  );
}
