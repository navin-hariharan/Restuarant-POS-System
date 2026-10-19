import { useRef, useState } from 'react';
import { Mail, MessageSquare } from 'lucide-react';
import { Input, Tabs, Textarea } from '@/components/ui';
import { useConfig, useT } from '@/providers/AppProviders';
import { SettingsPanel, SettingsSection } from './SettingsPanel';
import { useSettingsForm } from './useSettingsForm';

type Template = { subject: string; mail_content: string; sms_content: string };
type Templates = { template_order_created: Template; template_order_cancelled: Template; template_order_checkout: Template };
type TemplateKey = keyof Templates;
type FieldKey = keyof Template;

const PLACEHOLDERS: { token: string; label: string }[] = [
  { token: '{tracking_id}', label: 'Order tracking id' },
  { token: '{customer_name}', label: 'Customer name' },
  { token: '{order_link}', label: 'Sale order invoice print link' },
  { token: '{order_date}', label: 'Sale order created date' },
  { token: '{company_name}', label: 'Company or shop name' },
];

const EVENTS: { key: TemplateKey; label: string; help: string }[] = [
  { key: 'template_order_created', label: 'On order booking', help: 'Sent when a new order is submitted.' },
  { key: 'template_order_cancelled', label: 'On order cancellation', help: 'Sent when an order is cancelled.' },
  { key: 'template_order_checkout', label: 'On order checkout', help: 'Sent when an order is paid and closed.' },
];

const blank = (): Template => ({ subject: '', mail_content: '', sms_content: '' });
const pick = (raw: any): Template => ({
  subject: raw?.subject ?? '',
  mail_content: raw?.mail_content ?? '',
  sms_content: raw?.sms_content ?? '',
});

function render(text: string, sample: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (m, k) => sample[`{${k}}`] ?? m);
}

export default function TemplatesTab() {
  const t = useT();
  const { config } = useConfig();
  const [event, setEvent] = useState<TemplateKey>('template_order_created');
  const form = useSettingsForm<Templates>({
    endpoint: 'admin/setting/templates',
    select: (d) => ({
      template_order_created: d?.template_order_created ? pick(d.template_order_created) : blank(),
      template_order_cancelled: d?.template_order_cancelled ? pick(d.template_order_cancelled) : blank(),
      template_order_checkout: d?.template_order_checkout ? pick(d.template_order_checkout) : blank(),
    }),
  });
  const { values, errors: e } = form;
  const current = values[event] ?? blank();
  const lastField = useRef<{ field: FieldKey; el: HTMLInputElement | HTMLTextAreaElement } | null>(null);

  const setField = (field: FieldKey, value: string) => form.set(event, { ...current, [field]: value });

  const insert = (token: string) => {
    const target = lastField.current;
    const field: FieldKey = target?.field ?? 'mail_content';
    const text = current[field] ?? '';
    const el = target?.el;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + token + text.slice(end);
    setField(field, next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const track = (field: FieldKey) => ({
    onFocus: (ev: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => (lastField.current = { field, el: ev.currentTarget }),
  });

  const sample: Record<string, string> = {
    '{tracking_id}': '1700000000',
    '{customer_name}': 'Jane Doe',
    '{order_link}': `${config.url}/print/sale/…`,
    '{order_date}': new Date().toLocaleString(),
    '{company_name}': config.name,
  };
  const err = (f: FieldKey) => e[`${event}.${f}`] ?? e[event];

  return (
    <SettingsPanel title={t('Notification templates')} description={t('Messages sent to customers by email, SMS and WhatsApp.')} form={form}>
      <SettingsSection
        title={t('Placeholders')}
        description={t('Click a placeholder to insert it where the cursor is in the last field you edited.')}
      >
        <ul className="flex flex-wrap gap-2">
          {PLACEHOLDERS.map((p) => (
            <li key={p.token}>
              <button
                type="button"
                onMouseDown={(ev) => ev.preventDefault()}
                onClick={() => insert(p.token)}
                className="tap inline-flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-start text-xs hover:border-brand-500 hover:bg-brand-50 dark:border-slate-700 dark:hover:bg-brand-950"
                title={t('Insert')}
              >
                <code className="font-mono font-semibold text-brand-700 dark:text-brand-300">{p.token}</code>
                <span className="text-slate-500">{t(p.label)}</span>
              </button>
            </li>
          ))}
        </ul>
      </SettingsSection>
      <SettingsSection>
        <Tabs
          className="mb-4"
          value={event}
          onChange={(k) => {
            lastField.current = null;
            setEvent(k);
          }}
          tabs={EVENTS.map((ev) => ({
            value: ev.key,
            label: (
              <>
                {t(ev.label)}
                {Object.keys(e).some((k) => k === ev.key || k.startsWith(`${ev.key}.`)) && (
                  <span className="h-2 w-2 rounded-full bg-red-500" aria-label={t('Has errors')} />
                )}
              </>
            ),
          }))}
        />
        <p className="mb-4 text-sm text-slate-500">{t(EVENTS.find((x) => x.key === event)!.help)}</p>
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-4">
            <Input label={t('Mail subject')} required value={current.subject} error={err('subject')} onChange={(x) => setField('subject', x.target.value)} {...track('subject')} />
            <Textarea
              label={t('Mail content')}
              required
              rows={7}
              value={current.mail_content}
              error={err('mail_content')}
              onChange={(x) => setField('mail_content', x.target.value)}
              {...track('mail_content')}
            />
            <Textarea
              label={t('SMS / WhatsApp content')}
              required
              rows={3}
              value={current.sms_content}
              error={err('sms_content')}
              help={`${current.sms_content.length} ${t('characters')}`}
              onChange={(x) => setField('sms_content', x.target.value)}
              {...track('sms_content')}
            />
          </div>
          <div className="space-y-3" aria-label={t('Preview')}>
            <h3 className="text-sm font-semibold">{t('Preview')}</h3>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-slate-800">
                <Mail className="h-4 w-4" aria-hidden="true" /> {t('Email')}
              </div>
              <div className="px-3 py-2">
                <p className="text-sm font-semibold">{render(current.subject, sample) || <span className="text-slate-400">{t('Mail subject')}</span>}</p>
                <p className="mt-2 whitespace-pre-line wrap-break-word text-sm text-slate-700 dark:text-slate-300">{render(current.mail_content, sample)}</p>
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-slate-800">
                <MessageSquare className="h-4 w-4" aria-hidden="true" /> SMS / WhatsApp
              </div>
              <div className="p-3">
                <p className="inline-block max-w-full whitespace-pre-line wrap-break-word rounded-2xl rounded-ss-sm bg-slate-100 px-3 py-2 text-sm dark:bg-slate-800">
                  {render(current.sms_content, sample) || '…'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </SettingsSection>
    </SettingsPanel>
  );
}
