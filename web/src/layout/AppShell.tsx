import clsx from 'clsx';
import { Check, Globe, LogOut, Menu as MenuIcon, Moon, PanelLeftClose, PanelLeftOpen, Search, Sun, User as UserIcon, X } from 'lucide-react';
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { storage } from '@/lib/format';
import type { Language } from '@/lib/types';
import { useAuth, useConfig, useT, useTheme } from '@/providers/AppProviders';
import { BrandIcon, Credit, DEVELOPER, Menu, MenuItem } from '@/components/ui';
import { visibleNav } from '@/nav';

export function avatarUrl(user: { avatar?: string | null; gravatar?: string } | null): string | null {
  if (!user) return null;
  if (user.avatar && /^(https?:)?\//.test(user.avatar)) return user.avatar;
  return user.gravatar ?? null;
}

export function Avatar({ name, src, size = 'h-8 w-8' }: { name: string; src?: string | null; size?: string }) {
  const [failed, setFailed] = useState(false);
  return src && !failed ? (
    <img src={src} alt="" onError={() => setFailed(true)} className={clsx(size, 'rounded-full object-cover')} />
  ) : (
    <span className={clsx(size, 'flex items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700 dark:bg-brand-900 dark:text-brand-200')}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function Sidebar({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const t = useT();
  const { can } = useAuth();
  const { config } = useConfig();
  const groups = visibleNav(can, config.modes);
  return (
    <nav aria-label={t('Main')} className="flex h-full flex-col">
      <Link to="/" className="flex h-14 shrink-0 items-center gap-2 px-4" onClick={onNavigate}>
        <BrandIcon src={config.icon} className="h-8 w-8 rounded-lg object-contain" />
        {!collapsed && <span className="truncate text-sm font-semibold">{config.name}</span>}
      </Link>
      <div className="flex-1 space-y-4 overflow-y-auto px-2 pb-4">
        {groups.map((g) => (
          <div key={g.label}>
            {!collapsed && <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{t(g.label)}</p>}
            <ul className="space-y-0.5">
              {g.items.map((i) => (
                <li key={i.to}>
                  <NavLink
                    to={i.to}
                    onClick={onNavigate}
                    title={collapsed ? t(i.label) : undefined}
                    className={({ isActive }) => clsx('nav-link', isActive && 'nav-link-active', collapsed && 'justify-center px-2')}
                  >
                    <i.icon className="h-[18px] w-[18px] shrink-0" />
                    {!collapsed && <span className="truncate">{t(i.label)}</span>}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="shrink-0 border-t border-slate-100 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-slate-400 dark:border-slate-800 dark:text-slate-500">
        {collapsed ? (
          <span className="block text-center text-[10px] font-semibold" title={`${t('Developed by')} ${DEVELOPER}`}>
            NH
          </span>
        ) : (
          <Credit />
        )}
      </div>
    </nav>
  );
}

export function LanguageMenu() {
  const t = useT();
  const { config, refresh } = useConfig();
  const qc = useQueryClient();
  const langs = useQuery({ queryKey: ['languages-public'], queryFn: async () => (await api.get<Language[]>('lang')).data, staleTime: 300_000 });
  if (!langs.data || langs.data.length < 2) return null;
  return (
    <Menu
      trigger={({ toggle }) => (
        <button className="btn-ghost btn-icon" onClick={toggle} aria-label={t('Language')} title={t('Language')}>
          <Globe className="h-5 w-5" />
        </button>
      )}
    >
      {(close) =>
        langs.data!.map((l) => (
          <MenuItem
            key={l.id}
            icon={l.locale === config.locale ? <Check className="h-4 w-4" /> : <span className="w-4" />}
            onClick={async () => {
              close();
              await api.post('lang/set-language', { locale: l.locale, direction: l.direction ?? 'ltr' });
              await refresh();
              qc.invalidateQueries({ queryKey: ['lang'] });
            }}
          >
            {l.name}
          </MenuItem>
        ))
      }
    </Menu>
  );
}

export function UserMenu() {
  const t = useT();
  const { user, logout } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();
  const nav = useNavigate();
  if (!user) return null;
  return (
    <Menu
      trigger={({ toggle }) => (
        <button className="flex h-10 w-10 items-center justify-center rounded-full hover:ring-2 hover:ring-slate-200 dark:hover:ring-slate-700" onClick={toggle} aria-label={t('Account')}>
          <Avatar name={user.name} src={avatarUrl(user)} />
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="border-b border-slate-200 px-3 py-2 dark:border-slate-700">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="truncate text-xs text-slate-500">{user.role?.name}</p>
          </div>
          <MenuItem icon={<UserIcon className="h-4 w-4" />} onClick={() => { close(); nav('/admin/account'); }}>
            {t('My account')}
          </MenuItem>
          {/* the top-bar theme button is hidden on narrow phones */}
          <div className="sm:hidden">
            <MenuItem icon={theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />} onClick={() => { close(); toggleTheme(); }}>
              {theme === 'dark' ? t('Light mode') : t('Dark mode')}
            </MenuItem>
          </div>
          <MenuItem danger icon={<LogOut className="h-4 w-4" />} onClick={() => { close(); logout(); }}>
            {t('Logout')}
          </MenuItem>
        </>
      )}
    </Menu>
  );
}

export function ThemeToggle({ hideOnPhones }: { hideOnPhones?: boolean }) {
  const t = useT();
  const { theme, toggle } = useTheme();
  return (
    <button className={clsx('btn-ghost btn-icon', hideOnPhones && 'hidden sm:inline-flex')} onClick={toggle} aria-label={theme === 'dark' ? t('Light mode') : t('Dark mode')} title={theme === 'dark' ? t('Light mode') : t('Dark mode')}>
      {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}

export function TopbarActions({ onSearch }: { onSearch?: () => void }) {
  const t = useT();
  return (
    <div className="flex shrink-0 items-center gap-1">
      {onSearch && (
        <button
          className="tap hidden items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800 md:flex"
          onClick={onSearch}
        >
          <Search className="h-4 w-4" />
          <span>{t('Search')}</span>
          <kbd className="rounded-sm border border-slate-200 px-1.5 text-[10px] dark:border-slate-700">Ctrl K</kbd>
        </button>
      )}
      {onSearch && (
        <button className="btn-ghost btn-icon md:hidden" onClick={onSearch} aria-label={t('Search')}>
          <Search className="h-5 w-5" />
        </button>
      )}
      <LanguageMenu />
      <ThemeToggle hideOnPhones />
      <UserMenu />
    </div>
  );
}

const PaletteDialog = lazy(() => import('./CommandPalette'));

/** Ctrl/Cmd+K search palette; its code loads the first time it opens. */
function CommandPalette({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!open);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, setOpen]);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <PaletteDialog setOpen={setOpen} />
    </Suspense>
  );
}

/** Standard admin layout: sidebar + top bar. */
export function AppShell() {
  const t = useT();
  const { config } = useConfig();
  const [collapsed, setCollapsed] = useState(() => storage.get('sidebar_collapsed', false));
  const [mobile, setMobile] = useState(false);
  const [palette, setPalette] = useState(false);
  const loc = useLocation();
  useEffect(() => setMobile(false), [loc.pathname]);
  return (
    <div className="flex min-h-full ps-[env(safe-area-inset-left)] pe-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:inset-s-2 focus:top-2 focus:z-70 focus:rounded-sm focus:bg-white focus:px-3 focus:py-2">
        {t('Skip to content')}
      </a>
      <aside
        className={clsx(
          'sticky top-0 hidden h-dvh shrink-0 border-e border-slate-200 bg-white transition-[width] dark:border-slate-800 dark:bg-slate-900 lg:block',
          collapsed ? 'w-[68px]' : 'w-64',
        )}
      >
        <Sidebar collapsed={collapsed} />
      </aside>
      {mobile && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/50" onClick={() => setMobile(false)} />
          <aside className="absolute inset-y-0 inset-s-0 w-72 max-w-[85vw] bg-white pt-[env(safe-area-inset-top)] ps-[env(safe-area-inset-left)] shadow-xl dark:bg-slate-900">
            <button className="btn-ghost btn-icon absolute inset-e-2 top-2" onClick={() => setMobile(false)} aria-label={t('Close')}>
              <X className="h-5 w-5" />
            </button>
            <Sidebar collapsed={false} onNavigate={() => setMobile(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center gap-2 pt-[env(safe-area-inset-top)] border-b border-slate-200 bg-white/85 px-3 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/85 sm:px-4">
          <button className="btn-ghost btn-icon lg:hidden" onClick={() => setMobile(true)} aria-label={t('Menu')}>
            <MenuIcon className="h-5 w-5" />
          </button>
          <button
            className="btn-ghost btn-icon hidden lg:inline-flex"
            onClick={() => {
              storage.set('sidebar_collapsed', !collapsed);
              setCollapsed(!collapsed);
            }}
            aria-label={t('Toggle sidebar')}
          >
            {collapsed ? <PanelLeftOpen className="h-5 w-5 rtl:rotate-180" /> : <PanelLeftClose className="h-5 w-5 rtl:rotate-180" />}
          </button>
          <div className="flex-1" />
          {config.is_demo_mode && <span className="chip bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">{t('Demo mode')}</span>}
          <TopbarActions onSearch={() => setPalette(true)} />
        </header>
        <main id="main" className="mx-auto w-full max-w-[120rem] flex-1 p-3 sm:p-6 2xl:px-8">
          <Outlet />
        </main>
      </div>
      <CommandPalette open={palette} setOpen={setPalette} />
    </div>
  );
}

/** Full-screen layout for POS and kitchen: slim top bar, no sidebar. */
export function FocusShell({ title, actions, children }: { title?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  const t = useT();
  const { config } = useConfig();
  const [palette, setPalette] = useState(false);
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-2 pt-[env(safe-area-inset-top)] ps-[max(0.5rem,env(safe-area-inset-left))] pe-[max(0.5rem,env(safe-area-inset-right))] dark:border-slate-800 dark:bg-slate-900 sm:gap-3 sm:px-3">
        <button className="btn-ghost btn-icon shrink-0" onClick={() => setPalette(true)} aria-label={t('Menu')} title={t('Menu')}>
          <MenuIcon className="h-5 w-5" />
        </button>
        <BrandIcon src={config.icon} className="hidden h-7 w-7 shrink-0 rounded-md object-contain sm:block" />
        <div className="hidden min-w-0 shrink truncate text-sm font-semibold min-[480px]:block">{title}</div>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 sm:gap-2">{actions}</div>
        {/* phones: account, theme and sign-out are in the menu (command palette) */}
        <div className="hidden sm:block">
          <TopbarActions />
        </div>
      </header>
      <div className="min-h-0 flex-1">{children}</div>
      <CommandPalette open={palette} setOpen={setPalette} />
    </div>
  );
}
