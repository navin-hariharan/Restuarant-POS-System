import clsx from 'clsx';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { RotateCcw, Save } from 'lucide-react';
import { Button, Skeleton } from '@/components/ui';
import { useT } from '@/providers/AppProviders';
import type { SettingsForm } from './useSettingsForm';

/** Lets the settings page know when the open tab has unsaved changes. */
export const SettingsDirtyContext = createContext<(dirty: boolean) => void>(() => {});

export function useReportDirty(dirty: boolean) {
  const report = useContext(SettingsDirtyContext);
  useEffect(() => {
    report(dirty);
    return () => report(false);
  }, [dirty, report]);
}

/** A titled group of fields inside a settings panel. */
export function SettingsSection({
  title,
  description,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx('border-t border-slate-200 px-5 py-5 first:border-t-0 dark:border-slate-800', className)}>
      {(title || description) && (
        <div className="mb-4">
          {title && <h3 className="text-sm font-semibold">{title}</h3>}
          {description && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{description}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

export function PanelSkeleton() {
  return (
    <div className="space-y-4 p-5" aria-busy="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
    </div>
  );
}

/**
 * Card wrapper for one settings tab: header, form body and a sticky footer
 * with the dirty indicator, reset and save buttons (Ctrl/Cmd+S saves).
 */
export function SettingsPanel({
  title,
  description,
  form,
  children,
  headerActions,
  footerExtra,
  noForm,
}: {
  title: ReactNode;
  description?: ReactNode;
  form?: Pick<SettingsForm<any>, 'dirty' | 'saving' | 'save' | 'reset' | 'loading'>;
  children: ReactNode;
  headerActions?: ReactNode;
  footerExtra?: ReactNode;
  /** Panel without the save footer (e.g. lists managed inline). */
  noForm?: boolean;
}) {
  const t = useT();
  useReportDirty(!!form?.dirty);

  const body = form?.loading ? <PanelSkeleton /> : children;

  return (
    <section className="card overflow-hidden" aria-labelledby="settings-panel-title">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <div className="min-w-0">
          <h2 id="settings-panel-title" className="text-base font-semibold">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{description}</p>}
        </div>
        {headerActions && <div className="flex flex-wrap items-center gap-2">{headerActions}</div>}
      </header>
      {noForm || !form ? (
        body
      ) : (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            form.save();
          }}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
              e.preventDefault();
              if (form.dirty && !form.saving) form.save();
            }
          }}
        >
          {body}
          <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white/95 px-5 py-3 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/95">
            <div className="flex items-center gap-2 text-sm" aria-live="polite">
              {form.dirty ? (
                <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                  <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" />
                  {t('Unsaved changes')}
                </span>
              ) : (
                <span className="text-slate-500 dark:text-slate-400">{t('All changes saved')}</span>
              )}
              {footerExtra}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                icon={<RotateCcw className="h-4 w-4" />}
                disabled={!form.dirty || form.saving || form.loading}
                onClick={form.reset}
              >
                {t('Reset')}
              </Button>
              <Button
                type="submit"
                variant="primary"
                icon={<Save className="h-4 w-4" />}
                loading={form.saving}
                disabled={!form.dirty || form.loading}
              >
                {t('Save')}
              </Button>
            </div>
          </div>
        </form>
      )}
    </section>
  );
}

/** Two-column responsive grid for fields. */
export function FieldGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('grid grid-cols-1 gap-4 sm:grid-cols-2', className)}>{children}</div>;
}

/** Switch row with a bordered container, for lists of toggles. */
export function ToggleList({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">{children}</div>;
}
