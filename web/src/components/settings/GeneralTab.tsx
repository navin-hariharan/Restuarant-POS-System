import { useState } from 'react';
import { Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button, Input, Select, Switch, useConfirm } from '@/components/ui';
import { useT } from '@/providers/AppProviders';
import { FieldGrid, SettingsPanel, SettingsSection } from './SettingsPanel';
import { bool, useSettingsForm } from './useSettingsForm';

type General = {
  app_name: string;
  app_url: string;
  app_https: boolean;
  app_address: string;
  app_phone: string;
  mysqldump_path: string;
};

const ACTIONS: { value: string; label: string; help: string; danger?: boolean }[] = [
  { value: 'opt', label: 'Full optimize and enabled cache', help: 'Clears every cache, then caches config and views. Settings saved to the environment file need another optimize to take effect while the config cache is on.' },
  { value: 'optimize', label: 'Full optimize', help: 'Clears route, config and compiled caches.' },
  { value: 'cache', label: 'Clear only cache', help: 'Clears the route and config cache.' },
  { value: 'storage_link', label: 'Refresh storage link', help: 'Recreates the public storage link (fixes missing uploaded images).' },
  { value: 'update', label: 'Install update', help: 'Runs the database update routine after replacing the application files.', danger: true },
  { value: 'sync', label: 'Sale record sync for reports', help: 'Rebuilds report records from sales. May take several minutes on large databases.' },
];

function MaintenanceSection() {
  const t = useT();
  const confirm = useConfirm();
  const [action, setAction] = useState('');
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const selected = ACTIONS.find((a) => a.value === action);

  const run = async () => {
    if (!selected) return;
    const ok = await confirm({
      title: t(selected.label),
      message: t(selected.help),
      confirmText: t('Request'),
      danger: !!selected.danger,
    });
    if (!ok) return;
    setRunning(true);
    setOutput(null);
    try {
      const res = await api.post('admin/setting/setting-optimize', { action }, { timeout: 600_000 });
      toast.success(res.data?.message ?? t('System performed successfully'));
      setOutput((res.data?.output ?? '').trim() || null);
    } catch {
      /* toasted by the api client */
    } finally {
      setRunning(false);
    }
  };

  return (
    <SettingsSection
      title={t('System maintenance')}
      description={t('Run maintenance commands on the server. These do not change any settings above.')}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Select
          wrapperClassName="flex-1"
          label={t('Action')}
          placeholder={t('Select an option')}
          options={ACTIONS.map((a) => ({ value: a.value, label: t(a.label) }))}
          value={action}
          onChange={(e) => setAction(e.target.value)}
          help={selected ? t(selected.help) : undefined}
        />
        <Button icon={<Wrench className="h-4 w-4" />} loading={running} disabled={!action} onClick={run} className="sm:mb-[1.35rem]">
          {t('Request')}
        </Button>
      </div>
      {output && (
        <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100" aria-label={t('Output')}>
          {output}
        </pre>
      )}
    </SettingsSection>
  );
}

export default function GeneralTab() {
  const t = useT();
  const form = useSettingsForm<General>({
    endpoint: 'admin/setting/general',
    select: (d) => ({
      app_name: d.app_name ?? '',
      app_url: d.app_url ?? '',
      app_https: bool(d.app_https),
      app_address: d.app_address ?? '',
      app_phone: d.app_phone ?? '',
      mysqldump_path: d.mysqldump_path ?? '',
    }),
  });
  const { values: v, set, errors: e } = form;
  return (
    <div className="space-y-5">
      <SettingsPanel title={t('General')} description={t('Business identity and application address.')} form={form}>
        <SettingsSection title={t('Business')}>
          <FieldGrid>
            <Input label={t('Application name')} required value={v.app_name} error={e.app_name} onChange={(x) => set('app_name', x.target.value)} />
            <Input label={t('Phone')} type="tel" value={v.app_phone} error={e.app_phone} onChange={(x) => set('app_phone', x.target.value)} />
            <Input
              wrapperClassName="sm:col-span-2"
              label={t('Address')}
              value={v.app_address}
              error={e.app_address}
              onChange={(x) => set('app_address', x.target.value)}
            />
          </FieldGrid>
        </SettingsSection>
        <SettingsSection title={t('Application')}>
          <FieldGrid>
            <Input
              label={t('Application URL')}
              type="url"
              required
              value={v.app_url}
              error={e.app_url}
              help={t('Full address this app is served from, e.g. https://pos.example.com')}
              onChange={(x) => set('app_url', x.target.value)}
            />
            <Input
              label={t('mysqldump path')}
              required
              value={v.mysqldump_path}
              error={e.mysqldump_path}
              help={t('Used by database backups, e.g. /usr/bin/mysqldump')}
              onChange={(x) => set('mysqldump_path', x.target.value)}
            />
            <Switch
              className="sm:col-span-2"
              label={t('Force HTTPS')}
              description={t('Generate every link with https.')}
              checked={v.app_https}
              onChange={(x) => set('app_https', x)}
            />
          </FieldGrid>
        </SettingsSection>
      </SettingsPanel>
      <section className="card overflow-hidden">
        <MaintenanceSection />
      </section>
    </div>
  );
}
