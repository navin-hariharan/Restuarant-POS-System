import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api, fieldErrors } from '@/lib/api';
import { Button, Modal, Textarea } from '@/components/ui';
import { useT } from '@/providers/AppProviders';

/** Ask for a reason and cancel a sale (POST pos/pos.cancel-orders/{uuid}). */
export function CancelSaleModal({
  sale,
  onClose,
  onDone,
}: {
  sale: { uuid: string; tracking: string | number; completed_at?: string | null } | null;
  onClose: () => void;
  onDone?: () => void;
}) {
  const t = useT();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setReason('');
    setError(undefined);
  }, [sale?.uuid]);

  const submit = async () => {
    if (!sale) return;
    if (!reason.trim()) {
      setError(t('Cancellation reason') + ' *');
      return;
    }
    setBusy(true);
    try {
      const res = await api.post(`pos/pos.cancel-orders/${sale.uuid}`, { is_cancelled: true, cancellation_reason: reason.trim() });
      toast.success(res.data?.message ?? t('Cancelled successfully'));
      onDone?.();
      onClose();
    } catch (e) {
      setError(fieldErrors(e).cancellation_reason);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!sale}
      onClose={onClose}
      size="sm"
      title={t('Cancel order')}
      description={sale ? `${t('Order #')}${sale.tracking}` : undefined}
      footer={
        <>
          <Button onClick={onClose}>{t('Back')}</Button>
          <Button variant="danger" loading={busy} onClick={submit}>
            {t('Cancel order')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-3"
      >
        {sale?.completed_at && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            {t('This order is already checked out. Cancelling it puts the used stock back.')}
          </p>
        )}
        <Textarea
          label={t('Cancellation reason')}
          required
          autoFocus
          value={reason}
          error={error}
          onChange={(e) => {
            setReason(e.target.value);
            setError(undefined);
          }}
        />
      </form>
    </Modal>
  );
}
