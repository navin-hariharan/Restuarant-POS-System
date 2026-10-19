import { Command } from 'cmdk';
import { Moon, Sun, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth, useConfig, useT, useTheme } from '@/providers/AppProviders';
import { settingsTabs, visibleNav } from '@/nav';

/** The palette itself (loaded on first use, see `CommandPalette` in AppShell). */
export default function PaletteDialog({ setOpen }: { setOpen: (v: boolean) => void }) {
  const t = useT();
  const nav = useNavigate();
  const { can, logout } = useAuth();
  const { config } = useConfig();
  const { theme, toggle } = useTheme();

  const go = (to: string) => {
    setOpen(false);
    nav(to);
  };
  return (
    <div className="fixed inset-0 z-60 flex items-start justify-center p-3 pt-[max(1rem,8dvh,env(safe-area-inset-top))] sm:p-4 sm:pt-[12vh]">
      <div className="absolute inset-0 bg-slate-950/50" onClick={() => setOpen(false)} />
      <Command
        label={t('Search')}
        className="relative w-full max-w-xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
      >
        <Command.Input
          autoFocus
          placeholder={t('Search pages and actions')}
          className="w-full border-0 border-b border-slate-200 bg-transparent px-4 py-3.5 text-sm outline-hidden focus:ring-0 dark:border-slate-700"
        />
        <Command.List className="max-h-[min(60vh,32rem)] overflow-y-auto overscroll-contain p-2">
          <Command.Empty className="px-3 py-6 text-center text-sm text-slate-500">{t('No data found')}</Command.Empty>
          {visibleNav(can, config.modes).map((g) => (
            <Command.Group key={g.label} heading={t(g.label)} className="**:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-1.5 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:font-semibold **:[[cmdk-group-heading]]:text-slate-500">
              {g.items.map((i) => (
                <Command.Item
                  key={i.to}
                  value={`${t(i.label)} ${i.label} ${i.keywords ?? ''}`}
                  onSelect={() => go(i.to)}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm aria-selected:bg-brand-50 aria-selected:text-brand-700 dark:aria-selected:bg-brand-950 dark:aria-selected:text-brand-300"
                >
                  <i.icon className="h-4 w-4 opacity-70" />
                  {t(i.label)}
                </Command.Item>
              ))}
            </Command.Group>
          ))}
          <Command.Group heading={t('Settings')} className="**:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-1.5 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:font-semibold **:[[cmdk-group-heading]]:text-slate-500">
            {settingsTabs
              .filter((s) => can(s.gate))
              .map((s) => (
                <Command.Item
                  key={s.key}
                  value={`settings ${t(s.label)} ${s.label}`}
                  onSelect={() => go(`/admin/settings/${s.key}`)}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm aria-selected:bg-brand-50 dark:aria-selected:bg-brand-950"
                >
                  {t('Settings')} › {t(s.label)}
                </Command.Item>
              ))}
            <Command.Item
              value="theme dark light mode"
              onSelect={() => {
                toggle();
                setOpen(false);
              }}
              className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm aria-selected:bg-brand-50 dark:aria-selected:bg-brand-950"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              {theme === 'dark' ? t('Light mode') : t('Dark mode')}
            </Command.Item>
            <Command.Item
              value="logout sign out"
              onSelect={() => {
                setOpen(false);
                logout();
              }}
              className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm aria-selected:bg-brand-50 dark:aria-selected:bg-brand-950"
            >
              <LogOut className="h-4 w-4" />
              {t('Logout')}
            </Command.Item>
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  );
}
