import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Landmark, Lock } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button, Checkbox, Input, Modal, Spinner } from '@/components/ui';
import { useConfig, useT } from '@/providers/AppProviders';
import type { Cashbook } from './types';

export const registerKey = ['pos', 'register-check'] as const;

/** POST auth/check → has_open_register (true when cashbooks mode is off). */
export function useRegisterCheck(enabled: boolean) {
  return useQuery({
    queryKey: registerKey,
    queryFn: async () => (await api.post<{ has_open_register: string | boolean | null }>('auth/check', { gate: 'pos_portal' })).data,
    enabled,
    staleTime: 0,
  });
}

/** Full-surface card asking for the opening amount before the POS can be used. */
export function OpenRegister() {
  const t = useT();
  const qc = useQueryClient();
  const [amount, setAmount] = useState('0');
  const open = useMutation({
    mutationFn: async () => (await api.post<{ message: string }>('cashbooks', { opening_amount: Number(amount) || 0 })).data,
    onSuccess: (r) => {
      toast.success(r.message);
      qc.invalidateQueries({ queryKey: registerKey });
    },
  });
  return (
    <div className="flex h-full items-center justify-center bg-slate-50 p-4 dark:bg-slate-950">
      <form
        className="card w-full max-w-sm p-6"
        onSubmit={(e) => {
          e.preventDefault();
          open.mutate();
        }}
      >
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950">
          <Landmark className="h-6 w-6" />
        </div>
        <h1 className="text-lg font-semibold">{t('Open cash register')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('Count the cash in the drawer and enter the opening amount to start selling.')}</p>
        <Input
          wrapperClassName="mt-5"
          label={t('Opening amount')}
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          required
          className="h-12 text-lg"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={t('Put 0 if nothing')}
          autoFocus
        />
        <Button type="submit" variant="primary" size="lg" className="mt-5 w-full" loading={open.isPending}>
          {t('Open')}
        </Button>
      </form>
    </div>
  );
}

/** Current register summary and close action (PATCH cashbooks/{uuid}). */
export function RegisterModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { money } = useConfig();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [agreed, setAgreed] = useState(false);
  const book = useQuery({
    queryKey: ['pos', 'cashbook'],
    queryFn: async () => (await api.get<Cashbook | []>('cashbooks')).data,
    enabled: open,
    staleTime: 0,
  });
  const close = useMutation({
    mutationFn: async (uuid: string) => (await api.patch<{ message: string }>(`cashbooks/${uuid}`)).data,
    onSuccess: (r) => {
      toast.success(r.message);
      qc.invalidateQueries({ queryKey: registerKey });
      onClose();
      navigate('/admin');
    },
  });
  const cb = book.data && !Array.isArray(book.data) && (book.data as Cashbook).uuid ? (book.data as Cashbook) : null;
  const row = (label: string, value: React.ReactNode, strong = false) => (
    <div className={strong ? 'flex justify-between border-t border-slate-200 pt-2 text-base font-semibold dark:border-slate-700' : 'flex justify-between'}>
      <dt className={strong ? '' : 'text-slate-500'}>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
  return (
    <Modal open={open} onClose={onClose} title={t('Cashbook details')} size="md">
      {book.isLoading ? (
        <div className="flex justify-center py-8 text-brand-600"><Spinner className="h-6 w-6" /></div>
      ) : !cb ? (
        <p className="text-sm text-slate-500">{t('No open register')}</p>
      ) : (
        <div className="space-y-4">
          <dl className="space-y-1.5 text-sm">
            {row(t('By'), cb.user)}
            {row(t('Opened at'), cb.created_at)}
            {row(t('Opening amount'), money(cb.opening_amount))}
            {row(t('Total sale amount'), money(cb.sales_amount))}
            {row(t('Total discount amount'), money(cb.discount_amount))}
            {row(t('Total tax amount'), money(cb.tax_amount))}
            {row(t('Total profit amount'), money(cb.total_profit))}
            {row(t('Total expenses'), money(cb.expenses_amount))}
            {row(t('Sale orders'), cb.sales)}
            {row(t('In Progress'), cb.in_progress)}
            {row(t('Completed'), cb.in_completed)}
            {row(t('Cancelled'), cb.in_cancelled)}
            {row(t('Final amount'), money(cb.final_amount), true)}
            <p className="text-xs text-slate-400">({t('opening amount')} + {t('sales amount')} - {t('expenses amount')})</p>
          </dl>
          <div className="flex flex-wrap gap-2">
            <Link className="btn-secondary btn-sm" to={`/admin/cashbook/${cb.uuid}`}>{t('View details')}</Link>
          </div>
          {cb.is_closable ? (
            <div className="space-y-3 rounded-xl border border-red-200 p-3 dark:border-red-900">
              <Checkbox checked={agreed} onChange={setAgreed} label={t('I checked everything to close register')} />
              <Button
                variant="danger"
                className="w-full"
                size="lg"
                icon={<Lock className="h-4 w-4" />}
                disabled={!agreed}
                loading={close.isPending}
                onClick={() => close.mutate(cb.uuid)}
              >
                {t('Close register')}
              </Button>
            </div>
          ) : (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
              <strong>{t('Attention')}:</strong> {t('Please clear all orders in progress')}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
