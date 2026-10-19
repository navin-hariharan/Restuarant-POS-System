import { useT } from '@/providers/AppProviders';
import { AnnualReport } from '@/components/reports/AnnualReport';

export default function ExpenseReport() {
  const t = useT();
  return (
    <AnnualReport
      endpoint="admin/report-expense"
      title={t('Expense report')}
      description={t('Monthly expenses for the selected year.')}
      seriesLabel={t('Expense amount')}
      fileName="annual_expenses"
      colorIndex={1}
      lowerIsBetter
    />
  );
}
