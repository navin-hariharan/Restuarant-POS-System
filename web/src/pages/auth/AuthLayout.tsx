import { useEffect, type ReactNode } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useConfig, useT, useTheme } from '@/providers/AppProviders';
import { Credit } from '@/components/ui/Credit';
import { BrandIcon } from '@/components/ui/BrandIcon';

/** Centered card on the configured background, used by every sign-in page. */
export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const { config } = useConfig();
  const { theme, toggle } = useTheme();
  const t = useT();
  useEffect(() => {
    document.title = `${title} · ${config.name}`;
  }, [title, config.name]);
  return (
    <div
      className="relative flex min-h-dvh items-center justify-center bg-slate-200 bg-cover bg-center px-4 py-10 dark:bg-slate-950"
      style={{ backgroundImage: config.background ? `url("${config.background}")` : undefined }}
    >
      <div className="absolute inset-0 bg-slate-950/40 dark:bg-slate-950/70" aria-hidden="true" />
      <button
        type="button"
        onClick={toggle}
        className="absolute inset-e-[max(1rem,env(safe-area-inset-right))] top-[max(1rem,env(safe-area-inset-top))] flex h-10 w-10 items-center justify-center rounded-full bg-white/80 text-slate-700 shadow-sm backdrop-blur-sm hover:bg-white dark:bg-slate-900/80 dark:text-slate-200"
        aria-label={theme === 'dark' ? t('Light mode') : t('Dark mode')}
      >
        {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>
      <main className="relative w-full max-w-md">
        <div className="rounded-2xl bg-white/95 p-6 shadow-2xl backdrop-blur-sm dark:bg-slate-900/95 sm:p-8">
          <div className="mb-6 text-center">
            <BrandIcon src={config.icon} className="mx-auto h-14 w-14 rounded-xl object-contain" />
            <p className="mt-3 text-sm font-medium text-slate-500 dark:text-slate-400">{config.name}</p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
          </div>
          {children}
        </div>
        {footer && <div className="mt-4 text-center text-sm text-white drop-shadow-sm">{footer}</div>}
        <Credit className="mt-6 text-center text-white/70" />
      </main>
    </div>
  );
}

/** Inline error banner for auth forms. */
const alertTones = {
  error: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
  info: 'border-brand-200 bg-brand-50 text-brand-900 dark:border-brand-900 dark:bg-brand-950 dark:text-brand-100',
};

export function FormAlert({ children, tone = 'error' }: { children: ReactNode; tone?: keyof typeof alertTones }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`mb-4 rounded-lg border px-3 py-2 text-sm ${alertTones[tone]}`}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------ reCAPTCHA v3 */

declare global {
  interface Window {
    grecaptcha?: { ready: (cb: () => void) => void; execute: (key: string, opts: { action: string }) => Promise<string> };
  }
}

let loader: Promise<void> | null = null;

function loadRecaptcha(siteKey: string): Promise<void> {
  if (window.grecaptcha) return Promise.resolve();
  if (!loader) {
    loader = new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        loader = null;
        reject(new Error('Unable to load reCAPTCHA'));
      };
      document.head.appendChild(s);
    });
  }
  return loader;
}

/**
 * When reCAPTCHA is enabled, preload the script and return a function that
 * produces `{ captcha_hash }` (the field CheckCaptcha middleware reads) for a request.
 */
export function useCaptcha() {
  const { config } = useConfig();
  const enabled = !!config.recaptcha_enabled && !!config.recaptcha_public;
  useEffect(() => {
    if (enabled) loadRecaptcha(config.recaptcha_public!).catch(() => {});
  }, [enabled, config.recaptcha_public]);
  return async (action: string): Promise<{ captcha_hash?: string }> => {
    if (!enabled) return {};
    await loadRecaptcha(config.recaptcha_public!);
    const token = await new Promise<string>((resolve, reject) => {
      window.grecaptcha!.ready(() => {
        window.grecaptcha!.execute(config.recaptcha_public!, { action }).then(resolve, reject);
      });
    });
    return { captcha_hash: token };
  };
}

/** Only allow same-app relative redirects (no protocol-relative or absolute URLs). */
export function safeRedirect(value: string | null): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null;
  if (value.startsWith('/auth')) return null;
  return value;
}
