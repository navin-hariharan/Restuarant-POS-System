import { useConfig, useT } from '@/providers/AppProviders';
import { BrandIcon, Input, Select, Switch, Textarea } from '@/components/ui';
import { FieldGrid, SettingsPanel, SettingsSection, ToggleList } from './SettingsPanel';
import { bool, useSettingsForm } from './useSettingsForm';

type Printer = {
  print_font_family: string;
  print_name_address_position: string;
  print_name_address_size: string;
  print_header_footer_size: string;
  print_items_font_size: string;
  print_terms_conditions_font_size: string;
  print_font_color: string;
  printer_width: string;
  printer_height: string;
  signature_required: boolean;
  terms_conditions: string;
  print_auto: boolean;
  invoice_type_title: string;
  display_logo: boolean;
};

/** Normalise a stored colour (the default data has "#00000") for <input type=color>. */
function colorValue(c: string): string {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  if (/^#[0-9a-f]{3}$/i.test(c)) return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`;
  return '#000000';
}

const px = (v: string, fallback: number) => `${Number(v) > 0 ? Number(v) : fallback}px`;

/** Live mock receipt using the current (unsaved) printer settings. */
export function ReceiptPreview({ p }: { p: Printer }) {
  const t = useT();
  const { config, money } = useConfig();
  const items = [
    { name: 'Margherita pizza', qty: 1, price: 12.5 },
    { name: 'Caesar salad', qty: 2, price: 7.25 },
    { name: 'Lemonade', qty: 3, price: 2.5 },
  ];
  const subtotal = items.reduce((s, i) => s + i.qty * i.price, 0);
  const tax = Math.round(subtotal * 0.1 * 100) / 100;
  const font = p.print_font_family === 'auto' ? undefined : p.print_font_family;
  const align = (['left', 'right', 'center'].includes(p.print_name_address_position) ? p.print_name_address_position : 'center') as 'left' | 'right' | 'center';
  const color = colorValue(p.print_font_color);
  const width = p.printer_width?.trim() || '80mm';

  return (
    <div className="overflow-auto rounded-xl bg-slate-100 p-4 dark:bg-slate-800/60">
      <div
        className="mx-auto bg-white p-3 shadow-md"
        style={{ width, maxWidth: '100%', minHeight: '8rem', fontFamily: font, color }}
        aria-label={t('Receipt preview')}
        role="img"
      >
        <div style={{ textAlign: align }}>
          {p.display_logo && <BrandIcon src={config.icon} className="mb-1 inline-block h-10 w-10 object-contain" />}
          <p style={{ fontSize: px(p.print_name_address_size, 16), fontWeight: 700, lineHeight: 1.2 }}>{config.name}</p>
          {config.address && <p style={{ fontSize: px(p.print_header_footer_size, 12) }}>{config.address}</p>}
          {config.phone && <p style={{ fontSize: px(p.print_header_footer_size, 12) }}>{config.phone}</p>}
        </div>
        <div className="my-2 border-t border-dashed" style={{ borderColor: color }} />
        <div style={{ fontSize: px(p.print_header_footer_size, 12) }} className="flex justify-between">
          <span>{p.invoice_type_title || t('Invoice')} #1024</span>
          <span>{new Date().toLocaleDateString()}</span>
        </div>
        <div className="my-2 border-t border-dashed" style={{ borderColor: color }} />
        <table className="w-full" style={{ fontSize: px(p.print_items_font_size, 11) }}>
          <tbody>
            {items.map((i) => (
              <tr key={i.name}>
                <td className="py-0.5 text-start">
                  {i.qty} × {i.name}
                </td>
                <td className="py-0.5 text-end tabular-nums">{money(i.qty * i.price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="my-2 border-t border-dashed" style={{ borderColor: color }} />
        <div style={{ fontSize: px(p.print_items_font_size, 11) }} className="space-y-0.5">
          <p className="flex justify-between">
            <span>{t('Subtotal')}</span>
            <span className="tabular-nums">{money(subtotal)}</span>
          </p>
          <p className="flex justify-between">
            <span>{t('Tax')}</span>
            <span className="tabular-nums">{money(tax)}</span>
          </p>
          <p className="flex justify-between font-bold" style={{ fontSize: px(p.print_header_footer_size, 12) }}>
            <span>{t('Total')}</span>
            <span className="tabular-nums">{money(subtotal + tax)}</span>
          </p>
        </div>
        {p.terms_conditions && (
          <p className="mt-3 whitespace-pre-line" style={{ fontSize: px(p.print_terms_conditions_font_size, 9) }}>
            {p.terms_conditions}
          </p>
        )}
        {p.signature_required && (
          <div className="mt-6 text-center" style={{ fontSize: px(p.print_terms_conditions_font_size, 9) }}>
            <div className="mx-auto w-2/3 border-t" style={{ borderColor: color }} />
            {t('Signature')}
          </div>
        )}
        <p className="mt-3 text-center" style={{ fontSize: px(p.print_header_footer_size, 12) }}>
          {t('Thank you')}
        </p>
      </div>
      <p className="mt-2 text-center text-xs text-slate-500">
        {t('Paper')}: {width} × {p.printer_height || 'auto'}
      </p>
    </div>
  );
}

export default function PrinterTab() {
  const t = useT();
  const form = useSettingsForm<Printer>({
    endpoint: 'admin/setting/printer',
    select: (d) => ({
      print_font_family: d.print_font_family ?? 'monospace',
      print_name_address_position: d.print_name_address_position ?? 'center',
      print_name_address_size: String(d.print_name_address_size ?? ''),
      print_header_footer_size: String(d.print_header_footer_size ?? ''),
      print_items_font_size: String(d.print_items_font_size ?? ''),
      print_terms_conditions_font_size: String(d.print_terms_conditions_font_size ?? ''),
      print_font_color: d.print_font_color ?? '#000000',
      printer_width: d.printer_width ?? '',
      printer_height: d.printer_height ?? '',
      signature_required: bool(d.signature_required),
      terms_conditions: d.terms_conditions ?? '',
      print_auto: bool(d.print_auto),
      invoice_type_title: d.invoice_type_title ?? '',
      display_logo: bool(d.display_logo),
    }),
    toPayload: (v) => ({ ...v, terms_conditions: v.terms_conditions || null, invoice_type_title: v.invoice_type_title || null }),
  });
  const { values: v, set, errors: e } = form;
  const sizeInput = (key: keyof Printer, label: string) => (
    <Input
      label={t(label)}
      required
      type="number"
      min={1}
      inputMode="numeric"
      value={v[key] as string}
      error={e[key]}
      onChange={(x) => set(key, x.target.value as any)}
      help={t('Pixels')}
    />
  );

  return (
    <SettingsPanel title={t('Invoice Printing configuration')} description={t('Receipt layout and printer paper. The preview updates as you type.')} form={form}>
      <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div>
          <SettingsSection title={t('Paper')}>
            <FieldGrid>
              <Input
                label={t('Printer width')}
                required
                value={v.printer_width}
                error={e.printer_width}
                onChange={(x) => set('printer_width', x.target.value)}
                help={t('CSS size, e.g. 80mm, 58mm or 210mm')}
              />
              <Input
                label={t('Printer height')}
                required
                value={v.printer_height}
                error={e.printer_height}
                onChange={(x) => set('printer_height', x.target.value)}
                help={t('CSS size, e.g. 297mm or auto')}
              />
            </FieldGrid>
          </SettingsSection>
          <SettingsSection title={t('Text')}>
            <FieldGrid>
              <Select
                label={t('Print font family')}
                required
                error={e.print_font_family}
                value={v.print_font_family}
                options={[
                  { value: 'auto', label: t('Auto') },
                  { value: 'monospace', label: t('Monospace') },
                  { value: 'sans-serif', label: t('Sans-serif') },
                  { value: 'inherit', label: t('Inherit') },
                ]}
                onChange={(x) => set('print_font_family', x.target.value)}
              />
              <div>
                <label className="label" htmlFor="print_font_color">
                  {t('Print font color')}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="print_font_color"
                    type="color"
                    className="h-9 w-12 shrink-0 cursor-pointer rounded-sm pointer-coarse:h-10 border border-slate-300 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900"
                    value={colorValue(v.print_font_color)}
                    onChange={(x) => set('print_font_color', x.target.value)}
                  />
                  <input
                    aria-label={t('Print font color')}
                    className="input font-mono"
                    value={v.print_font_color}
                    onChange={(x) => set('print_font_color', x.target.value)}
                  />
                </div>
                {e.print_font_color && <p className="error-text">{e.print_font_color}</p>}
              </div>
              <Select
                label={t('Print name address position')}
                required
                error={e.print_name_address_position}
                value={v.print_name_address_position}
                options={[
                  { value: 'left', label: t('Left') },
                  { value: 'center', label: t('Center') },
                  { value: 'right', label: t('Right') },
                ]}
                onChange={(x) => set('print_name_address_position', x.target.value)}
              />
              {sizeInput('print_name_address_size', 'Print name address size')}
              {sizeInput('print_header_footer_size', 'Print header footer size')}
              {sizeInput('print_items_font_size', 'Print items font size')}
              {sizeInput('print_terms_conditions_font_size', 'Print terms conditions font size')}
            </FieldGrid>
          </SettingsSection>
          <SettingsSection title={t('Content')}>
            <div className="space-y-4">
              <Input
                label={t('Invoice type title')}
                value={v.invoice_type_title}
                error={e.invoice_type_title}
                placeholder={t('Invoice')}
                onChange={(x) => set('invoice_type_title', x.target.value)}
                help={t('Heading printed on receipts, e.g. Tax invoice')}
              />
              <Textarea
                label={t('Terms conditions')}
                rows={3}
                value={v.terms_conditions}
                error={e.terms_conditions}
                onChange={(x) => set('terms_conditions', x.target.value)}
              />
              <ToggleList>
                <Switch className="p-3" label={t('Display logo')} description={t('Print the logo at the top of receipts.')} checked={v.display_logo} onChange={(x) => set('display_logo', x)} />
                <Switch className="p-3" label={t('Signature required')} description={t('Add a signature line at the bottom.')} checked={v.signature_required} onChange={(x) => set('signature_required', x)} />
                <Switch className="p-3" label={t('Auto print')} description={t('Open the print dialog automatically when a receipt opens.')} checked={v.print_auto} onChange={(x) => set('print_auto', x)} />
              </ToggleList>
            </div>
          </SettingsSection>
        </div>
        <div className="border-t border-slate-200 p-5 dark:border-slate-800 xl:border-s xl:border-t-0">
          <div className="xl:sticky xl:top-4">
            <h3 className="mb-3 text-sm font-semibold">{t('Preview')}</h3>
            {!form.loading && <ReceiptPreview p={v} />}
          </div>
        </div>
      </div>
    </SettingsPanel>
  );
}
