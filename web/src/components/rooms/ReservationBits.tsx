import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Badge, Button, Input, Modal, Textarea } from '@/components/ui';
import { useT } from '@/providers/AppProviders';
import { stageOf, type Customer, type ReservationRow } from './reservation';

export function StageBadge({ r }: { r: Pick<ReservationRow, 'checkin_at' | 'checkout_at'> }) {
  const t = useT();
  const stage = stageOf(r);
  if (stage === 'checked_out') return <Badge tone="gray">{t('Checked out')}</Badge>;
  if (stage === 'checked_in') return <Badge tone="green">{t('Checked in')}</Badge>;
  return <Badge tone="blue">{t('Booked')}</Badge>;
}

export function PaymentBadge({ cleared }: { cleared: boolean }) {
  const t = useT();
  return cleared ? <Badge tone="green">{t('Paid')}</Badge> : <Badge tone="amber">{t('Due')}</Badge>;
}

/** Create or edit a customer from the reservation form. */
export function CustomerModal({
  open,
  onClose,
  customer,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  customer: Customer | null;
  onSaved: (c: Customer) => void;
}) {
  const t = useT();
  const [values, setValues] = useState({ name: '', email: '', phone: '', address: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [lastKey, setLastKey] = useState('');
  const key = `${open}-${customer?.id ?? 'new'}`;
  if (key !== lastKey) {
    setLastKey(key);
    setErrors({});
    setValues({ name: customer?.name ?? '', email: customer?.email ?? '', phone: customer?.phone ?? '', address: customer?.address ?? '' });
  }
  const set = (k: keyof typeof values, v: string) => setValues((s) => ({ ...s, [k]: v }));
  const submit = async () => {
    setSaving(true);
    try {
      const body = { ...values, email: values.email || null, phone: values.phone || null, address: values.address || null };
      if (customer) {
        const res = await api.put(`admin/customers/${customer.uuid}`, body);
        toast.success(res.data?.message ?? t('Data saved successfully'));
        onSaved({ ...customer, ...body } as Customer);
      } else {
        const res = await api.post<{ message: string; customer: Customer }>('admin/customers', body);
        toast.success(res.data?.message ?? t('Data saved successfully'));
        onSaved(res.data.customer);
      }
      onClose();
    } catch (e: any) {
      const errs = e?.response?.data?.errors ?? {};
      setErrors(Object.fromEntries(Object.entries(errs).map(([k, v]) => [k, Array.isArray(v) ? String(v[0]) : String(v)])));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={customer ? t('Edit customer') : t('New customer')}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="primary" type="submit" form="reservation-customer-form" loading={saving}>
            {t('Save')}
          </Button>
        </>
      }
    >
      <form
        id="reservation-customer-form"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          submit();
        }}
      >
        <Input wrapperClassName="sm:col-span-2" label={t('Name')} required value={values.name} error={errors.name} onChange={(e) => set('name', e.target.value)} />
        <Input label={t('Email')} type="email" value={values.email} error={errors.email} onChange={(e) => set('email', e.target.value)} />
        <Input label={t('Phone')} type="tel" value={values.phone} error={errors.phone} onChange={(e) => set('phone', e.target.value)} />
        <Textarea wrapperClassName="sm:col-span-2" label={t('Address')} rows={2} value={values.address} error={errors.address} onChange={(e) => set('address', e.target.value)} />
      </form>
    </Modal>
  );
}
