import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import type { AxiosError } from 'axios';
import { toast } from 'sonner';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import type { User } from '@/lib/types';
import { homePath } from '@/nav';
import { canAccess, useAuth, useConfig, useT } from '@/providers/AppProviders';
import { Button, Input } from '@/components/ui';
import { AuthLayout, FormAlert, useCaptcha } from './AuthLayout';
import { PasswordInput } from './Login';

export default function Register() {
  const t = useT();
  const navigate = useNavigate();
  const { config } = useConfig();
  const { login } = useAuth();
  const captcha = useCaptcha();
  const [form, setForm] = useState({ name: '', email: '', password: '', password_confirmation: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const backToLogin = (
    <Link to="/auth/login" className="tap inline-flex items-center font-semibold underline underline-offset-2">
      {t('Back to sign in')}
    </Link>
  );

  if (!config.register) {
    return (
      <AuthLayout title={t('Create account')} footer={backToLogin}>
        <FormAlert>{t('Registration is disabled. Ask an administrator to create an account for you.')}</FormAlert>
      </AuthLayout>
    );
  }

  const submit = async () => {
    setErrors({});
    setMessage(null);
    if (form.password !== form.password_confirmation) {
      setErrors({ password_confirmation: t('The passwords do not match') });
      return;
    }
    setLoading(true);
    try {
      const extra = await captcha('register');
      const res = await api.post<{ token: string; user: User; message?: string }>('auth/register', { ...form, ...extra }, { silent: true, skipAuthRedirect: true });
      if (res.data.token && res.data.user) {
        toast.success(res.data.message ?? t('Your registration successful'));
        login(res.data.token, res.data.user);
        navigate(homePath((...g) => canAccess(res.data.user, g), config.modes), { replace: true });
      } else {
        setMessage(res.data.message ?? null);
      }
    } catch (err) {
      if ((err as AxiosError)?.response?.status === 422) setErrors(fieldErrors(err));
      else setMessage(errorMessage(err) || t('Something went wrong try again !'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title={t('Create account')} subtitle={t('Fill in your details to get started.')} footer={<>{t('Already have an account?')} {backToLogin}</>}>
      {message && <FormAlert>{message}</FormAlert>}
      <form
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Input label={t('Name')} required autoComplete="name" autoFocus value={form.name} error={errors.name} onChange={(e) => set('name', e.target.value)} />
        <Input label={t('Email')} type="email" required autoComplete="email" value={form.email} error={errors.email} onChange={(e) => set('email', e.target.value)} />
        <PasswordInput
          label={t('Password')}
          autoComplete="new-password"
          value={form.password}
          error={errors.password}
          help={t('At least 6 characters')}
          onChange={(v) => set('password', v)}
        />
        <PasswordInput
          label={t('Confirm password')}
          autoComplete="new-password"
          value={form.password_confirmation}
          error={errors.password_confirmation}
          onChange={(v) => set('password_confirmation', v)}
        />
        <Button type="submit" variant="primary" size="lg" className="w-full justify-center" loading={loading} icon={<UserPlus className="h-4 w-4" />}>
          {t('Register')}
        </Button>
      </form>
    </AuthLayout>
  );
}
