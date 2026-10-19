import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Languages as LanguagesIcon, Pencil, Plus, RefreshCcw, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import type { Language } from '@/lib/types';
import { useConfig, useT } from '@/providers/AppProviders';
import { Badge, Button, DataTable, Modal, PageHeader, useConfirm, type Column } from '@/components/ui';

/** English (id 1) is the source language and the app default locale can't be removed (LanguageController::destroy). */
export const isProtectedLanguage = (l: Language, defaultLocale: string) => l.id === 1 || l.locale === defaultLocale;

export default function Languages() {
  const t = useT();
  const qc = useQueryClient();
  const nav = useNavigate();
  const confirm = useConfirm();
  const { config } = useConfig();
  const [syncOutput, setSyncOutput] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['admin/languages'],
    queryFn: async () => (await api.get<Language[]>('admin/languages')).data,
  });

  const sync = useMutation({
    mutationFn: async () => (await api.post<{ message: string; output?: string }>('admin/languages/sync')).data,
    onSuccess: (d) => {
      toast.success(d?.message || t('Translation files updated correctly'));
      qc.invalidateQueries({ queryKey: ['lang'] });
      if (d?.output && d.output.trim()) setSyncOutput(d.output.trim());
    },
  });

  const remove = useMutation({
    mutationFn: async (l: Language) => (await api.delete<{ message: string }>(`admin/languages/${l.id}`)).data,
    onSuccess: (d) => {
      toast.success(d?.message || t('Data removed successfully'));
      qc.invalidateQueries({ queryKey: ['admin/languages'] });
      qc.invalidateQueries({ queryKey: ['languages-public'] });
    },
  });

  const columns: Column<Language>[] = [
    {
      key: 'name',
      header: t('Name'),
      cell: (l) => (
        <div className="flex items-center gap-2">
          <Link to={`/admin/languages/${l.id}/edit`} className="font-medium hover:underline">
            {l.name}
          </Link>
          {l.id === 1 && <Badge tone="purple">{t('Source')}</Badge>}
          {l.locale === config.locale && <Badge tone="blue">{t('Current')}</Badge>}
        </div>
      ),
    },
    { key: 'locale', header: t('Locale'), cell: (l) => <code className="rounded-sm bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">{l.locale}</code> },
    {
      key: 'direction',
      header: t('Direction'),
      cell: (l) => <Badge tone={l.direction === 'rtl' ? 'amber' : 'gray'}>{l.direction === 'rtl' ? 'RTL' : 'LTR'}</Badge>,
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('Actions')}</span>,
      className: 'text-end',
      cell: (l) => {
        const locked = isProtectedLanguage(l, config.locale);
        return (
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={() => nav(`/admin/languages/${l.id}/edit`)}>
              {l.id === 1 ? t('View') : t('Translate')}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="text-red-600 hover:bg-red-50 disabled:opacity-30 dark:text-red-400 dark:hover:bg-red-950/40"
              aria-label={`${t('Delete')} ${l.name}`}
              title={locked ? t("Can't delete default language") : t('Delete')}
              disabled={locked}
              loading={remove.isPending && remove.variables?.id === l.id}
              icon={<Trash2 className="h-4 w-4" />}
              onClick={async () => {
                if (await confirm({ title: t('Language delete'), message: t('The language and its translation file will be removed. :name', { name: l.name }) })) remove.mutate(l);
              }}
            />
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('Languages')}
        description={t('Manage the interface languages and their translations.')}
        actions={
          <>
            <Button
              onClick={async () => {
                if (
                  await confirm({
                    danger: false,
                    title: t('Synchronize'),
                    message: t('Re-scan the application for translatable texts and rewrite every language file. Keys no longer found in the source code may be removed.'),
                    confirmText: t('Synchronize'),
                  })
                )
                  sync.mutate();
              }}
              loading={sync.isPending}
              icon={<RefreshCcw className="h-4 w-4" />}
              title={t('Add newly introduced text keys to every language file')}
            >
              {t('Synchronize')}
            </Button>
            <Link to="/admin/languages/new" className="btn-primary">
              <Plus className="h-4 w-4" /> {t('Add language')}
            </Link>
          </>
        }
      />
      <DataTable
        columns={columns}
        rows={q.data ?? []}
        rowKey={(l) => l.id}
        loading={q.isLoading}
        empty={
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <LanguagesIcon className="h-8 w-8 text-slate-300" />
            <p className="text-sm">{t('No data found')}</p>
          </div>
        }
      />
      <Modal open={!!syncOutput} onClose={() => setSyncOutput(null)} title={t('Synchronize')} size="lg" footer={<Button onClick={() => setSyncOutput(null)}>{t('Close')}</Button>}>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{syncOutput}</pre>
      </Modal>
    </div>
  );
}
