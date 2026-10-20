import { Info } from 'lucide-react';
import { Input, Switch } from '@/components/ui';
import { useT } from '@/providers/AppProviders';
import { SettingsPanel, SettingsSection, ToggleList } from './SettingsPanel';
import { bool, useSettingsForm } from './useSettingsForm';

/** Every flag accepted by SettingAdvanceRequest, grouped for the UI. */
const GROUPS: { title: string; description: string; flags: { key: string; label: string; help: string }[] }[] = [
  {
    title: 'Orders and checkout',
    description: 'How orders move from the till to the kitchen and payment.',
    flags: [
      { key: 'advance_cashbook_mode', label: 'Cashbook mode', help: 'Staff must open a cash book (register) before taking payments; adds the Cash books report.' },
      { key: 'advance_print_on_submit', label: 'Print on submit/update', help: 'Open the receipt print dialog whenever an order is submitted or updated.' },
      { key: 'advance_customer_tip_collection', label: 'Customer tip collection', help: 'Show a tip field at checkout.' },
      { key: 'bypass_kitchen_bar', label: 'Bypass kitchen bar portal', help: 'Orders skip the kitchen display and are ready for billing immediately.' },
      { key: 'allow_to_edit_checked_orders', label: 'Allow to edit checked orders', help: 'Completed (checked out) orders can still be edited and checked out again.' },
      { key: 'advance_send_notification', label: 'Send notifications to customer', help: 'Send email / SMS / WhatsApp messages on order events using the notification templates.' },
    ],
  },
  {
    title: 'Dining tables',
    description: 'Service table rules for dine-in orders.',
    flags: [
      { key: 'allow_table_reselect', label: 'Allow to select service table for multiple orders', help: 'A booked table can be chosen again for another open order.' },
      { key: 'table_is_option', label: 'Mark service table as an optional for dinning orders', help: 'Dine-in orders can be submitted without picking a table.' },
    ],
  },
  {
    title: 'Modules',
    description: 'Turn whole features on or off. Menus update right after saving.',
    flags: [
      { key: 'disable_room_reservations', label: 'Enable room reservations', help: 'Adds guest rooms, booking sources, reservation statuses and reservations, and room service orders in POS.' },
      { key: 'digital_menu', label: 'Table digital QR code menu', help: 'Customers can scan a table QR code to view the menu and place orders.' },
      { key: 'item_consumption_mode', label: 'Food item consumption mode', help: 'Deduct ingredient stock when food items are sold.' },
      { key: 'allow_expiry_date', label: 'Food expiry', help: 'Track ingredient expiry dates and show the Expiry alerts report.' },
    ],
  },
  {
    title: 'Digital menu ordering',
    description: 'What guests need before an order from a table QR code is accepted.',
    flags: [
      {
        key: 'digital_menu_require_pin',
        label: 'Require a table code',
        help: 'Staff open the table and give the guests a 6-digit code, which they enter to order. Closing or paying the table ends the code.',
      },
      {
        key: 'digital_menu_verify_email',
        label: 'Require a verified email address',
        help: 'Guests confirm their email address with a code sent to it before ordering. Needs Outgoing mail with a sender address.',
      },
    ],
  },
  {
    title: 'Tax',
    description: 'How tax is applied to orders.',
    flags: [
      { key: 'taxation', label: 'Tax implementation', help: 'Apply tax to orders at all. Turn off for tax-free businesses.' },
      { key: 'item_based_tax', label: 'Item based tax implemention', help: 'Each food item carries its own tax method instead of one tax for the whole order.' },
    ],
  },
  {
    title: 'Point of sale behaviour',
    description: 'Small conveniences on the POS screen.',
    flags: [
      { key: 'elengent_search', label: 'Elegant searching mode', help: 'Search matches from the beginning of names and codes (faster on large catalogs).' },
      { key: 'autoclose_service_table_model', label: 'Autoclose service table model', help: 'Close the table picker as soon as a table is chosen.' },
      { key: 'autoclose_pickup_model', label: 'Autoclose pickup model', help: 'Close the pickup point picker as soon as a point is chosen.' },
      { key: 'autoclose_customer_model', label: 'Autoclose customer model', help: 'Close the customer picker as soon as a customer is chosen.' },
      { key: 'autoclose_shipping_model', label: 'Autoclose shipping/delivery model', help: 'Close the delivery address picker as soon as an address is chosen.' },
    ],
  },
];

const ALL_KEYS = GROUPS.flatMap((g) => g.flags.map((f) => f.key));

export default function AdvanceTab() {
  const t = useT();
  const form = useSettingsForm<Record<string, boolean | number>>({
    endpoint: 'admin/setting/advance-config',
    select: (d) => ({ ...Object.fromEntries(ALL_KEYS.map((k) => [k, bool(d?.[k])])), seating_pin_max_hours: Number(d?.seating_pin_max_hours ?? 8) || 8 }),
  });
  const { values: v, set, errors: e } = form;
  return (
    <SettingsPanel title={t('Advance configuration')} description={t('Operating modes for orders, modules and the POS screen.')} form={form}>
      <div className="mx-5 mt-5 flex items-start gap-2 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800 dark:bg-brand-950 dark:text-brand-200" role="note">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{t('Changes apply to this browser right after saving. Other open tills pick them up when they reload.')}</span>
      </div>
      {GROUPS.map((g) => (
        <SettingsSection key={g.title} title={t(g.title)} description={t(g.description)}>
          <ToggleList>
            {g.flags.map((f) => (
              <div key={f.key} className="p-4">
                <Switch label={t(f.label)} description={t(f.help)} checked={!!v[f.key]} onChange={(x) => set(f.key, x)} />
                {e[f.key] && <p className="error-text">{e[f.key]}</p>}
              </div>
            ))}
            {g.title === 'Digital menu ordering' && !!v.digital_menu_verify_email && form.raw && !form.raw.mail_ready && (
              <div className="flex items-start gap-2 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-200" role="note">
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{t('Email verification is paused until Outgoing mail has a sender address and a mailer other than Log.')}</span>
              </div>
            )}
            {g.title === 'Digital menu ordering' && (
              <div className="p-4">
                <Input
                  label={t('Table code valid for (hours)')}
                  type="number"
                  min={1}
                  max={72}
                  step={1}
                  wrapperClassName="max-w-xs"
                  help={t('An older code stops working, as if the table had been closed.')}
                  value={String(v.seating_pin_max_hours ?? 8)}
                  error={e.seating_pin_max_hours}
                  onChange={(ev) => set('seating_pin_max_hours', Number(ev.target.value))}
                />
              </div>
            )}
          </ToggleList>
        </SettingsSection>
      ))}
    </SettingsPanel>
  );
}
