import { useQuery } from '@tanstack/react-query';
import { Eye, EyeOff } from 'lucide-react';
import { useState, type ComponentProps } from 'react';
import { api } from '@/lib/api';
import type { Role } from '@/lib/types';
import { formatMoney } from '@/lib/format';
import { Input, Select, Switch } from '@/components/ui';
import { useT } from '@/providers/AppProviders';
import { FieldGrid, SettingsPanel, SettingsSection, ToggleList } from './SettingsPanel';
import { bool, useSettingsForm } from './useSettingsForm';

/** Password-like input with a show/hide toggle (for API secrets). */
export function SecretInput(props: Omit<ComponentProps<typeof Input>, 'type'>) {
  const t = useT();
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={show ? 'text' : 'password'} autoComplete="off" className="pe-10" />
      <button
        type="button"
        className="absolute inset-e-1.5 top-[1.6rem] rounded-sm p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? t('Hide') : t('Show')}
        aria-pressed={show}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------ authentication */

export function AuthenticationTab() {
  const t = useT();
  const form = useSettingsForm<{ app_user_registration: boolean; app_default_role: string }>({
    endpoint: 'admin/setting/authentication',
    select: (d) => ({ app_user_registration: bool(d.app_user_registration), app_default_role: d.app_default_role ? String(d.app_default_role) : '' }),
  });
  const roles = useQuery({
    queryKey: ['settings', 'user-roles'],
    queryFn: async () => (await api.get<Role[]>('admin/setting/user-roles')).data,
  });
  const { values: v, set, errors: e } = form;
  return (
    <SettingsPanel title={t('Authentication')} description={t('Who can create an account from the sign-in page.')} form={form}>
      <SettingsSection>
        <div className="space-y-4">
          <ToggleList>
            <Switch
              className="p-4"
              label={t('User registration')}
              description={t('Show a "Create account" link on the sign-in page.')}
              checked={v.app_user_registration}
              onChange={(x) => set('app_user_registration', x)}
            />
          </ToggleList>
          <Select
            wrapperClassName="max-w-sm"
            label={t('Default role')}
            required
            error={e.app_default_role}
            placeholder={t('Select an option')}
            options={(roles.data ?? []).map((r) => ({ value: String(r.id), label: r.name }))}
            value={v.app_default_role}
            onChange={(x) => set('app_default_role', x.target.value)}
            help={t('Role given to people who register themselves.')}
          />
        </div>
      </SettingsSection>
    </SettingsPanel>
  );
}

/* ------------------------------------------------------------------- captcha */

export function CaptchaTab() {
  const t = useT();
  const form = useSettingsForm<{ recaptcha_enabled: boolean; recaptcha_public: string; recaptcha_private: string }>({
    endpoint: 'admin/setting/captcha',
    select: (d) => ({ recaptcha_enabled: bool(d.recaptcha_enabled), recaptcha_public: d.recaptcha_public ?? '', recaptcha_private: d.recaptcha_private ?? '' }),
  });
  const { values: v, set, errors: e } = form;
  return (
    <SettingsPanel
      title={t('Captcha')}
      description={t('Activate the Google reCaptcha v3 verification in public forms, to avoid sending with robots')}
      form={form}
    >
      <SettingsSection>
        <div className="space-y-4">
          <ToggleList>
            <Switch
              className="p-4"
              label={t('reCaptcha status')}
              description={v.recaptcha_enabled ? t('reCaptcha verification is enabled') : t('reCaptcha verification is disabled')}
              checked={v.recaptcha_enabled}
              onChange={(x) => set('recaptcha_enabled', x)}
            />
          </ToggleList>
          {v.recaptcha_enabled && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300" role="note">
              {t('Use reCAPTCHA v3 keys for this domain. Wrong keys will block every sign-in, including yours.')}
            </p>
          )}
          <FieldGrid>
            <Input
              label={t('reCaptcha site key')}
              required={v.recaptcha_enabled}
              value={v.recaptcha_public}
              error={e.recaptcha_public}
              onChange={(x) => set('recaptcha_public', x.target.value)}
            />
            <SecretInput
              label={t('reCaptcha private key')}
              required={v.recaptcha_enabled}
              value={v.recaptcha_private}
              error={e.recaptcha_private}
              onChange={(x) => set('recaptcha_private', x.target.value)}
            />
          </FieldGrid>
        </div>
      </SettingsSection>
    </SettingsPanel>
  );
}

