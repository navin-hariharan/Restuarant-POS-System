import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, fieldErrors } from '@/lib/api';
import { taxFor, type TaxSetup } from '@/lib/cart';
import { Badge, Button, EmptyState, Input, Modal, Skeleton, Switch, useConfirm } from '@/components/ui';
import { useConfig, useT } from '@/providers/AppProviders';
import { FieldGrid, SettingsPanel } from './SettingsPanel';
import { bool } from './useSettingsForm';

export type Tax = {
  id: number;
  tax_title: string;
  tax_rate: number | string;
  is_vat: boolean;
  is_tax_fix: boolean;
  is_tax_included: boolean;
  tax_id: string | null;
};

type TaxForm = { tax_title: string; tax_rate: string; tax_id: string; is_vat: boolean; is_tax_fix: boolean; is_tax_included: boolean };

const emptyForm: TaxForm = { tax_title: '', tax_rate: '', tax_id: '', is_vat: false, is_tax_fix: false, is_tax_included: false };

/** Short human description of how a tax method applies. */
export function useDescribeTax() {
  const t = useT();
  const { money } = useConfig();
  return (tax: Pick<Tax, 'tax_rate' | 'is_vat' | 'is_tax_fix' | 'is_tax_included'>) => {
    const rate = Number(tax.tax_rate) || 0;
    if (bool(tax.is_vat)) return `${rate}% ${t('VAT')} · ${bool(tax.is_tax_included) ? t('Included in price') : t('Added to price')}`;
    if (bool(tax.is_tax_fix)) return `${money(rate)} ${t('fixed per order')}`;
    return `${rate}% ${t('added to price')}`;
  };
}

function TaxModal({ open, onClose, editing, onSaved }: { open: boolean; onClose: () => void; editing: Tax | null; onSaved: (tax: Tax | null, form: TaxForm) => void }) {
  const t = useT();
  const { money } = useConfig();
  const [form, setForm] = useState<TaxForm>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lastKey, setLastKey] = useState<string>('');
  const key = `${open}-${editing?.id ?? 'new'}`;
  if (key !== lastKey) {
    setLastKey(key);
    setErrors({});
    setForm(
      editing
        ? {
            tax_title: editing.tax_title ?? '',
            tax_rate: String(editing.tax_rate ?? ''),
            tax_id: editing.tax_id ?? '',
            is_vat: bool(editing.is_vat),
            is_tax_fix: bool(editing.is_tax_fix),
            is_tax_included: bool(editing.is_tax_included),
          }
        : emptyForm,
    );
  }
  const set = <K extends keyof TaxForm>(k: K, v: TaxForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        tax_rate: form.tax_rate === '' ? '' : Number(form.tax_rate),
        is_tax_fix: form.is_vat ? false : form.is_tax_fix,
        is_tax_included: form.is_vat ? form.is_tax_included : false,
      };
      return editing ? api.put(`admin/taxes/${editing.id}`, payload) : api.post('admin/taxes', payload);
    },
    onSuccess: (res) => {
      toast.success(res.data?.message ?? t('Data saved successfully'));
      onSaved(editing, form);
      onClose();
    },
    onError: (e) => setErrors(fieldErrors(e)),
  });
  const example = taxFor(100, { tax_rate: form.tax_rate || 0, is_vat: form.is_vat, is_tax_fix: !form.is_vat && form.is_tax_fix, is_tax_included: form.is_vat && form.is_tax_included } as TaxSetup);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? t('Edit tax method') : t('New tax method')}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="primary" type="submit" form="tax-form" loading={save.isPending}>
            {t('Save')}
          </Button>
        </>
      }
    >
      <form
        id="tax-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <FieldGrid>
          <Input label={t('Tax title')} required maxLength={50} value={form.tax_title} error={errors.tax_title} onChange={(e) => set('tax_title', e.target.value)} />
          <Input
            label={!form.is_vat && form.is_tax_fix ? t('Fixed amount') : t('Tax Rate') + ' (%)'}
            required
            type="number"
            step="any"
            min={0}
            value={form.tax_rate}
            error={errors.tax_rate}
            onChange={(e) => set('tax_rate', e.target.value)}
          />
          <Input
            wrapperClassName="sm:col-span-2"
            label={t('Tax ID')}
            value={form.tax_id}
            error={errors.tax_id}
            help={t('Registration number printed on invoices when this is the default tax.')}
            onChange={(e) => set('tax_id', e.target.value)}
          />
        </FieldGrid>
        <fieldset>
          <legend className="label">{t('Calculation')}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { vat: false, title: t('Basic tax'), desc: t('Basic tax calculation will be implemented') },
              { vat: true, title: t('VAT'), desc: t('Vat calculation will be implemented') },
            ].map((o) => (
              <label
                key={String(o.vat)}
                className={`cursor-pointer rounded-lg border p-3 text-sm ${
                  form.is_vat === o.vat ? 'border-brand-500 bg-brand-50 dark:bg-brand-950' : 'border-slate-300 dark:border-slate-700'
                }`}
              >
                <span className="flex items-center gap-2 font-medium">
                  <input type="radio" name="is_vat" className="accent-brand-600" checked={form.is_vat === o.vat} onChange={() => set('is_vat', o.vat)} />
                  {o.title}
                </span>
                <span className="mt-1 block text-xs text-slate-500">{o.desc}</span>
              </label>
            ))}
          </div>
          {errors.is_vat && <p className="error-text">{errors.is_vat}</p>}
        </fieldset>
        <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {form.is_vat ? (
            <Switch
              className="p-3"
              label={t('Is tax included')}
              description={form.is_tax_included ? t('The tax amount will be included') : t('The tax amount will be excluded and added')}
              checked={form.is_tax_included}
              onChange={(v) => set('is_tax_included', v)}
            />
          ) : (
            <Switch
              className="p-3"
              label={t('Fixed amount')}
              description={form.is_tax_fix ? t('The fixed amount will be added') : t('The percentage of amount will be added')}
              checked={form.is_tax_fix}
              onChange={(v) => set('is_tax_fix', v)}
            />
          )}
        </div>
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:bg-slate-800/60 dark:text-slate-300" aria-live="polite">
          {t('Example')}: {t('on an order of')} {money(100)} → {t('tax')} <strong>{money(example)}</strong>
        </p>
      </form>
    </Modal>
  );
}

