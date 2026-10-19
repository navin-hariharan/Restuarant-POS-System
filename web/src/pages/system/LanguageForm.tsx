import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Copy, Lock, RotateCcw, Save, Trash2 } from 'lucide-react';
import { api, fieldErrors } from '@/lib/api';
import type { Language } from '@/lib/types';
import { useConfig, useT } from '@/providers/AppProviders';
import { Badge, Button, Card, EmptyState, Input, PageHeader, Pagination, SearchInput, Spinner, Tabs, useConfirm, useDebounced } from '@/components/ui';
import { isProtectedLanguage } from './Languages';

type Translation = { key: string; value: string };
type ShowResponse = { language: Language; translations: Translation[] };

export default function LanguageForm() {
  const { id } = useParams();
  return id ? <EditLanguage id={id} /> : <NewLanguage />;
}

/* -------------------------------------------------------------------- new */

function NewLanguage() {
  const t = useT();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', locale: '', direction: 'ltr' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: async () => (await api.post<{ message: string; language: Language }>('admin/languages', form)).data,
    onSuccess: (d) => {
      toast.success(d?.message || t('Data saved successfully'));
      qc.invalidateQueries({ queryKey: ['admin/languages'] });
      qc.invalidateQueries({ queryKey: ['languages-public'] });
      nav(d?.language?.id ? `/admin/languages/${d.language.id}/edit` : '/admin/languages', { replace: true });
    },
    onError: (e) => setErrors(fieldErrors(e)),
  });
  const set = (k: keyof typeof form) => (v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };

  return (
    <div className="mx-auto max-w-2xl">
      <BackLink />
      <PageHeader title={t('Add language')} description={t('A copy of the English strings is created; translate them on the next screen.')} />
      <Card>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Input label={t('Name')} required maxLength={50} value={form.name} onChange={(e) => set('name')(e.target.value)} error={errors.name} placeholder="Français" autoFocus />
          <Input
            label={t('Locale')}
            required
            maxLength={5}
            value={form.locale}
            onChange={(e) => set('locale')(e.target.value.trim())}
            error={errors.locale}
            placeholder="fr"
            help={t('ISO language code, up to 5 characters (e.g. fr, ar, pt_BR).')}
            className="font-mono"
          />
          <div>
            <span className="label">{t('Direction')}</span>
            <div role="radiogroup" aria-label={t('Direction')} className="grid grid-cols-2 gap-2">
              {[
                { v: 'ltr', label: t('Left to right'), sample: 'Abc →' },
                { v: 'rtl', label: t('Right to left'), sample: '← أبج' },
              ].map((o) => (
                <label
                  key={o.v}
                  className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2.5 text-sm transition ${
                    form.direction === o.v ? 'border-brand-600 bg-brand-50 dark:bg-brand-950/40' : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <input type="radio" name="direction" value={o.v} checked={form.direction === o.v} onChange={() => set('direction')(o.v)} className="accent-brand-600" />
                    {o.label}
                  </span>
                  <span className="text-xs text-slate-500" dir={o.v}>
                    {o.sample}
                  </span>
                </label>
              ))}
            </div>
            {errors.direction && <p className="error-text">{errors.direction}</p>}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Link to="/admin/languages" className="btn-secondary">
              {t('Cancel')}
            </Link>
            <Button type="submit" variant="primary" loading={save.isPending} icon={<Save className="h-4 w-4" />}>
              {t('Save')}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------- edit */

type Filter = 'all' | 'untranslated' | 'translated' | 'changed';

function EditLanguage({ id }: { id: string }) {
  const t = useT();
  const nav = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { config } = useConfig();
  const q = useQuery({
    queryKey: ['admin/languages', id],
    queryFn: async () => (await api.get<ShowResponse>(`admin/languages/${id}`)).data,
  });
  // English source text keyed by key, to show what is being translated.
  const enQ = useQuery({
    queryKey: ['lang', 'en'],
    queryFn: async () => (await api.get<Record<string, string>>('lang/en', { silent: true })).data,
    staleTime: Infinity,
  });

  const language = q.data?.language;
  const readOnly = language?.id === 1;
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 200);
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);

  const original = useMemo(() => {
    const m: Record<string, string> = {};
    for (const tr of q.data?.translations ?? []) m[tr.key] = tr.value ?? '';
    return m;
  }, [q.data]);
  const all = q.data?.translations ?? [];
  const valueOf = (k: string) => (k in edits ? edits[k] : original[k] ?? '');
  const isUntranslated = (k: string) => {
    const v = valueOf(k);
    return !v.trim() || (!readOnly && v === k);
  };
  const changedKeys = Object.keys(edits).filter((k) => edits[k] !== original[k]);
  const dirty = changedKeys.length > 0;

  const counts = useMemo(() => {
    let untranslated = 0;
    for (const tr of all) if (isUntranslated(tr.key)) untranslated++;
    return { all: all.length, untranslated, translated: all.length - untranslated };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, edits, readOnly]);

  const filtered = useMemo(() => {
    const s = debounced.trim().toLowerCase();
    return all.filter((tr) => {
      if (filter === 'untranslated' && !isUntranslated(tr.key)) return false;
      if (filter === 'translated' && isUntranslated(tr.key)) return false;
      if (filter === 'changed' && !(tr.key in edits && edits[tr.key] !== original[tr.key])) return false;
      if (!s) return true;
      return tr.key.toLowerCase().includes(s) || valueOf(tr.key).toLowerCase().includes(s);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, debounced, filter, edits, original]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [page, totalPages]);
  const visible = filtered.slice((page - 1) * perPage, page * perPage);

  // Warn before leaving with unsaved translations.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const save = useMutation({
    mutationFn: async () =>
      (
        await api.put<{ message: string }>(`admin/languages/${id}`, {
          strings: changedKeys.map((k) => ({ key: k, value: edits[k] })),
        })
      ).data,
    onSuccess: (d) => {
      toast.success(d?.message || t('Data updated successfully'));
      qc.setQueryData<ShowResponse>(['admin/languages', id], (old) =>
        old ? { ...old, translations: old.translations.map((tr) => (tr.key in edits ? { ...tr, value: edits[tr.key] } : tr)) } : old,
      );
      setEdits({});
      if (language) qc.invalidateQueries({ queryKey: ['lang', language.locale] });
    },
  });

  const remove = useMutation({
    mutationFn: async () => (await api.delete<{ message: string }>(`admin/languages/${id}`)).data,
    onSuccess: (d) => {
      toast.success(d?.message || t('Data removed successfully'));
      qc.invalidateQueries({ queryKey: ['admin/languages'] });
      qc.invalidateQueries({ queryKey: ['languages-public'] });
      nav('/admin/languages', { replace: true });
    },
  });

  if (q.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-brand-600">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }
  if (!language) {
    return (
      <div>
        <BackLink />
        <EmptyState title={t('No translations found for the selected language')} />
      </div>
    );
  }
  const progress = counts.all ? Math.round((counts.translated / counts.all) * 100) : 0;
  const locked = isProtectedLanguage(language, config.locale);

  return (
    <div>
      <BackLink />
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {language.name}
            <code className="rounded-sm bg-slate-100 px-1.5 py-0.5 text-sm font-normal dark:bg-slate-800">{language.locale}</code>
            <Badge tone={language.direction === 'rtl' ? 'amber' : 'gray'}>{language.direction === 'rtl' ? 'RTL' : 'LTR'}</Badge>
          </span>
        }
        description={readOnly ? t("Can't update english language,please create new language for localization") : t('Translate each text; only the strings you change are saved.')}
        actions={
          !locked ? (
            <Button
              variant="ghost"
              className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
              icon={<Trash2 className="h-4 w-4" />}
              loading={remove.isPending}
              onClick={async () => {
                if (await confirm({ title: t('Language delete'), message: t('The language and its translation file will be removed. :name', { name: language.name }) })) remove.mutate();
              }}
            >
              {t('Delete')}
            </Button>
          ) : undefined
        }
      />

      {!readOnly && (
        <div className="card mb-4 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">{t('Translation progress')}</span>
            <span className="tabular-nums text-slate-500">
              {counts.translated} / {counts.all} · {progress}%
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label={t('Translation progress')}>
            <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <SearchInput
          className="w-full sm:w-80"
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder={t('Search keys or translations')}
        />
        <Tabs<Filter>
          value={filter}
          onChange={(f) => {
            setFilter(f);
            setPage(1);
          }}
          tabs={[
            { value: 'all', label: t('All'), count: counts.all },
            ...(!readOnly
              ? [
                  { value: 'untranslated' as const, label: t('Untranslated'), count: counts.untranslated },
                  { value: 'translated' as const, label: t('Translated'), count: counts.translated },
                  { value: 'changed' as const, label: t('Unsaved'), count: changedKeys.length },
                ]
              : []),
          ]}
        />
      </div>

      <section className="card overflow-hidden" aria-label={t('Translations')}>
        {!visible.length ? (
          <EmptyState title={t('No data found')} />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {visible.map((tr) => {
              const v = valueOf(tr.key);
              const changed = tr.key in edits && edits[tr.key] !== original[tr.key];
              const source = enQ.data?.[tr.key] ?? tr.key;
              const fieldId = `tr-${(page - 1) * perPage + visible.indexOf(tr)}`;
              return (
                <li key={tr.key} className={`grid gap-2 px-4 py-3 md:grid-cols-2 md:gap-4 ${changed ? 'bg-amber-50/60 dark:bg-amber-950/20' : ''}`}>
                  <div className="min-w-0">
                    <label htmlFor={fieldId} className="block wrap-break-word text-sm text-slate-800 dark:text-slate-200" dir="ltr">
                      {source}
                    </label>
                    {source !== tr.key && <p className="mt-0.5 break-all font-mono text-[11px] text-slate-400">{tr.key}</p>}
                  </div>
                  <div className="flex items-start gap-1.5">
                    <textarea
                      id={fieldId}
                      dir={language.direction === 'rtl' ? 'rtl' : 'ltr'}
                      lang={language.locale}
                      className="input min-h-10 flex-1 resize-y py-1.5 text-sm"
                      rows={Math.min(4, Math.max(1, Math.ceil(Math.max(v.length, source.length) / 60)))}
                      value={v}
                      readOnly={readOnly}
                      onChange={(e) => setEdits((ed) => ({ ...ed, [tr.key]: e.target.value }))}
                    />
                    {!readOnly && (
                      <div className="flex flex-col gap-1">
                        <button
                          type="button"
                          className="btn-ghost p-1.5!"
                          title={t('Copy source text')}
                          aria-label={t('Copy source text')}
                          onClick={() => setEdits((ed) => ({ ...ed, [tr.key]: source }))}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        {changed && (
                          <button
                            type="button"
                            className="btn-ghost p-1.5!"
                            title={t('Undo')}
                            aria-label={t('Undo')}
                            onClick={() =>
                              setEdits((ed) => {
                                const n = { ...ed };
                                delete n[tr.key];
                                return n;
                              })
                            }
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {filtered.length > 0 && (
          <div className="border-t border-slate-200 dark:border-slate-800">
            <Pagination
              page={page}
              totalPages={totalPages}
              total={filtered.length}
              perPage={perPage}
              onPage={(p) => {
                setPage(p);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              onPerPage={(n) => {
                setPerPage(n);
                setPage(1);
              }}
            />
          </div>
        )}
      </section>

      {readOnly ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-slate-500">
          <Lock className="h-4 w-4" /> {t('English is the source language and is read-only.')}
        </p>
      ) : (
        <div className="sticky bottom-0 z-20 -mx-1 mt-4 rounded-xl border border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/95">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-slate-600 dark:text-slate-300" aria-live="polite">
              {dirty ? t(':count unsaved changes', { count: changedKeys.length }) : t('All changes saved')}
            </p>
            <div className="flex gap-2">
              <Button disabled={!dirty || save.isPending} onClick={() => setEdits({})}>
                {t('Discard')}
              </Button>
              <Button variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()} icon={<Save className="h-4 w-4" />}>
                {t('Save')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BackLink() {
  const t = useT();
  return (
    <div className="mb-2">
      <Link to="/admin/languages" className="tap inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
        <ArrowLeft className="h-4 w-4 rtl:rotate-180" /> {t('Languages')}
      </Link>
    </div>
  );
}
