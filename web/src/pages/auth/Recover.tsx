import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MailCheck, Send } from 'lucide-react';
import type { AxiosError } from 'axios';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { useT } from '@/providers/AppProviders';
import { Button, Input } from '@/components/ui';
import { AuthLayout, FormAlert, useCaptcha } from './AuthLayout';

export default function Recover() {
  const t = useT();
  const captcha = useCaptcha();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(undefined);
    setMessage(null);
    setLoading(true);
    try {
      const extra = await captcha('recover');
      const res = await api.post('auth/recover', { email, ...extra }, { silent: true, skipAuthRedirect: true });
      setSent(res.data?.message ?? t('An email has been sent with the password reset link'));
    } catch (err) {
      const status = (err as AxiosError)?.response?.status;
      if (status === 422) setError(fieldErrors(err).email);
      else setMessage(errorMessage(err) || t('Something went wrong try again !'));
    } finally {
      setLoading(false);
    }
  };

  const footer = (
    <Link to="/auth/login" className="tap inline-flex items-center font-semibold underline underline-offset-2">
      {t('Back to sign in')}
    </Link>
  );

  if (sent) {
    return (
      <AuthLayout title={t('Check your email')} footer={footer}>
        <div className="flex flex-col items-center gap-3 text-center">
          <MailCheck className="h-10 w-10 text-emerald-500" aria-hidden="true" />
          <p className="text-sm text-slate-600 dark:text-slate-300" role="status">
            {sent}
          </p>
          <p className="text-xs text-slate-500">{email}</p>
          <Button variant="ghost" onClick={() => setSent(null)}>
            {t('Use a different email')}
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t('Reset password')} subtitle={t("Enter your account email and we'll send you a reset link.")} footer={footer}>
      {message && <FormAlert>{message}</FormAlert>}
      <form
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Input label={t('Email')} type="email" required autoComplete="email" autoFocus value={email} error={error} onChange={(e) => setEmail(e.target.value)} />
        <Button type="submit" variant="primary" size="lg" className="w-full justify-center" loading={loading} icon={<Send className="h-4 w-4" />}>
          {t('Send reset link')}
        </Button>
      </form>
    </AuthLayout>
  );
}
