import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChefHat, Eye, EyeOff, LogIn, ShieldCheck, ShoppingCart } from 'lucide-react';
import type { AxiosError } from 'axios';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import type { User } from '@/lib/types';
import { homePath } from '@/nav';
import { clearAuthNotice, readAuthNotice } from '@/lib/authNotice';
import { canAccess, useAuth, useConfig, useT } from '@/providers/AppProviders';
import { Button, Checkbox, Input } from '@/components/ui';
import { AuthLayout, FormAlert, safeRedirect, useCaptcha } from './AuthLayout';

/** Demo accounts (only offered in demo mode). */
const DEMO_ACCOUNTS = [
  { email: 'admin@admin.com', role: 'Admin', icon: ShieldCheck },
  { email: 'harry@app.com', role: 'Order taker', icon: ShoppingCart },
  { email: 'chef@app.com', role: 'Chef', icon: ChefHat },
];
const DEMO_PASSWORD = '12345678';

const REMEMBER_KEY = 'pos_remember_email';

export function PasswordInput({
  label,
  value,
  onChange,
  error,
  autoComplete,
  id,
  required = true,
  help,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  autoComplete: string;
  id?: string;
  required?: boolean;
  help?: string;
}) {
  const t = useT();
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        label={label}
        type={show ? 'text' : 'password'}
        required={required}
        autoComplete={autoComplete}
        value={value}
        error={error}
        help={help}
        className="pe-10"
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className="absolute inset-e-0 top-6 flex h-[2.375rem] w-10 items-center justify-center rounded-e-lg text-slate-400 hover:text-slate-600 pointer-coarse:h-10 dark:hover:text-slate-200"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? t('Hide password') : t('Show password')}
        aria-pressed={show}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

export default function Login() {
  const t = useT();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { config } = useConfig();
  const { login } = useAuth();
  const captcha = useCaptcha();
  const remembered = (() => {
    try {
      return localStorage.getItem(REMEMBER_KEY) ?? '';
    } catch {
      return '';
    }
  })();
  const [email, setEmail] = useState(remembered);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(!!remembered);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice] = useState(readAuthNotice);
  useEffect(() => clearAuthNotice(), []);

  const submit = async (creds?: { email: string; password: string }) => {
    const body = creds ?? { email, password };
    setLoading(true);
    setErrors({});
    setMessage(null);
    try {
      const extra = await captcha('login');
      const res = await api.post<{ token: string; user: User }>('auth/login', { ...body, ...extra }, { silent: true, skipAuthRedirect: true });
      try {
        if (remember) localStorage.setItem(REMEMBER_KEY, body.email);
        else localStorage.removeItem(REMEMBER_KEY);
      } catch {
        /* storage unavailable */
      }
      const { token, user } = res.data;
      login(token, user);
      const target = safeRedirect(params.get('redirect')) ?? homePath((...g) => canAccess(user, g), config.modes);
      navigate(target, { replace: true });
    } catch (err) {
      const status = (err as AxiosError)?.response?.status;
      if (status === 422) setErrors(fieldErrors(err));
      else if (status === 406) setMessage(errorMessage(err) || t('These credentials do not match, or the user is disabled'));
      else setMessage(errorMessage(err) || t('Something went wrong try again !'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title={t('Sign In')}
      subtitle={t('Welcome back. Sign in to continue.')}
      footer={
        config.register ? (
          <>
            {t("Don't have an account?")}{' '}
            <Link to="/auth/register" className="tap inline-flex items-center font-semibold underline underline-offset-2">
              {t('Create account')}
            </Link>
          </>
        ) : undefined
      }
    >
      {notice && (
        <FormAlert tone="info">
          <p className="font-semibold">{t('The database was restored from a backup.')}</p>
          <p className="mt-1">{t('Sign in with an account that exists in the restored backup. Accounts and passwords from before the restore may no longer work.')}</p>
          {notice.safety && <p className="mt-1 break-all text-xs opacity-80">{t('Safety copy of the previous data')}: {notice.safety}</p>}
        </FormAlert>
      )}
      {message && <FormAlert>{message}</FormAlert>}
      <form
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Input
          label={t('Email')}
          type="email"
          required
          autoComplete="username"
          autoFocus={!remembered}
          value={email}
          error={errors.email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <PasswordInput label={t('Password')} autoComplete="current-password" value={password} error={errors.password} onChange={setPassword} />
        <div className="flex items-center justify-between gap-2">
          <Checkbox label={t('Remember me')} checked={remember} onChange={setRemember} />
          <Link to="/auth/recover" className="tap inline-flex items-center text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">
            {t('Forgot password?')}
          </Link>
        </div>
        <Button type="submit" variant="primary" size="lg" className="w-full justify-center" loading={loading} icon={<LogIn className="h-4 w-4" />}>
          {t('Sign In')}
        </Button>
      </form>
      {config.recaptcha_enabled && (
        <p className="mt-4 text-center text-[11px] leading-snug text-slate-400">
          {t('This site is protected by reCAPTCHA and the Google Privacy Policy and Terms of Service apply.')}
        </p>
      )}
      {config.is_demo_mode && (
        <div className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-800">
          <p className="mb-2 text-center text-xs font-medium uppercase tracking-wide text-slate-500">{t('Demo accounts')}</p>
          <div className="grid grid-cols-3 gap-2">
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.email}
                type="button"
                disabled={loading}
                className="flex flex-col items-center gap-1 rounded-lg border border-slate-200 px-2 py-2.5 text-xs font-medium hover:border-brand-500 hover:bg-brand-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-brand-950"
                onClick={() => {
                  setEmail(a.email);
                  setPassword(DEMO_PASSWORD);
                  submit({ email: a.email, password: DEMO_PASSWORD });
                }}
                title={`${a.email} / ${DEMO_PASSWORD}`}
              >
                <a.icon className="h-4 w-4 text-brand-600" aria-hidden="true" />
                {t(a.role)}
              </button>
            ))}
          </div>
        </div>
      )}
    </AuthLayout>
  );
}