/* ------------------------------------------------------------------ currency */

export function CurrencyTab() {
  const t = useT();
  const form = useSettingsForm<{ currency_symbol: string; currency_symbol_on_left: boolean }>({
    endpoint: 'admin/setting/currency',
    select: (d) => ({ currency_symbol: d.currency_symbol ?? '', currency_symbol_on_left: bool(d.currency_symbol_on_left) }),
  });
  const { values: v, set, errors: e } = form;
  return (
    <SettingsPanel title={t('Currency')} description={t('How amounts are displayed on screens and receipts.')} form={form}>
      <SettingsSection>
        <FieldGrid>
          <Input
            label={t('Currency symbol')}
            required
            maxLength={10}
            value={v.currency_symbol}
            error={e.currency_symbol}
            onChange={(x) => set('currency_symbol', x.target.value)}
          />
          <fieldset>
            <legend className="label">{t('Symbol position')}</legend>
            <div className="flex gap-2">
              {[true, false].map((left) => (
                <label
                  key={String(left)}
                  className={`tap flex flex-1 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                    v.currency_symbol_on_left === left
                      ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                      : 'border-slate-300 dark:border-slate-700'
                  }`}
                >
                  <input
                    type="radio"
                    name="currency_symbol_on_left"
                    className="accent-brand-600"
                    checked={v.currency_symbol_on_left === left}
                    onChange={() => set('currency_symbol_on_left', left)}
                  />
                  {left ? t('Left') : t('Right')}
                  <span className="ms-auto font-mono text-xs text-slate-500">
                    {formatMoney(1234.5, { currency_symbol: v.currency_symbol, currency_symbol_on_left: left })}
                  </span>
                </label>
              ))}
            </div>
            {e.currency_symbol_on_left && <p className="error-text">{e.currency_symbol_on_left}</p>}
          </fieldset>
        </FieldGrid>
      </SettingsSection>
    </SettingsPanel>
  );
}

/* --------------------------------------------------------------- outgoing mail */

type Mail = {
  mail_mailer: string;
  mail_from_address: string;
  mail_from_name: string;
  queue_connection: string;
  mail_host: string;
  mail_port: string;
  mail_username: string;
  mail_password: string;
  mail_encryption: string;
  mailgun_domain: string;
  mailgun_secret: string;
  mailgun_endpoint: string;
};

