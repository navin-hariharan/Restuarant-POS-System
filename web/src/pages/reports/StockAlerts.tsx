import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CircleSlash, PackageCheck, PackageX, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth, useConfig, useT } from '@/providers/AppProviders';
import { Badge, EmptyState, PageHeader } from '@/components/ui';
import { KpiCard, PrintTitle, ReportActions, ReportMeta } from '@/components/reports/ReportKit';
import { LocalTable, type LocalColumn } from '@/components/reports/LocalTable';
import { downloadCsv } from '@/components/reports/export';
import { usePrintReport } from '@/components/reports/usePrintReport';

type Ingredient = {
  id: number;
  name: string;
  price: number | string;
  cost: number | string;
  quantity: number | string;
  alert_quantity: number | string;
  unit: string | null;
  description?: string | null;
};

const num = (v: unknown) => Number(v) || 0;

export default function StockAlerts() {
  const t = useT();
  const { money } = useConfig();
  const { can } = useAuth();
  const q = useQuery({
    queryKey: ['stock-alerts'],
    queryFn: async () => (await api.get<Ingredient[]>('admin/stock-alerts')).data,
  });
  const rows = q.data ?? [];
  const title = t('Stock alerts');
  const { ref, printing, print } = usePrintReport(title);
  const out = rows.filter((r) => num(r.quantity) <= 0).length;
  const restockCost = useMemo(
    () => rows.reduce((s, r) => s + Math.max(0, num(r.alert_quantity) - num(r.quantity)) * num(r.cost), 0),
    [rows],
  );

  const columns: LocalColumn<Ingredient>[] = [
    {
      key: 'name',
      header: t('Ingredient'),
      sortValue: (r) => r.name,
      cell: (r) => (
        <div>
          <p className="font-medium">{r.name}</p>
          {r.description ? <p className="max-w-xs truncate text-xs text-slate-500">{r.description}</p> : null}
        </div>
      ),
    },
    {
      key: 'status',
      header: t('Status'),
      sortValue: (r) => num(r.quantity) / Math.max(1, num(r.alert_quantity)),
      cell: (r) =>
        num(r.quantity) <= 0 ? (
          <Badge tone="red">
            <PackageX className="h-3 w-3" aria-hidden /> {t('Out of stock')}
          </Badge>
        ) : (
          <Badge tone="amber">
            <TriangleAlert className="h-3 w-3" aria-hidden /> {t('Low stock')}
          </Badge>
        ),
    },
    {
      key: 'quantity',
      header: t('In stock'),
      sortValue: (r) => num(r.quantity),
      cell: (r) => {
        const pct = Math.max(0, Math.min(100, (num(r.quantity) / Math.max(num(r.alert_quantity), 1)) * 100));
        return (
          <div className="min-w-36">
            <div className="flex justify-between text-xs">
              <span className="font-semibold tabular-nums">
                {num(r.quantity).toLocaleString()} {r.unit ?? ''}
              </span>
              <span className="text-slate-500 tabular-nums">
                / {num(r.alert_quantity).toLocaleString()}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" role="presentation">
              <div className={`h-full rounded-full ${num(r.quantity) <= 0 ? 'bg-red-500' : 'bg-amber-500'}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      },
    },
    { key: 'alert_quantity', header: t('Alert quantity'), sortValue: (r) => num(r.alert_quantity), cell: (r) => `${num(r.alert_quantity).toLocaleString()} ${r.unit ?? ''}`, className: 'text-end tabular-nums', headerClassName: 'text-end' },
    { key: 'shortfall', header: t('Shortfall'), sortValue: (r) => num(r.alert_quantity) - num(r.quantity), cell: (r) => `${Math.max(0, num(r.alert_quantity) - num(r.quantity)).toLocaleString()} ${r.unit ?? ''}`, className: 'text-end tabular-nums', headerClassName: 'text-end' },
    { key: 'cost', header: t('Cost'), sortValue: (r) => num(r.cost), cell: (r) => money(r.cost), className: 'text-end tabular-nums', headerClassName: 'text-end' },
  ];

  return (
    <div>
      <PageHeader
        title={title}
        description={t('Ingredients whose quantity has fallen below their alert quantity.')}
        actions={
          <ReportActions
            onRefresh={() => q.refetch()}
            refreshing={q.isFetching}
            disabled={!rows.length}
            onCsv={() =>
              downloadCsv(
                'stock_alerts',
                [t('ID'), t('Name'), t('Quantity'), t('Alert quantity'), t('Unit'), t('Cost'), t('Price')],
                rows.map((r) => [r.id, r.name, r.quantity, r.alert_quantity, r.unit ?? '', r.cost, r.price]),
              )
            }
            onPrint={print}
          >
            {can('manage_ingredients') && (
              <Link to="/admin/ingredients" className="btn-secondary">
                {t('Manage ingredients')}
              </Link>
            )}
          </ReportActions>
        }
      />
      <div ref={ref} className="space-y-5">
        <PrintTitle title={title} subtitle={<ReportMeta period={t('Current stock')} generatedAt={q.dataUpdatedAt} />} />
        <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 xl:grid-cols-4">
          <KpiCard loading={q.isLoading} label={t('Alerts')} value={rows.length} icon={<TriangleAlert className="h-4 w-4" />} tone="amber" />
          <KpiCard loading={q.isLoading} label={t('Out of stock')} value={out} icon={<CircleSlash className="h-4 w-4" />} tone="red" />
          <KpiCard loading={q.isLoading} label={t('Low stock')} value={rows.length - out} icon={<PackageX className="h-4 w-4" />} tone="amber" />
          <KpiCard loading={q.isLoading} label={t('Estimated restock cost')} value={money(restockCost)} icon={<PackageCheck className="h-4 w-4" />} tone="blue" hint={t('Up to alert quantity')} />
        </div>
        <LocalTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          loading={q.isLoading}
          printAll={printing}
          searchText={(r) => r.name}
          initialSort={{ column: 'status', order: 'asc' }}
          empty={<EmptyState icon={<PackageCheck className="h-6 w-6 text-emerald-500" />} title={t('All stocked up')} description={t('No ingredient is below its alert quantity.')} />}
        />
      </div>
    </div>
  );
}
