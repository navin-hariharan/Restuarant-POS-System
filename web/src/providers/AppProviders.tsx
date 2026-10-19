import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { api, clearToken, getToken, onDataChanged, setToken, setUnauthorizedHandler } from '@/lib/api';
import type { AppConfig, User } from '@/lib/types';
import { formatMoney } from '@/lib/format';
import { FullScreenLoader } from '@/components/ui/Spinner';

export const queryClient = new QueryClient({
  defaultOptions: {
    // Screens show what they have at once and update in the background when
    // opened again or when the window gets focus.
    queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 2_000 },
  },
});

/** Changes that affect the whole app: configuration, language, everything after a restore or import. */
const APP_WIDE = /^(admin\/setting|admin\/languages|lang\/|account\/|admin\/imports|admin\/backups\/[^/]+\/restore)/;
/** Queries that only change with an app-wide change (large or global). */
const GLOBAL_KEYS = new Set(['app-config', 'lang', 'languages-public']);

// After any change is saved, every screen on display refetches its data in the
// background, so nothing needs a browser refresh. Writes that arrive together
// (e.g. save then check out) refresh once.
let pendingRefresh: { appWide: boolean } | null = null;
onDataChanged((url) => {
  const appWide = APP_WIDE.test(url);
  if (pendingRefresh) {
    pendingRefresh.appWide ||= appWide;
    return;
  }
  pendingRefresh = { appWide };
  setTimeout(() => {
    const all = pendingRefresh?.appWide ?? false;
    pendingRefresh = null;
    queryClient.invalidateQueries({ predicate: (q) => all || !GLOBAL_KEYS.has(String(q.queryKey[0])) }, { cancelRefetch: false });
  }, 0);
});

/* ------------------------------------------------------------------ config */

type ConfigCtx = { config: AppConfig; refresh: () => Promise<unknown>; money: (v: unknown) => string };
const ConfigContext = createContext<ConfigCtx | null>(null);

export function useConfig() {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error('useConfig outside provider');
  return ctx;
}

function ConfigProvider({ children }: { children: ReactNode }) {
  const q = useQuery({
    queryKey: ['app-config'],
    queryFn: async () => (await api.get<AppConfig>('app-config', { silent: true })).data,
    staleTime: 60_000,
  });
  if (q.isError) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div>
          <p className="text-lg font-semibold">Unable to reach the server</p>
          <p className="mt-1 text-sm text-slate-500">Check that the API is running, then try again.</p>
          <button className="btn-primary mt-4" onClick={() => q.refetch()}>Retry</button>
        </div>
      </div>
    );
  }
  if (!q.data) return <FullScreenLoader />;
  const config = q.data;
  return (
    <ConfigContext.Provider value={{ config, refresh: q.refetch, money: (v) => formatMoney(v, config) }}>
      {children}
    </ConfigContext.Provider>
  );
}

/* -------------------------------------------------------------------- i18n */

type I18nCtx = {
  locale: string;
  dir: 'ltr' | 'rtl';
  t: (key: string, params?: Record<string, string | number>) => string;
};
const I18nContext = createContext<I18nCtx>({ locale: 'en', dir: 'ltr', t: (k) => k });

export function useT() {
  return useContext(I18nContext).t;
}
export function useI18n() {
  return useContext(I18nContext);
}

function I18nProvider({ children }: { children: ReactNode }) {
  const { config } = useConfig();
  const locale = config.locale || 'en';
  const dir = config.app_direction === 'rtl' ? 'rtl' : 'ltr';
  const q = useQuery({
    queryKey: ['lang', locale],
    queryFn: async () => (await api.get<Record<string, string>>(`lang/${locale}`, { silent: true })).data,
    staleTime: Infinity,
    retry: 0,
  });
  useEffect(() => {
    document.documentElement.dir = dir;
    document.documentElement.lang = locale;
  }, [dir, locale]);
  const dict = q.data;
  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => {
      let out = (dict && typeof dict[key] === 'string' && dict[key]) || key;
      if (params) for (const [k, v] of Object.entries(params)) out = out.replace(new RegExp(`:${k}\\b`, 'g'), String(v));
      return out;
    },
    [dict],
  );
  if (q.isLoading) return <FullScreenLoader />;
  return <I18nContext.Provider value={{ locale, dir, t }}>{children}</I18nContext.Provider>;
}

/* -------------------------------------------------------------------- auth */

type AuthCtx = {
  user: User | null;
  login: (token: string, user: User) => void;
  logout: () => Promise<void>;
  setUser: (u: User) => void;
  /** Same rule as the server: role id 1 (super admin) passes every gate. */
  can: (...gates: string[]) => boolean;
};
const AuthContext = createContext<AuthCtx | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside provider');
  return ctx;
}

export function canAccess(user: User | null, gates: string[]): boolean {
  if (!user) return false;
  if (!gates.length) return true;
  if (user.role_id < 2) return true;
  const perms = user.role?.permissions ?? [];
  return gates.some((g) => perms.includes(g));
}

function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(!getToken());

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      qc.clear();
    });
    if (getToken()) {
      api
        .get<User>('auth/user', { silent: true })
        .then((r) => setUser(r.data))
        .catch(() => clearToken())
        .finally(() => setReady(true));
    }
    // Keep the signed-in user (name, avatar, role permissions) current too.
    const off = onDataChanged((url) => {
      if (!getToken() || !/^(admin\/users|admin\/user-roles|account\/|admin\/backups\/[^/]+\/restore)/.test(url)) return;
      api
        .get<User>('auth/user', { silent: true })
        .then((r) => setUser(r.data))
        .catch(() => {});
    });
    return () => {
      setUnauthorizedHandler(null);
      off();
    };
  }, [qc]);

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      setUser,
      login: (token, u) => {
        setToken(token);
        setUser(u);
      },
      logout: async () => {
        try {
          await api.post('auth/logout', null, { silent: true });
        } catch {
          /* token may already be gone */
        }
        clearToken();
        setUser(null);
        qc.clear();
      },
      can: (...gates) => canAccess(user, gates),
    }),
    [user, qc],
  );

  if (!ready) return <FullScreenLoader />;
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/* ------------------------------------------------------------------- theme */

type Theme = 'light' | 'dark';
const ThemeContext = createContext<{ theme: Theme; toggle: () => void; setTheme: (t: Theme) => void }>({
  theme: 'light',
  toggle: () => {},
  setTheme: () => {},
});
export const useTheme = () => useContext(ThemeContext);

function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  );
  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    document.documentElement.classList.toggle('dark', t === 'dark');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#0f172a' : '#ffffff');
    try {
      localStorage.setItem('theme', t);
    } catch {
      /* ignore */
    }
  }, []);
  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark') }}>
      {children}
    </ThemeContext.Provider>
  );
}

/* ------------------------------------------------------------------ root */

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ConfigProvider>
          <I18nProvider>
            <AuthProvider>
              {children}
              <ToasterWithTheme />
            </AuthProvider>
          </I18nProvider>
        </ConfigProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function ToasterWithTheme() {
  const { theme } = useTheme();
  const { dir } = useI18n();
  return <Toaster richColors closeButton theme={theme} dir={dir} position={dir === 'rtl' ? 'top-left' : 'top-right'} />;
}