export function MailTab() {
  const t = useT();
  const form = useSettingsForm<Mail>({
    endpoint: 'admin/setting/outgoing/mail',
    select: (r) => {
      const d = r?.data ?? {};
      const s = (k: string) => (d[k] === null || d[k] === undefined ? '' : String(d[k]));
      return {
        mail_mailer: s('mail_mailer') || 'smtp',
        mail_from_address: s('mail_from_address'),
        mail_from_name: s('mail_from_name'),
        queue_connection: s('queue_connection') || 'sync',
        mail_host: s('mail_host'),
        mail_port: s('mail_port'),
        mail_username: s('mail_username'),
        mail_password: s('mail_password'),
        mail_encryption: s('mail_encryption'),
        mailgun_domain: s('mailgun_domain'),
        mailgun_secret: s('mailgun_secret'),
        mailgun_endpoint: s('mailgun_endpoint') || 'api.mailgun.net',
      };
    },
  });
  const { values: v, set, errors: e } = form;
  const commands: string[] = [form.raw?.command_1, form.raw?.command_2].filter(Boolean);
  return (
    <SettingsPanel title={t('Outgoing mail')} description={t('How the app sends receipts, password resets and notifications.')} form={form}>
      <SettingsSection title={t('Sender')}>
        <FieldGrid>
          <Select
            label={t('Outgoing mail method')}
            required
            error={e.mail_mailer}
            value={v.mail_mailer}
            options={[
              { value: 'smtp', label: t('SMTP') },
              { value: 'mailgun', label: t('Mailgun') },
              { value: 'sendmail', label: t('SendMail') },
              { value: 'log', label: t('Log (Email will be saved to error log)') },
            ]}
            onChange={(x) => set('mail_mailer', x.target.value)}
          />
          <Select
            label={t('Processing')}
            required
            error={e.queue_connection}
            value={v.queue_connection}
            options={[
              { value: 'sync', label: t('Send synchronously') },
              { value: 'database', label: t('Should be queued to database and process latter') },
            ]}
            onChange={(x) => set('queue_connection', x.target.value)}
          />
          <Input
            label={t('From address')}
            type="email"
            required
            value={v.mail_from_address}
            error={e.mail_from_address}
            help={t('All outgoing application emails will be sent from this email address')}
            onChange={(x) => set('mail_from_address', x.target.value)}
          />
          <Input
            label={t('From name')}
            required
            value={v.mail_from_name}
            error={e.mail_from_name}
            help={t('All outgoing application emails will be sent using this name')}
            onChange={(x) => set('mail_from_name', x.target.value)}
          />
        </FieldGrid>
        {v.queue_connection === 'database' && commands.length > 0 && (
          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
            <p className="font-medium">{t('Use this command for configuring cron jobs')}</p>
            {commands.map((c, i) => (
              <div key={c}>
                {i > 0 && <p className="my-1 text-xs text-slate-500">{t('OR')}</p>}
                <code className="block overflow-x-auto whitespace-nowrap rounded-sm bg-slate-950 px-2 py-1.5 font-mono text-xs text-slate-100">* * * * * {c}</code>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>
      {v.mail_mailer === 'smtp' && (
        <SettingsSection title={t('SMTP')}>
          <FieldGrid>
            <Input label={t('SMTP Host')} required value={v.mail_host} error={e.mail_host} onChange={(x) => set('mail_host', x.target.value)} />
            <Input label={t('SMTP Port')} required inputMode="numeric" value={v.mail_port} error={e.mail_port} onChange={(x) => set('mail_port', x.target.value)} />
            <Input label={t('SMTP Username')} required autoComplete="off" value={v.mail_username} error={e.mail_username} onChange={(x) => set('mail_username', x.target.value)} />
            <SecretInput label={t('SMTP Password')} required value={v.mail_password} error={e.mail_password} onChange={(x) => set('mail_password', x.target.value)} />
            <Select
              label={t('Encryption')}
              required
              error={e.mail_encryption}
              placeholder={t('Select an option')}
              value={v.mail_encryption}
              options={[
                { value: 'tls', label: 'TLS' },
                { value: 'ssl', label: 'SSL' },
              ]}
              onChange={(x) => set('mail_encryption', x.target.value)}
            />
          </FieldGrid>
        </SettingsSection>
      )}
      {v.mail_mailer === 'mailgun' && (
        <SettingsSection title={t('Mailgun')}>
          <FieldGrid>
            <Input label={t('Mailgun domain')} required value={v.mailgun_domain} error={e.mailgun_domain} onChange={(x) => set('mailgun_domain', x.target.value)} />
            <SecretInput label={t('Mailgun secret')} required value={v.mailgun_secret} error={e.mailgun_secret} onChange={(x) => set('mailgun_secret', x.target.value)} />
            <Select
              label={t('Mailgun endpoint')}
              required
              error={e.mailgun_endpoint}
              value={v.mailgun_endpoint}
              options={[
                { value: 'api.mailgun.net', label: 'api.mailgun.net (US)' },
                { value: 'api.eu.mailgun.net', label: 'api.eu.mailgun.net (EU)' },
              ]}
              onChange={(x) => set('mailgun_endpoint', x.target.value)}
            />
          </FieldGrid>
        </SettingsSection>
      )}
    </SettingsPanel>
  );
}

/* ---------------------------------------------------------------- SMS gateway */

type Sms = {
  sms_status: boolean;
  sms_channel: string;
  vonage_key: string;
  vonage_secret: string;
  vonage_from: string;
  twilio_account_sid: string;
  twilio_auth_token: string;
  twilio_from: string;
};

export function SmsTab() {
  const t = useT();
  const form = useSettingsForm<Sms>({
    endpoint: 'admin/setting/sms',
    select: (d) => ({
      sms_status: bool(d.sms_status),
      sms_channel: d.sms_channel ?? '',
      vonage_key: d.vonage_key ?? '',
      vonage_secret: d.vonage_secret ?? '',
      vonage_from: d.vonage_from ?? '',
      twilio_account_sid: d.twilio_account_sid ?? '',
      twilio_auth_token: d.twilio_auth_token ?? '',
      twilio_from: d.twilio_from ?? '',
    }),
  });
  const { values: v, set, errors: e } = form;
  return (
    <SettingsPanel title={t('SMS gateway')} description={t('Text customers order updates using Vonage (Nexmo) or Twilio.')} form={form}>
      <SettingsSection>
        <div className="space-y-4">
          <ToggleList>
            <Switch
              className="p-4"
              label={t('SMS notifications')}
              description={t('Send order notifications by SMS when the customer has a phone number.')}
              checked={v.sms_status}
              onChange={(x) => set('sms_status', x)}
            />
          </ToggleList>
          <fieldset disabled={!v.sms_status} className="space-y-4 disabled:opacity-60">
            <Select
              wrapperClassName="max-w-sm"
              label={t('SMS channel')}
              required={v.sms_status}
              error={e.sms_channel}
              placeholder={t('Select an option')}
              value={v.sms_channel}
              options={[
                { value: 'nexmo', label: 'Vonage (Nexmo)' },
                { value: 'twilio', label: 'Twilio' },
              ]}
              onChange={(x) => set('sms_channel', x.target.value)}
            />
            {v.sms_channel === 'nexmo' && (
              <FieldGrid>
                <Input label={t('Vonage key')} required value={v.vonage_key} error={e.vonage_key} onChange={(x) => set('vonage_key', x.target.value)} />
                <SecretInput label={t('Vonage secret')} required value={v.vonage_secret} error={e.vonage_secret} onChange={(x) => set('vonage_secret', x.target.value)} />
                <Input label={t('Sender (from)')} required value={v.vonage_from} error={e.vonage_from} onChange={(x) => set('vonage_from', x.target.value)} />
              </FieldGrid>
            )}
            {v.sms_channel === 'twilio' && (
              <FieldGrid>
                <Input label={t('Twilio account SID')} required value={v.twilio_account_sid} error={e.twilio_account_sid} onChange={(x) => set('twilio_account_sid', x.target.value)} />
                <SecretInput label={t('Twilio auth token')} required value={v.twilio_auth_token} error={e.twilio_auth_token} onChange={(x) => set('twilio_auth_token', x.target.value)} />
                <Input label={t('Sender (from)')} required type="tel" value={v.twilio_from} error={e.twilio_from} onChange={(x) => set('twilio_from', x.target.value)} help={t('Twilio phone number, e.g. +15005550006')} />
              </FieldGrid>
            )}
          </fieldset>
        </div>
      </SettingsSection>
    </SettingsPanel>
  );
}

/* ----------------------------------------------------------- WhatsApp gateway */

type Wa = { wa_status: boolean; wa_twilio_account_sid: string; wa_twilio_auth_token: string; wa_twilio_from: string };

export function WhatsAppTab() {
  const t = useT();
  const form = useSettingsForm<Wa>({
    endpoint: 'admin/setting/wa',
    select: (d) => ({
      wa_status: bool(d.wa_status),
      wa_twilio_account_sid: d.wa_twilio_account_sid ?? '',
      wa_twilio_auth_token: d.wa_twilio_auth_token ?? '',
      wa_twilio_from: d.wa_twilio_from ?? '',
    }),
  });
  const { values: v, set, errors: e } = form;
  return (
    <SettingsPanel title={t('WhatsApp gateway')} description={t('Send order notifications over WhatsApp through Twilio.')} form={form}>
      <SettingsSection>
        <div className="space-y-4">
          <ToggleList>
            <Switch
              className="p-4"
              label={t('WhatsApp notifications')}
              description={t('Send order notifications on WhatsApp when the customer has a phone number.')}
              checked={v.wa_status}
              onChange={(x) => set('wa_status', x)}
            />
          </ToggleList>
          <FieldGrid>
            <Input label={t('Twilio account SID')} required value={v.wa_twilio_account_sid} error={e.wa_twilio_account_sid} onChange={(x) => set('wa_twilio_account_sid', x.target.value)} />
            <SecretInput label={t('Twilio auth token')} required value={v.wa_twilio_auth_token} error={e.wa_twilio_auth_token} onChange={(x) => set('wa_twilio_auth_token', x.target.value)} />
            <Input
              label={t('WhatsApp sender (from)')}
              required
              value={v.wa_twilio_from}
              error={e.wa_twilio_from}
              onChange={(x) => set('wa_twilio_from', x.target.value)}
              help={t('Twilio WhatsApp number, e.g. +14155238886')}
            />
          </FieldGrid>
        </div>
      </SettingsSection>
    </SettingsPanel>
  );
}
