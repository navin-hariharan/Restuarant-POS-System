import { useEffect, useState } from 'react';
import { ImageInput } from '@/components/ui';
import { useConfig, useT } from '@/providers/AppProviders';
import { FieldGrid, SettingsPanel, SettingsSection } from './SettingsPanel';
import { useSettingsForm } from './useSettingsForm';

function useObjectUrl(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return setUrl(null);
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url;
}

type Appearance = { icon: File | null; background: File | null; app_icon: string; app_background: string };

export default function AppearanceTab() {
  const t = useT();
  const { config } = useConfig();
  const form = useSettingsForm<Appearance>({
    endpoint: 'admin/setting/appearance',
    select: (d) => ({ icon: null, background: null, app_icon: d.app_icon ?? '', app_background: d.app_background ?? '' }),
    toPayload: (v) => {
      const fd = new FormData();
      if (v.icon) fd.append('icon', v.icon);
      if (v.background) fd.append('background', v.background);
      return fd;
    },
  });
  const { values: v, set, errors: e } = form;
  const iconPreview = useObjectUrl(v.icon ?? null) ?? v.app_icon;
  const bgPreview = useObjectUrl(v.background ?? null) ?? v.app_background;

  return (
    <SettingsPanel title={t('Appearance')} description={t('Logo and sign-in background used across the app.')} form={form}>
      <SettingsSection>
        <FieldGrid>
          <div>
            <ImageInput
              label={t('Logo')}
              value={v.icon}
              currentUrl={v.app_icon}
              onChange={(f) => set('icon', f)}
              error={e.icon}
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
            />
            <p className="help">{t('Square image (1:1), up to 1 MB. Used as the app icon and on invoices.')}</p>
          </div>
          <div>
            <ImageInput
              label={t('Background')}
              value={v.background}
              currentUrl={v.app_background}
              onChange={(f) => set('background', f)}
              error={e.background}
              accept="image/png,image/jpeg,image/webp"
            />
            <p className="help">{t('Up to 2 MB. Shown behind the sign-in pages.')}</p>
          </div>
        </FieldGrid>
      </SettingsSection>
      <SettingsSection title={t('Preview')} description={t('How the sign-in page will look.')}>
        <div
          className="relative flex h-56 items-center justify-center overflow-hidden rounded-xl bg-slate-200 bg-cover bg-center dark:bg-slate-800"
          style={{ backgroundImage: bgPreview ? `url("${bgPreview}")` : undefined }}
          aria-hidden="true"
        >
          <div className="absolute inset-0 bg-slate-950/30" />
          <div className="relative w-48 rounded-xl bg-white/95 p-4 text-center shadow-lg dark:bg-slate-900/95">
            {iconPreview && <img src={iconPreview} alt="" className="mx-auto h-10 w-10 rounded-lg object-contain" />}
            <p className="mt-2 truncate text-sm font-semibold">{config.name}</p>
            <div className="mt-3 space-y-1.5">
              <div className="h-2 rounded-sm bg-slate-200 dark:bg-slate-700" />
              <div className="h-2 rounded-sm bg-slate-200 dark:bg-slate-700" />
              <div className="h-3 rounded-sm bg-brand-600" />
            </div>
          </div>
        </div>
      </SettingsSection>
    </SettingsPanel>
  );
}
