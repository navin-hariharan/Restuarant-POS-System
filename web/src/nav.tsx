import {
  BarChart3, BedDouble, BookOpen, Boxes, ChefHat, ClipboardList, Cog, CreditCard, Database, FileDown, FileText, Gauge,
  Globe, History, LayoutGrid, ListChecks, MapPin, Package, Percent, Receipt, ShieldCheck, ShoppingCart, Soup, Tags,
  TriangleAlert, User, Users, Wallet, CalendarClock, Layers, Salad, UtensilsCrossed, Store, CalendarX, type LucideIcon,
} from 'lucide-react';
import type { Modes } from '@/lib/types';

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Any one of these permissions grants access (same rule as the API). */
  gates?: string[];
  /** Only when this mode flag is on. */
  mode?: keyof Modes;
  keywords?: string;
};
export type NavGroup = { label: string; items: NavItem[] };

export const settingsTabs: { key: string; label: string; gate: string }[] = [
  { key: 'general', label: 'General', gate: 'general_configuration' },
  { key: 'appearance', label: 'Appearance', gate: 'appearance_configuration' },
  { key: 'localization', label: 'Localization', gate: 'localization_configuration' },
  { key: 'authentication', label: 'Authentication', gate: 'authentication_configuration' },
  { key: 'outgoing-mail', label: 'Outgoing mail', gate: 'outgoing_mail_configuration' },
  { key: 'captcha', label: 'Captcha', gate: 'captcha_configuration' },
  { key: 'tax', label: 'Tax', gate: 'tax_configuration' },
  { key: 'currency', label: 'Currency', gate: 'currency_configuration' },
  { key: 'invoice-printing', label: 'Invoice printing', gate: 'printer_configuration' },
  { key: 'advance', label: 'Advance', gate: 'advance_configuration' },
  { key: 'sms', label: 'SMS gateway', gate: 'sms_configuration' },
  { key: 'whatsapp', label: 'WhatsApp gateway', gate: 'whatsapp_configuration' },
  { key: 'notification-templates', label: 'Notification templates', gate: 'notification_templates' },
];

