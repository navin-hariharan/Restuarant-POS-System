import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth, useConfig, useT } from '@/providers/AppProviders';
import { AnnualReport } from '@/components/reports/AnnualReport';
import { FilterSelect } from '@/components/reports/ReportFilters';

type SaleFilters = { tables: { id: number; title: string }[]; methods: { id: number; title: string }[] };

export default function TaxReport() {
  const t = useT();
  const { config } = useConfig();
  const { can } = useAuth();
  const [orderType, setOrderType] = useState('');
  const [method, setMethod] = useState('');
  // sale.filters needs manage_sales or overall_sale_report; only offer the payment filter then.
  const filtersQ = useQuery({
    queryKey: ['sale.filters'],
    queryFn: async () => (await api.get<SaleFilters>('admin/sale.filters', { silent: true })).data,
    enabled: can('manage_sales', 'overall_sale_report'),
  });
  return (
    <AnnualReport
      endpoint="admin/report-tax"
      title={t('Tax report')}
      description={t('Tax collected on completed orders, month by month.')}
      seriesLabel={t('Tax amount')}
      fileName="annual_tax"
      colorIndex={3}
      filters={{ order_type: orderType, payment_method: method }}
      filterControls={
        <>
          <FilterSelect
            label={t('Order type')}
            value={orderType}
            onChange={setOrderType}
            options={(config.order_types ?? []).map((o) => ({ value: o.key, label: t(o.title) }))}
          />
          {filtersQ.data && (
            <FilterSelect
              label={t('Payment method')}
              value={method}
              onChange={setMethod}
              options={filtersQ.data.methods.map((m) => ({ value: m.id, label: m.title }))}
            />
          )}
        </>
      }
    />
  );
}
