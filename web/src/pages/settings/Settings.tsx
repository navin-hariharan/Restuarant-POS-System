import clsx from 'clsx';
import {
  Bell, Brush, Building2, Coins, Globe2, KeyRound, Mail, MessageCircle, MessageSquare, Percent, Printer, ShieldCheck, SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ComponentType } from 'react';
import { Navigate, NavLink, useBlocker, useNavigate, useParams } from 'react-router-dom';
import { settingsTabs } from '@/nav';
import { useAuth, useT } from '@/providers/AppProviders';
import { PageHeader, Select, useConfirm } from '@/components/ui';
import { SettingsDirtyContext } from '@/components/settings/SettingsPanel';
import GeneralTab from '@/components/settings/GeneralTab';
import AppearanceTab from '@/components/settings/AppearanceTab';
import LocalizationTab from '@/components/settings/LocalizationTab';
import AdvanceTab from '@/components/settings/AdvanceTab';
import TaxTab from '@/components/settings/TaxTab';
import PrinterTab from '@/components/settings/PrinterTab';
import TemplatesTab from '@/components/settings/TemplatesTab';
import { AuthenticationTab, CaptchaTab, CurrencyTab, MailTab, SmsTab, WhatsAppTab } from '@/components/settings/SimpleTabs';

const PANELS: Record<string, { component: ComponentType; icon: LucideIcon; hint: string }> = {
  general: { component: GeneralTab, icon: Building2, hint: 'Name, address, URL and maintenance' },
  appearance: { component: AppearanceTab, icon: Brush, hint: 'Logo and background' },
  localization: { component: LocalizationTab, icon: Globe2, hint: 'Language, time zone, dates' },
  authentication: { component: AuthenticationTab, icon: KeyRound, hint: 'Registration and default role' },
  'outgoing-mail': { component: MailTab, icon: Mail, hint: 'SMTP, Mailgun, sender' },
  captcha: { component: CaptchaTab, icon: ShieldCheck, hint: 'Google reCAPTCHA v3' },
  tax: { component: TaxTab, icon: Percent, hint: 'Tax methods and default tax' },
  currency: { component: CurrencyTab, icon: Coins, hint: 'Symbol and position' },
  'invoice-printing': { component: PrinterTab, icon: Printer, hint: 'Receipt layout and paper' },
  advance: { component: AdvanceTab, icon: SlidersHorizontal, hint: 'Modes and modules' },
  sms: { component: SmsTab, icon: MessageSquare, hint: 'Vonage or Twilio' },
  whatsapp: { component: WhatsAppTab, icon: MessageCircle, hint: 'Twilio WhatsApp' },
  'notification-templates': { component: TemplatesTab, icon: Bell, hint: 'Customer messages' },
};

export default function Settings() {
  const t = useT();
  const { can } = useAuth();
  const confirm = useConfirm();
  const { tab } = useParams();
  const allowed = settingsTabs.filter((s) => can(s.gate) && PANELS[s.key]);
  const [dirty, setDirty] = useState(false);
  const reportDirty = useCallback((d: boolean) => setDirty(d), []);

  // Ask before leaving a tab (or the page) with unsaved changes.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    confirm({
      title: t('Discard unsaved changes?'),
      message: t('You have changes on this tab that are not saved yet.'),
      confirmText: t('Discard'),
      danger: true,
    }).then((ok) => (ok ? blocker.proceed() : blocker.reset()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocker.state]);
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);

  if (!allowed.length) return <Navigate to="/admin/account" replace />;
  const active = allowed.find((s) => s.key === tab);
  if (!active) return <Navigate to={`/admin/settings/${allowed[0].key}`} replace />;
  const Panel = PANELS[active.key].component;

  return (
    <div>
      <PageHeader title={t('Settings')} description={t('Configure how your restaurant and this app work.')} />
      <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        {/* Mobile: compact select */}
        <div className="lg:hidden">
          <MobileTabSelect allowed={allowed} active={active.key} />
        </div>
        <nav aria-label={t('Settings')} className="hidden lg:block">
          <ul className="sticky top-4 space-y-0.5">
            {allowed.map((s) => {
              const Icon = PANELS[s.key].icon;
              return (
                <li key={s.key}>
                  <NavLink
                    to={`/admin/settings/${s.key}`}
                    className={({ isActive }) =>
                      clsx(
                        'flex items-start gap-3 rounded-lg px-3 py-2 text-sm transition',
                        isActive
                          ? 'bg-white font-medium text-brand-700 shadow-xs ring-1 ring-slate-200 dark:bg-slate-900 dark:text-brand-300 dark:ring-slate-800'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100',
                      )
                    }
                  >
                    <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        {t(s.label)}
                        {dirty && s.key === active.key && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-label={t('Unsaved changes')} />}
                      </span>
                      <span className="block truncate text-xs font-normal text-slate-400">{t(PANELS[s.key].hint)}</span>
                    </span>
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="min-w-0">
          <SettingsDirtyContext.Provider value={reportDirty}>
            <Panel key={active.key} />
          </SettingsDirtyContext.Provider>
        </div>
      </div>
    </div>
  );
}

function MobileTabSelect({ allowed, active }: { allowed: typeof settingsTabs; active: string }) {
  const t = useT();
  const navigate = useNavigate();
  return (
    <Select
      label={t('Section')}
      value={active}
      options={allowed.map((s) => ({ value: s.key, label: t(s.label) }))}
      // Router navigations go through the unsaved-changes blocker.
      onChange={(e) => navigate(`/admin/settings/${e.target.value}`)}
    />
  );
}