export default function TaxTab() {
  const t = useT();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { refresh } = useConfig();
  const describe = useDescribeTax();
  const [modal, setModal] = useState<{ open: boolean; editing: Tax | null }>({ open: false, editing: null });
  const [busy, setBusy] = useState<number | null>(null);

  const taxes = useQuery({ queryKey: ['admin/taxes'], queryFn: async () => (await api.get<Tax[]>('admin/taxes')).data });
  const current = useQuery({ queryKey: ['settings', 'admin/setting/tax'], queryFn: async () => (await api.get('admin/setting/tax')).data });
  const defaultId = current.data?.tax_id ? Number(current.data.tax_id) : null;

  const makeDefault = async (tax: Tax, silent = false) => {
    setBusy(tax.id);
    try {
      const res = await api.post('admin/setting/tax', {
        tax_title: tax.tax_title,
        tax_rate: Number(tax.tax_rate) || 0,
        is_vat: bool(tax.is_vat),
        is_tax_fix: bool(tax.is_tax_fix),
        is_tax_included: bool(tax.is_tax_included),
        tax_id: tax.id,
        vat_number: tax.tax_id || null,
      });
      if (!silent) toast.success(res.data?.message ?? t('Tax settings updated successfully'));
      await Promise.allSettled([refresh(), current.refetch()]);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (tax: Tax) => {
    if (!(await confirm({ title: t('Tax method deleting'), message: t('Are you sure you want to delete it?'), danger: true }))) return;
    const res = await api.delete(`admin/taxes/${tax.id}`);
    toast.success(res.data?.message ?? t('Data removed successfully'));
    qc.invalidateQueries({ queryKey: ['admin/taxes'] });
  };

  const onSaved = async (editing: Tax | null, form: TaxForm) => {
    await qc.invalidateQueries({ queryKey: ['admin/taxes'] });
    // Settings keep a copy of the default tax: keep it in sync after editing it.
    if (editing && editing.id === defaultId) {
      await makeDefault(
        {
          ...editing,
          ...form,
          is_tax_fix: form.is_vat ? false : form.is_tax_fix,
          is_tax_included: form.is_vat ? form.is_tax_included : false,
        },
        true,
      );
    }
  };

  const list = taxes.data ?? [];

  return (
    <SettingsPanel
      noForm
      title={t('Tax')}
      description={t('Tax methods available for orders, food items and room reservations. The default applies to every order.')}
      headerActions={
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setModal({ open: true, editing: null })}>
          {t('New tax method')}
        </Button>
      }
    >
      {taxes.isLoading || current.isLoading ? (
        <div className="space-y-2 p-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState title={t('No tax methods yet')} />
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800">
          {list.map((tax) => {
            const isDefault = tax.id === defaultId;
            return (
              <li key={tax.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {tax.tax_title}
                    {isDefault && (
                      <Badge tone="green">
                        <CheckCircle2 className="h-3 w-3" /> {t('Default tax')}
                      </Badge>
                    )}
                    <Badge tone={bool(tax.is_vat) ? 'purple' : 'gray'}>{bool(tax.is_vat) ? t('VAT') : t('Basic')}</Badge>
                  </p>
                  <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                    {describe(tax)}
                    {tax.tax_id ? ` · ${t('Tax ID')}: ${tax.tax_id}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {!isDefault && (
                    <Button size="sm" icon={<Star className="h-4 w-4" />} loading={busy === tax.id} onClick={() => makeDefault(tax)}>
                      {t('Mark as default')}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" aria-label={`${t('Edit')} ${tax.tax_title}`} title={t('Edit')} onClick={() => setModal({ open: true, editing: tax })}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  {tax.id > 1 && !isDefault && (
                    <Button size="sm" variant="ghost" className="text-red-600" aria-label={`${t('Delete')} ${tax.tax_title}`} title={t('Delete')} onClick={() => remove(tax)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <TaxModal open={modal.open} editing={modal.editing} onClose={() => setModal({ open: false, editing: null })} onSaved={onSaved} />
    </SettingsPanel>
  );
}
