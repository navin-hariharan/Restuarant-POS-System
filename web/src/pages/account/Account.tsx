import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, KeyRound, Laptop, Moon, Save, Sun, Trash2, Upload } from 'lucide-react';
import type { AxiosError } from 'axios';
import { toast } from 'sonner';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import type { Language, User } from '@/lib/types';
import { useAuth, useConfig, useT, useTheme } from '@/providers/AppProviders';
import { Avatar, avatarUrl } from '@/layout/AppShell';
import { Badge, Button, Card, Input, PageHeader, Textarea } from '@/components/ui';
import { PasswordInput } from '@/pages/auth/Login';

type Profile = { name: string; email: string; phone: string; address: string; company_name: string; company_address: string };

const toProfile = (u: User | null): Profile => ({
  name: u?.name ?? '',
  email: u?.email ?? '',
  phone: u?.phone ?? '',
  address: u?.address ?? '',
  company_name: u?.company_name ?? '',
  company_address: u?.company_address ?? '',
});

function ProfileCard() {
  const t = useT();
  const { user, setUser } = useAuth();
  const [values, setValues] = useState<Profile>(() => toProfile(user));
  const [avatar, setAvatar] = useState<File | null>(null);
  const [useGravatar, setUseGravatar] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof Profile, v: string) => setValues((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    if (!avatar) return setPreview(null);
    const u = URL.createObjectURL(avatar);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [avatar]);

  const initial = toProfile(user);
  const dirty = JSON.stringify(initial) !== JSON.stringify(values) || !!avatar || useGravatar;
  const currentSrc = useGravatar ? user?.gravatar ?? null : preview ?? avatarUrl(user);
  const hasOwnAvatar = !!user?.avatar && user.avatar !== 'gravatar' && !useGravatar;

  const save = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      // Empty strings, never "null": the API stores what it gets.
      for (const [k, v] of Object.entries(values)) fd.append(k, v ?? '');
      if (avatar) fd.append('avatar', avatar);
      else if (useGravatar) fd.append('gravatar', 'true');
      return api.post<{ message: string; user?: User }>('account/update', fd);
    },
    onSuccess: (res) => {
      toast.success(res.data?.message ?? t('Data saved successfully'));
      setErrors({});
      setAvatar(null);
      setUseGravatar(false);
      if (res.data?.user) {
        setUser(res.data.user);
        setValues(toProfile(res.data.user));
      }
    },
    onError: (e) => setErrors(fieldErrors(e)),
  });

  if (!user) return null;
  return (
    <Card title={t('Profile')}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="space-y-5"
      >
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={values.name || user.name} src={currentSrc} size="h-20 w-20" />
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <label className="btn-secondary btn-sm cursor-pointer">
                <Upload className="h-4 w-4" aria-hidden="true" /> {t('Upload photo')}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    e.target.value = '';
                    if (!f) return;
                    if (!f.type.startsWith('image/')) {
                      toast.error(t('Only image type files are accepted'));
                      return;
                    }
                    setAvatar(f);
                    setUseGravatar(false);
                  }}
                />
              </label>
              {(avatar || hasOwnAvatar) && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 className="h-4 w-4" />}
                  onClick={() => {
                    if (avatar) setAvatar(null);
                    else setUseGravatar(true);
                  }}
                >
                  {avatar ? t('Cancel') : t('Use Gravatar')}
                </Button>
              )}
            </div>
            <p className="help mt-0!">{t('Square image (1:1), up to 1 MB.')}</p>
            {errors.avatar && <p className="error-text">{errors.avatar}</p>}
          </div>
          <div className="ms-auto">
            <Badge tone="blue">{user.role?.name}</Badge>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label={t('Name')} required autoComplete="name" value={values.name} error={errors.name} onChange={(e) => set('name', e.target.value)} />
          <Input label={t('Email')} required type="email" autoComplete="email" value={values.email} error={errors.email} onChange={(e) => set('email', e.target.value)} />
          <Input label={t('Phone')} type="tel" autoComplete="tel" value={values.phone} error={errors.phone} onChange={(e) => set('phone', e.target.value)} />
          <Textarea wrapperClassName="sm:col-span-2" label={t('Address')} rows={2} value={values.address} error={errors.address} onChange={(e) => set('address', e.target.value)} />
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
          <Button
            variant="ghost"
            disabled={!dirty || save.isPending}
            onClick={() => {
              setValues(toProfile(user));
              setAvatar(null);
              setUseGravatar(false);
              setErrors({});
            }}
          >
            {t('Reset')}
          </Button>
          <Button type="submit" variant="primary" icon={<Save className="h-4 w-4" />} loading={save.isPending} disabled={!dirty}>
            {t('Save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function PasswordCard() {
  const t = useT();
  const [values, setValues] = useState({ current_password: '', password: '', password_confirmation: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof values, v: string) => setValues((s) => ({ ...s, [k]: v }));
  const save = useMutation({
    mutationFn: async () => {
      if (values.password !== values.password_confirmation) {
        throw Object.assign(new Error('mismatch'), { local: { password_confirmation: t('The passwords do not match') } });
      }
      return api.post('account/password', values, { silent: true });
    },
    onSuccess: (res) => {
      toast.success(res.data?.message ?? t('Password changed successfully'));
      setValues({ current_password: '', password: '', password_confirmation: '' });
      setErrors({});
    },
    onError: (e: any) => {
      if (e?.local) return setErrors(e.local);
      const status = (e as AxiosError)?.response?.status;
      if (status === 422) return setErrors(fieldErrors(e));
      // 406: wrong current password, or same as before.
      const msg = errorMessage(e) || t('Something went wrong try again !');
      if (status === 406) setErrors({ current_password: msg });
      else toast.error(msg);
    },
  });
  return (
    <Card title={t('Change password')}>
      <form
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        {/* Lets password managers attach the new password to the right account. */}
        <input type="text" name="username" autoComplete="username" className="hidden" readOnly value="" aria-hidden="true" tabIndex={-1} />
        <PasswordInput label={t('Current password')} autoComplete="current-password" value={values.current_password} error={errors.current_password} onChange={(v) => set('current_password', v)} />
        <PasswordInput label={t('New password')} autoComplete="new-password" value={values.password} error={errors.password} help={t('At least 6 characters')} onChange={(v) => set('password', v)} />
        <PasswordInput label={t('Confirm password')} autoComplete="new-password" value={values.password_confirmation} error={errors.password_confirmation} onChange={(v) => set('password_confirmation', v)} />
        <div className="flex justify-end">
          <Button
            type="submit"
            variant="primary"
            icon={<KeyRound className="h-4 w-4" />}
            loading={save.isPending}
            disabled={!values.current_password || !values.password}
          >
            {t('Update password')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function PreferencesCard() {
  const t = useT();
  const { theme, setTheme } = useTheme();
  const { config, refresh } = useConfig();
  const qc = useQueryClient();
  const [system, setSystem] = useState(() => {
    try {
      return localStorage.getItem('theme') === null;
    } catch {
      return false;
    }
  });
  const langs = useQuery({ queryKey: ['languages-public'], queryFn: async () => (await api.get<Language[]>('lang')).data, staleTime: 300_000 });
  const [switching, setSwitching] = useState<string | null>(null);

  const pickTheme = (mode: 'light' | 'dark' | 'system') => {
    if (mode === 'system') {
      const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
      setTheme(dark ? 'dark' : 'light');
      try {
        localStorage.removeItem('theme');
      } catch {
        /* ignore */
      }
      setSystem(true);
    } else {
      setTheme(mode);
      setSystem(false);
    }
  };

  const options = [
    { value: 'light' as const, label: t('Light'), icon: Sun },
    { value: 'dark' as const, label: t('Dark'), icon: Moon },
    { value: 'system' as const, label: t('System'), icon: Laptop },
  ];
  const activeTheme = system ? 'system' : theme;

  return (
    <Card title={t('Preferences')}>
      <div className="space-y-5">
        <fieldset>
          <legend className="label">{t('Theme')}</legend>
          <div className="grid grid-cols-3 gap-2">
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                aria-pressed={activeTheme === o.value}
                onClick={() => pickTheme(o.value)}
                className={`flex flex-col items-center gap-1.5 rounded-lg border px-3 py-3 text-sm ${
                  activeTheme === o.value
                    ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                    : 'border-slate-300 hover:border-slate-400 dark:border-slate-700'
                }`}
              >
                <o.icon className="h-5 w-5" aria-hidden="true" />
                {o.label}
              </button>
            ))}
          </div>
          <p className="help">{t('Saved on this device.')}</p>
        </fieldset>
        <fieldset>
          <legend className="label">{t('Language')}</legend>
          {langs.isLoading ? (
            <p className="text-sm text-slate-500">{t('Loading')}…</p>
          ) : (
            <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
              {(langs.data ?? []).map((l) => {
                const active = l.locale === config.locale;
                return (
                  <li key={l.id}>
                    <button
                      type="button"
                      aria-pressed={active}
                      disabled={active || !!switching}
                      onClick={async () => {
                        setSwitching(l.locale);
                        try {
                          await api.post('lang/set-language', { locale: l.locale, direction: l.direction === 'rtl' ? 'rtl' : 'ltr' });
                          await refresh();
                          qc.invalidateQueries({ queryKey: ['lang'] });
                        } finally {
                          setSwitching(null);
                        }
                      }}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-start text-sm hover:bg-slate-50 disabled:cursor-default dark:hover:bg-slate-800/60"
                    >
                      <span>
                        {l.name} <span className="text-xs text-slate-400">({l.locale})</span>
                      </span>
                      {active && <Check className="h-4 w-4 text-brand-600" aria-label={t('Active')} />}
                      {switching === l.locale && <span className="text-xs text-slate-500">{t('Loading')}…</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="help">{t('Changes the interface language of the whole app.')}</p>
        </fieldset>
      </div>
    </Card>
  );
}

export default function Account() {
  const t = useT();
  const { user } = useAuth();
  return (
    <div>
      <PageHeader title={t('My account')} description={user ? `${user.email}` : undefined} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <ProfileCard />
        <div className="space-y-5">
          <PasswordCard />
          <PreferencesCard />
        </div>
      </div>
    </div>
  );
}
