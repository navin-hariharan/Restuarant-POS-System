import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import type { AxiosError } from 'axios';
import { toast } from 'sonner';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import type { User } from '@/lib/types';
import { homePath } from '@/nav';
import { canAccess, useAuth, useConfig, useT } from '@/providers/AppProviders';
import { Button } from '@/components/ui';
import { AuthLayout, FormAlert, useCaptcha } from './AuthLayout';
import { PasswordInput } from './Login';

export default function Reset() {
  const t = useT();
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const email = params.get('email');
  const { config } = useConfig();
  const { login } = useAuth();
  const captcha = useCaptcha();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setErrors({});
    setMessage(null);
    if (password !== confirmation) {
      setErrors({ password_confirmation: t('The passwords do not match') });
      return;
    }
    setLoading(true);
    try {
      const extra = await captcha('reset');
      const res = await api.post<{ token?: string; user?: User; message?: string }>(
        'auth/reset',
        { token, password, password_confirmation: confirmation, ...extra },
        { silent: true, skipAuthRedirect: true },
      );
      toast.success(res.data.message ?? t('Password updated successfully'));
      if (res.data.token && res.data.user) {
        login(res.data.token, res.data.user);
        navigate(homePath((...g) => canAccess(res.data.user!, g), config.modes), { replace: true });
      } else {
        navigate('/auth/login', { replace: true });
      }
    } catch (err) {
      const status = (err as AxiosError)?.response?.status;
      if (status === 422) {
        const fe = fieldErrors(err);
        setErrors(fe);
        if (fe.token) setMessage(t('The recovery token is incorrect try again'));
      } else setMessage(errorMessage(err) || t('Something went wrong try again !'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title={t('Choose a new password')}
      subtitle={email ? `${email} · ${t('You will be signed in after saving.')}` : t('You will be signed in after saving.')}
      footer={
        <Link to="/auth/recover" className="tap inline-flex items-center font-semibold underline underline-offset-2">
          {t('Request a new link')}
        </Link>
      }
    >
      {message && <FormAlert>{message}</FormAlert>}
      <form
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <PasswordInput label={t('New password')} autoComplete="new-password" value={password} error={errors.password} help={t('At least 6 characters')} onChange={setPassword} />
        <PasswordInput label={t('Confirm password')} autoComplete="new-password" value={confirmation} error={errors.password_confirmation} onChange={setConfirmation} />
        <Button type="submit" variant="primary" size="lg" className="w-full justify-center" loading={loading} icon={<KeyRound className="h-4 w-4" />}>
          {t('Reset password')}
        </Button>
      </form>
    </AuthLayout>
  );
}
