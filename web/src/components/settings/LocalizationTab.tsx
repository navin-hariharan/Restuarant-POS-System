import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Language } from '@/lib/types';
import { Input, Select } from '@/components/ui';
import { useConfig, useT } from '@/providers/AppProviders';
import { FieldGrid, SettingsPanel, SettingsSection } from './SettingsPanel';
import { useSettingsForm } from './useSettingsForm';

type Localization = {
  app_locale: string;
  app_direction: string;
  app_timezone: string;
  app_date_format: string;
  app_date_locale: string;
};

/** Render a PHP date() format with a fixed sample date so people can pick by example. */
export function phpDateSample(format: string, d = new Date(2026, 2, 7, 14, 5, 9)): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const map: Record<string, string> = {
    d: p(d.getDate()),
    j: String(d.getDate()),
    D: days[d.getDay()].slice(0, 3),
    l: days[d.getDay()],
    m: p(d.getMonth() + 1),
    n: String(d.getMonth() + 1),
    M: months[d.getMonth()].slice(0, 3),
    F: months[d.getMonth()],
    Y: String(d.getFullYear()),
    y: String(d.getFullYear()).slice(2),
    H: p(d.getHours()),
    G: String(d.getHours()),
    h: p(d.getHours() % 12 || 12),
    g: String(d.getHours() % 12 || 12),
    i: p(d.getMinutes()),
    s: p(d.getSeconds()),
    A: d.getHours() < 12 ? 'AM' : 'PM',
    a: d.getHours() < 12 ? 'am' : 'pm',
  };
  let out = '';
  for (let i = 0; i < format.length; i++) {
    const c = format[i];
    if (c === '\\' && i + 1 < format.length) {
      out += format[++i];
      continue;
    }
    out += map[c] ?? c;
  }
  return out;
}

export default function LocalizationTab() {
  const t = useT();
  const qc = useQueryClient();
  const { config } = useConfig();
  const form = useSettingsForm<Localization>({
    endpoint: 'admin/setting/localization',
    select: (d) => ({
      app_locale: d?.data?.app_locale ?? 'en',
      app_direction: d?.data?.app_direction === 'rtl' ? 'rtl' : 'ltr',
      app_timezone: d?.data?.app_timezone ?? 'UTC',
      app_date_format: d?.data?.app_date_format ?? '',
      app_date_locale: d?.data?.app_date_locale ?? 'en',
    }),
    onSaved: () => qc.invalidateQueries({ queryKey: ['lang'] }),
  });
  const languages = useQuery({
    queryKey: ['settings', 'languages'],
    queryFn: async () => (await api.get<Language[]>('admin/setting/languages')).data,
  });
  const timezones: string[] = form.raw?.timezones ?? [];
  const formats = useMemo(() => {
    const list = [...(config.time_date_formats ?? [])];
    if (form.values.app_date_format && !list.includes(form.values.app_date_format)) list.unshift(form.values.app_date_format);
    return list;
  }, [config.time_date_formats, form.values.app_date_format]);
  const { values: v, set, errors: e } = form;

  return (
    <SettingsPanel title={t('Localization')} description={t('Language, writing direction, time zone and date display.')} form={form}>
      <SettingsSection title={t('Language')}>
        <FieldGrid>
          <Select
            label={t('Language')}
            required
            error={e.app_locale}
            value={v.app_locale}
            options={(languages.data ?? []).map((l) => ({ value: l.locale, label: `${l.name} (${l.locale})` }))}
            onChange={(x) => {
              const lang = languages.data?.find((l) => l.locale === x.target.value);
              form.setMany({ app_locale: x.target.value, ...(lang?.direction === 'rtl' ? { app_direction: 'rtl' } : lang ? { app_direction: 'ltr' } : {}) });
            }}
            help={t('Interface language for everyone. Manage translations under Languages.')}
          />
          <fieldset>
            <legend className="label">{t('Direction')}</legend>
            <div className="flex gap-2" role="radiogroup">
              {[
                { value: 'ltr', label: t('Left to right (LTR)') },
                { value: 'rtl', label: t('Right to left (RTL)') },
              ].map((o) => (
                <label
                  key={o.value}
                  className={`tap flex flex-1 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                    v.app_direction === o.value
                      ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                      : 'border-slate-300 dark:border-slate-700'
                  }`}
                >
                  <input
                    type="radio"
                    name="app_direction"
                    value={o.value}
                    className="accent-brand-600"
                    checked={v.app_direction === o.value}
                    onChange={() => set('app_direction', o.value)}
                  />
                  {o.label}
                </label>
              ))}
            </div>
            {e.app_direction && <p className="error-text">{e.app_direction}</p>}
          </fieldset>
        </FieldGrid>
      </SettingsSection>
      <SettingsSection title={t('Date and time')}>
        <FieldGrid>
          <div>
            <label className="label" htmlFor="app_timezone">
              {t('Timezone')}
              <span className="ms-0.5 text-red-500">*</span>
            </label>
            <input
              id="app_timezone"
              className={`input ${e.app_timezone ? 'input-error' : ''}`}
              list="timezone-list"
              value={v.app_timezone}
              onChange={(x) => set('app_timezone', x.target.value)}
              aria-invalid={!!e.app_timezone || undefined}
              autoComplete="off"
            />
            <datalist id="timezone-list">
              {timezones.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
            {e.app_timezone ? (
              <p className="error-text">{e.app_timezone}</p>
            ) : (
              <p className="help">{t('Type to search, e.g. Europe/London')}</p>
            )}
          </div>
          <Select
            label={t('Date format')}
            required
            error={e.app_date_format}
            value={v.app_date_format}
            options={formats.map((f) => ({ value: f, label: `${phpDateSample(f)}  —  ${f}` }))}
            onChange={(x) => set('app_date_format', x.target.value)}
          />
          <Input
            label={t('Date locale')}
            required
            value={v.app_date_locale}
            error={e.app_date_locale}
            onChange={(x) => set('app_date_locale', x.target.value)}
            help={t('Set locale used for date and time translation, e.g. en, fr, ar')}
          />
        </FieldGrid>
      </SettingsSection>
    </SettingsPanel>
  );
}