export const navGroups: NavGroup[] = [
  {
    label: 'Main',
    items: [
      { to: '/admin/dashboard', label: 'Dashboard', icon: Gauge, gates: ['dashboard_access'] },
      { to: '/admin/pos', label: 'Point of sale', icon: ShoppingCart, gates: ['pos_portal'], keywords: 'pos order cart sell' },
      { to: '/admin/kitchen-display', label: 'Kitchen display', icon: ChefHat, gates: ['kitchen_portal'], keywords: 'kitchen bar chef' },
      { to: '/admin/sales', label: 'Sales', icon: Receipt, gates: ['manage_sales'], keywords: 'orders invoices' },
      { to: '/admin/cashbooks', label: 'Cash books', icon: Wallet, gates: ['cashbooks_report'], mode: 'cashbooks', keywords: 'register' },
    ],
  },
  {
    label: 'Rooms',
    items: [
      { to: '/admin/reservations', label: 'Reservations', icon: CalendarClock, gates: ['manage_reservations'], mode: 'room_reservations_enabled' },
      { to: '/admin/guest-rooms', label: 'Guest rooms', icon: BedDouble, gates: ['manage_guest_rooms'], mode: 'room_reservations_enabled' },
      { to: '/admin/booking-sources', label: 'Booking sources', icon: Globe, gates: ['manage_booking_sources'], mode: 'room_reservations_enabled' },
      { to: '/admin/reservation-statuses', label: 'Reservation statuses', icon: ListChecks, gates: ['manage_reservation_statuses'], mode: 'room_reservations_enabled' },
    ],
  },
  {
    label: 'Catalog',
    items: [
      { to: '/admin/products', label: 'Food items', icon: UtensilsCrossed, gates: ['manage_food_items'], keywords: 'products menu items' },
      { to: '/admin/categories', label: 'Food categories', icon: LayoutGrid, gates: ['manage_food_categories'] },
      { to: '/admin/modifiers', label: 'Modifiers', icon: Layers, gates: ['manage_modifiers'], keywords: 'addons extras' },
      { to: '/admin/ingredients', label: 'Ingredients', icon: Salad, gates: ['manage_ingredients'], keywords: 'stock inventory' },
    ],
  },
  {
    label: 'Expenses',
    items: [
      { to: '/admin/expenses', label: 'Expenses', icon: CreditCard, gates: ['manage_expenses'] },
      { to: '/admin/expense-types', label: 'Expense types', icon: Tags, gates: ['manage_expense_types'] },
    ],
  },
  {
    label: 'People',
    items: [
      { to: '/admin/customers', label: 'Customers', icon: Users, gates: ['manage_customers'] },
      { to: '/admin/users', label: 'Users', icon: User, gates: ['manage_users'], keywords: 'staff employees' },
      { to: '/admin/user-roles', label: 'User roles', icon: ShieldCheck, gates: ['manage_user_roles'], keywords: 'permissions' },
    ],
  },
  {
    label: 'Reports',
    items: [
      { to: '/admin/overall-sale-report', label: 'Sales report', icon: BarChart3, gates: ['overall_sale_report'] },
      { to: '/admin/overall-expense-report', label: 'Expense summary', icon: BarChart3, gates: ['overall_expense_report'] },
      { to: '/admin/category-based-report', label: 'Category report', icon: Boxes, gates: ['category_based_report'] },
      { to: '/admin/most-sold-items-report', label: 'Most sold items', icon: Soup, gates: ['most_sold_items_report'] },
      { to: '/admin/tax-report', label: 'Tax report', icon: Percent, gates: ['tax_report'] },
      { to: '/admin/expense-report', label: 'Expense report', icon: FileText, gates: ['expense_report'] },
      { to: '/admin/stock-alerts', label: 'Stock alerts', icon: TriangleAlert, gates: ['stock_alerts'] },
      { to: '/admin/expiry-alerts', label: 'Expiry alerts', icon: CalendarX, gates: ['expiry_alerts'], mode: 'allow_expiry_date' },
    ],
  },
  {
    label: 'Setup',
    items: [
      { to: '/admin/service-tables', label: 'Service tables', icon: Store, gates: ['manage_service_tables'], keywords: 'dining tables qr' },
      { to: '/admin/payment-methods', label: 'Payment methods', icon: CreditCard, gates: ['manage_payment_methods'] },
      { to: '/admin/pickup-points', label: 'Pickup points', icon: MapPin, gates: ['manage_pickup_points'] },
      { to: '/admin/imports-exports', label: 'Import & export', icon: FileDown, gates: ['import_exports'], keywords: 'csv excel' },
      { to: '/admin/languages', label: 'Languages', icon: BookOpen, gates: ['manage_languages'], keywords: 'translations' },
      { to: '/admin/backup', label: 'Database backups', icon: Database, gates: ['database_backup'] },
      { to: '/admin/activity-logs', label: 'Activity logs', icon: History, gates: ['activity_logs'] },
      { to: '/admin/settings', label: 'Settings', icon: Cog, gates: settingsTabs.map((t) => t.gate) },
    ],
  },
  {
    label: 'Me',
    items: [
      { to: '/admin/account', label: 'My account', icon: Package, keywords: 'profile password' },
      { to: '/admin/my-logs', label: 'My activity', icon: ClipboardList },
    ],
  },
];

export function visibleNav(can: (...g: string[]) => boolean, modes: Modes): NavGroup[] {
  return navGroups
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => (!i.gates || can(...i.gates)) && (!i.mode || !!modes[i.mode])),
    }))
    .filter((g) => g.items.length);
}

/** First page this user may open, used after login. */
export function homePath(can: (...g: string[]) => boolean, modes: Modes): string {
  return visibleNav(can, modes)[0]?.items[0]?.to ?? '/admin/account';
}
