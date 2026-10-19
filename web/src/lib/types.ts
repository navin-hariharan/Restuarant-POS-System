import type { TaxSetup } from './cart';

export type Modes = {
  cashbooks: boolean;
  print_on_submit: boolean;
  customer_tip_collection: boolean;
  bypass_kitchen_bar: boolean;
  allow_table_reselect: boolean;
  table_is_option: boolean;
  allow_to_edit_checked_orders: boolean;
  /** Misnamed env flag (DISABLE_ROOM_RESERVATIONS): truthy ENABLES room reservations. */
  disable_room_reservations: boolean;
  room_reservations_enabled: boolean;
  elengent_search: boolean;
  item_based_tax: boolean;
  item_consumption_mode: boolean;
  autoclose_service_table_model: boolean;
  autoclose_pickup_model: boolean;
  autoclose_customer_model: boolean;
  autoclose_shipping_model: boolean;
  taxation: boolean;
  digital_menu: boolean;
  allow_expiry_date: boolean;
};

export type PrinterConfig = {
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
  terms_conditions: string | null;
  print_auto: boolean;
  invoice_type: string | null;
  display_logo: boolean;
};

export type AppConfig = {
  url: string;
  name: string;
  phone: string | null;
  address: string | null;
  portal_about: string | null;
  register: boolean;
  icon: string;
  background: string;
  recaptcha_enabled: boolean;
  recaptcha_public: string | null;
  meta_home_title: string | null;
  app_date_format: string;
  app_date_locale: string;
  app_timezone: string;
  currency_symbol: string;
  currency_symbol_on_left: boolean;
  tax_setup: TaxSetup;
  synchronizer_dispay: boolean;
  is_demo_mode: boolean;
  version: string;
  printer: PrinterConfig;
  time_date_formats: string[];
  order_types: { title: string; key: string }[];
  app_direction: 'ltr' | 'rtl';
  tax_id: string | null;
  locale: string;
  modes: Modes;
};

export type Role = {
  id: number;
  name: string;
  is_primary: boolean;
  users?: number;
  permissions: string[];
  admin_access?: boolean;
  ordertaking_access?: boolean;
  kitchendisplay_access?: boolean;
  billingdisplay_access?: boolean;
};

export type User = {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
  company_address?: string | null;
  company_name?: string | null;
  avatar: string | null;
  gravatar?: string;
  role: Role;
  role_id: number;
  status: boolean;
  created_at?: string;
  updated_at?: string;
};

export type Language = { id: number; name: string; locale: string; direction?: string; [k: string]: any };
