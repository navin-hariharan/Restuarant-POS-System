CREATE TABLE `booking_sources` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `title` varchar(191) NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `cash_books` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `uuid` varchar(191) NOT NULL,
  `user_id` bigint(20) unsigned DEFAULT NULL,
  `opening_amount` decimal(10,2) NOT NULL DEFAULT 0.00,
  `closed` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `cash_books_user_id_foreign` (`user_id`),
  CONSTRAINT `cash_books_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `customers` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `uuid` varchar(191) NOT NULL,
  `name` varchar(191) NOT NULL,
  `phone` varchar(191) DEFAULT NULL,
  `email` varchar(191) DEFAULT NULL,
  `address` longtext DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  `shipping_addresses` longtext DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `expense_types` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `title` varchar(191) NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `expenses` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `title` varchar(191) NOT NULL,
  `amount` double(8,2) NOT NULL,
  `description` text DEFAULT NULL,
  `expense_type_id` bigint(20) unsigned NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  `expense_date` varchar(191) DEFAULT NULL,
  `cash_book_id` bigint(20) unsigned DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `expenses_expense_type_id_foreign` (`expense_type_id`),
  KEY `expenses_cash_book_id_foreign` (`cash_book_id`),
  CONSTRAINT `expenses_cash_book_id_foreign` FOREIGN KEY (`cash_book_id`) REFERENCES `cash_books` (`id`),
  CONSTRAINT `expenses_expense_type_id_foreign` FOREIGN KEY (`expense_type_id`) REFERENCES `expense_types` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `failed_jobs` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `connection` text NOT NULL,
  `queue` text NOT NULL,
  `payload` longtext NOT NULL,
  `exception` longtext NOT NULL,
  `failed_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `food_categories` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(191) NOT NULL,
  `image` varchar(191) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `food_item_attributes` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `uuid` varchar(191) NOT NULL,
  `sku` varchar(191) NOT NULL,
  `name` varchar(191) NOT NULL,
  `price` double(8,2) NOT NULL DEFAULT 1.00,
  `cost` double(8,2) NOT NULL DEFAULT 0.00,
  `food_item_id` bigint(20) unsigned NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `food_items` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `uuid` varchar(191) NOT NULL,
  `sku` varchar(191) NOT NULL,
  `name` varchar(191) NOT NULL,
  `price` double(8,2) NOT NULL DEFAULT 1.00,
  `cost` double(8,2) NOT NULL DEFAULT 0.00,
  `image` varchar(191) DEFAULT NULL,
  `food_category_id` bigint(20) unsigned NOT NULL,
  `description` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  `is_bar_type` tinyint(1) NOT NULL DEFAULT 0,
  `has_variants` tinyint(1) NOT NULL DEFAULT 0,
  `tax_id` bigint(20) unsigned DEFAULT NULL,
  `expiry_date` varchar(191) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `food_items_food_category_id_foreign` (`food_category_id`),
  CONSTRAINT `food_items_food_category_id_foreign` FOREIGN KEY (`food_category_id`) REFERENCES `food_categories` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `food_items_ingredients` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `food_item_id` bigint(20) unsigned DEFAULT NULL,
  `ingredient_id` bigint(20) unsigned DEFAULT NULL,
  `quantity` double(8,2) NOT NULL DEFAULT 0.00,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  `food_item_attribute_id` bigint(20) unsigned DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `food_items_ingredients_food_item_id_foreign` (`food_item_id`),
  KEY `food_items_ingredients_ingredient_id_foreign` (`ingredient_id`),
  CONSTRAINT `food_items_ingredients_food_item_id_foreign` FOREIGN KEY (`food_item_id`) REFERENCES `food_items` (`id`) ON DELETE SET NULL,
  CONSTRAINT `food_items_ingredients_ingredient_id_foreign` FOREIGN KEY (`ingredient_id`) REFERENCES `ingredients` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `guest_room_reservations` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `uuid` varchar(191) NOT NULL,
  `tracking` varchar(191) NOT NULL,
  `payment_cleared` tinyint(1) NOT NULL DEFAULT 0,
  `note` text DEFAULT NULL,
  `staff_note` text DEFAULT NULL,
  `tax` text NOT NULL,
  `tax_amount` double(8,2) NOT NULL DEFAULT 0.00,
  `total_room_service_charges` double(8,2) NOT NULL DEFAULT 0.00,
  `payments` longtext DEFAULT NULL,
  `booked_at` timestamp NULL DEFAULT NULL,
  `reserved_at_date` varchar(191) DEFAULT NULL,
  `reserved_at_time` varchar(191) DEFAULT NULL,
  `reserved_till_date` varchar(191) DEFAULT NULL,
  `reserved_till_time` varchar(191) DEFAULT NULL,
  `reservation_status_id` bigint(20) unsigned DEFAULT NULL,
  `booking_source_id` bigint(20) unsigned DEFAULT NULL,
  `guest_room_id` bigint(20) unsigned DEFAULT NULL,
  `customer_id` bigint(20) unsigned DEFAULT NULL,
  `checkin_at` timestamp NULL DEFAULT NULL,
  `checkout_at` timestamp NULL DEFAULT NULL,
  `reservation_hours` varchar(191) NOT NULL DEFAULT '0',
  `charges` varchar(191) NOT NULL DEFAULT '0',
  `is_charge_per_use` tinyint(1) NOT NULL DEFAULT 0,
  `sub_total` varchar(191) NOT NULL DEFAULT '0',
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `guest_room_reservations_reservation_status_id_foreign` (`reservation_status_id`),
  KEY `guest_room_reservations_booking_source_id_foreign` (`booking_source_id`),
  KEY `guest_room_reservations_guest_room_id_foreign` (`guest_room_id`),
  KEY `guest_room_reservations_customer_id_foreign` (`customer_id`),
  CONSTRAINT `guest_room_reservations_booking_source_id_foreign` FOREIGN KEY (`booking_source_id`) REFERENCES `booking_sources` (`id`),
  CONSTRAINT `guest_room_reservations_customer_id_foreign` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`),
  CONSTRAINT `guest_room_reservations_guest_room_id_foreign` FOREIGN KEY (`guest_room_id`) REFERENCES `guest_rooms` (`id`),
  CONSTRAINT `guest_room_reservations_reservation_status_id_foreign` FOREIGN KEY (`reservation_status_id`) REFERENCES `reservation_statuses` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `guest_rooms` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `room_name` varchar(191) NOT NULL,
  `capactity` varchar(191) NOT NULL DEFAULT '1',
  `per_hour_charges` decimal(10,2) NOT NULL DEFAULT 0.00,
  `per_use_charges` decimal(10,2) NOT NULL DEFAULT 0.00,
  `layout` text DEFAULT NULL,
  `availability` tinyint(1) NOT NULL DEFAULT 1,
  `images` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `ingredients` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(191) NOT NULL,
  `price` double(8,2) NOT NULL DEFAULT 1.00,
  `cost` double(8,2) NOT NULL DEFAULT 0.00,
  `unit` varchar(191) NOT NULL,
  `quantity` int(11) NOT NULL DEFAULT 0,
  `alert_quantity` varchar(191) NOT NULL DEFAULT '25',
  `description` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `ingredients_modifiers` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `modifier_id` bigint(20) unsigned DEFAULT NULL,
  `ingredient_id` bigint(20) unsigned DEFAULT NULL,
  `quantity` double(8,2) NOT NULL DEFAULT 0.00,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `ingredients_modifiers_modifier_id_foreign` (`modifier_id`),
  KEY `ingredients_modifiers_ingredient_id_foreign` (`ingredient_id`),
  CONSTRAINT `ingredients_modifiers_ingredient_id_foreign` FOREIGN KEY (`ingredient_id`) REFERENCES `ingredients` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ingredients_modifiers_modifier_id_foreign` FOREIGN KEY (`modifier_id`) REFERENCES `modifiers` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `jobs` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `queue` varchar(191) NOT NULL,
  `payload` longtext NOT NULL,
  `attempts` tinyint(3) unsigned NOT NULL,
  `reserved_at` int(10) unsigned DEFAULT NULL,
  `available_at` int(10) unsigned NOT NULL,
  `created_at` int(10) unsigned NOT NULL,
  PRIMARY KEY (`id`),
  KEY `jobs_queue_index` (`queue`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `languages` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `locale` varchar(191) NOT NULL,
  `name` varchar(191) NOT NULL,
  `direction` varchar(191) NOT NULL DEFAULT 'ltr',
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `media` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `uuid` char(36) NOT NULL,
  `extension` varchar(191) NOT NULL,
  `name` varchar(191) NOT NULL,
  `mime` varchar(191) NOT NULL,
  `disk` varchar(191) NOT NULL,
  `size` int(11) NOT NULL,
  `server_name` varchar(191) NOT NULL,
  `path` varchar(191) NOT NULL,
  `user_id` bigint(20) unsigned DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `media_user_id_foreign` (`user_id`),
  KEY `media_uuid_index` (`uuid`),
  CONSTRAINT `media_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `migrations` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `migration` varchar(191) NOT NULL,
  `batch` int(11) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `modifiers` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `title` varchar(191) NOT NULL,
  `price` double(8,2) NOT NULL,
  `cost` double(8,2) NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  `food_category_id` bigint(20) unsigned DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `modifiers_food_category_id_foreign` (`food_category_id`),
  CONSTRAINT `modifiers_food_category_id_foreign` FOREIGN KEY (`food_category_id`) REFERENCES `food_categories` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `password_reset_tokens` (
  `email` varchar(191) NOT NULL,
  `token` varchar(191) NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `password_resets` (
  `email` varchar(191) NOT NULL,
  `token` varchar(191) NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  KEY `password_resets_email_index` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `payment_methods` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `title` varchar(191) NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `personal_access_tokens` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `tokenable_type` varchar(191) NOT NULL,
  `tokenable_id` bigint(20) unsigned NOT NULL,
  `name` varchar(191) NOT NULL,
  `token` varchar(64) NOT NULL,
  `abilities` text DEFAULT NULL,
  `expires_at` timestamp NULL DEFAULT NULL,
  `last_used_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `personal_access_tokens_token_unique` (`token`),
  KEY `personal_access_tokens_tokenable_type_tokenable_id_index` (`tokenable_type`,`tokenable_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `pickup_points` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `place_title` varchar(191) NOT NULL,
  `person_name` varchar(191) DEFAULT NULL,
  `phone` varchar(191) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `product_offers` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `title` varchar(191) NOT NULL,
  `price` double(8,2) NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `reservation_statuses` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `title` varchar(191) NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `sale_items` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `sale_id` bigint(20) unsigned NOT NULL,
  `food_item_id` bigint(20) unsigned DEFAULT NULL,
  `food_category_id` varchar(191) DEFAULT NULL,
  `item_data` longtext NOT NULL,
  `item_name` varchar(191) NOT NULL,
  `quantity` int(11) NOT NULL,
  `price` decimal(10,2) NOT NULL,
  `total_amount` decimal(10,2) NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  `food_item_attribute_id` bigint(20) unsigned DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `sale_items_sale_id_foreign` (`sale_id`),
  CONSTRAINT `sale_items_sale_id_foreign` FOREIGN KEY (`sale_id`) REFERENCES `sales` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `sales` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `uuid` varchar(191) NOT NULL,
  `tracking` varchar(191) NOT NULL,
  `order_type` varchar(191) NOT NULL DEFAULT 'dining',
  `items` longtext NOT NULL,
  `tax` text NOT NULL,
  `tax_amount` double(8,2) NOT NULL DEFAULT 0.00,
  `subtotal` double(8,2) NOT NULL DEFAULT 0.00,
  `cart_total_items` varchar(191) NOT NULL DEFAULT '0',
  `cart_total_price` double(8,2) NOT NULL DEFAULT 0.00,
  `cart_total_cost` double(8,2) NOT NULL DEFAULT 0.00,
  `profit_after_all` double(8,2) NOT NULL DEFAULT 0.00,
  `payable_after_all` double(8,2) NOT NULL DEFAULT 0.00,
  `discount_rate` double(8,2) NOT NULL DEFAULT 0.00,
  `discount_amount` double(8,2) NOT NULL DEFAULT 0.00,
  `table_id` bigint(20) unsigned DEFAULT NULL,
  `order_taker_id` bigint(20) unsigned NOT NULL,
  `took_at` timestamp NULL DEFAULT NULL,
  `is_preparing` tinyint(1) NOT NULL DEFAULT 0,
  `chef_id` bigint(20) unsigned DEFAULT NULL,
  `prepared_at` timestamp NULL DEFAULT NULL,
  `after_discount` double(8,2) NOT NULL DEFAULT 0.00,
  `customer_id` bigint(20) unsigned DEFAULT NULL,
  `ordered_online` tinyint(1) NOT NULL DEFAULT 0,
  `biller_id` bigint(20) unsigned DEFAULT NULL,
  `completed_at` timestamp NULL DEFAULT NULL,
  `payment_note` text DEFAULT NULL,
  `staff_note` text DEFAULT NULL,
  `progress` int(11) NOT NULL DEFAULT 0,
  `payment_method_id` bigint(20) unsigned DEFAULT NULL,
  `note_for_chef` text DEFAULT NULL,
  `is_cancelled` tinyint(1) NOT NULL DEFAULT 0,
  `cancellation_reason` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  `is_discount_in_percentage` tinyint(1) NOT NULL DEFAULT 1,
  `shipping_address` text DEFAULT NULL,
  `pickup_point_id` bigint(20) unsigned DEFAULT NULL,
  `cash_book_id` bigint(20) unsigned DEFAULT NULL,
  `tip_amount` double(8,2) NOT NULL DEFAULT 0.00,
  `guest_room_reservation_id` bigint(20) unsigned DEFAULT NULL,
  `is_item_based_taxation` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `sales_table_id_foreign` (`table_id`),
  KEY `sales_order_taker_id_foreign` (`order_taker_id`),
  KEY `sales_chef_id_foreign` (`chef_id`),
  KEY `sales_customer_id_foreign` (`customer_id`),
  KEY `sales_biller_id_foreign` (`biller_id`),
  KEY `sales_payment_method_id_foreign` (`payment_method_id`),
  KEY `sales_pickup_point_id_foreign` (`pickup_point_id`),
  KEY `sales_cash_book_id_foreign` (`cash_book_id`),
  KEY `sales_guest_room_reservation_id_foreign` (`guest_room_reservation_id`),
  CONSTRAINT `sales_biller_id_foreign` FOREIGN KEY (`biller_id`) REFERENCES `users` (`id`),
  CONSTRAINT `sales_cash_book_id_foreign` FOREIGN KEY (`cash_book_id`) REFERENCES `cash_books` (`id`),
  CONSTRAINT `sales_chef_id_foreign` FOREIGN KEY (`chef_id`) REFERENCES `users` (`id`),
  CONSTRAINT `sales_customer_id_foreign` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`),
  CONSTRAINT `sales_guest_room_reservation_id_foreign` FOREIGN KEY (`guest_room_reservation_id`) REFERENCES `guest_room_reservations` (`id`),
  CONSTRAINT `sales_order_taker_id_foreign` FOREIGN KEY (`order_taker_id`) REFERENCES `users` (`id`),
  CONSTRAINT `sales_payment_method_id_foreign` FOREIGN KEY (`payment_method_id`) REFERENCES `payment_methods` (`id`),
  CONSTRAINT `sales_pickup_point_id_foreign` FOREIGN KEY (`pickup_point_id`) REFERENCES `pickup_points` (`id`),
  CONSTRAINT `sales_table_id_foreign` FOREIGN KEY (`table_id`) REFERENCES `service_tables` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `service_tables` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `title` varchar(191) DEFAULT NULL,
  `is_booked` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  `seating_pin` varchar(6) DEFAULT NULL,
  `seating_started_at` timestamp NULL DEFAULT NULL,
  `pin_failed_attempts` int(10) unsigned NOT NULL DEFAULT 0,
  `pin_locked_until` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `settings` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `app_name` varchar(191) NOT NULL DEFAULT 'Restaurant POS',
  `app_address` varchar(191) DEFAULT NULL,
  `app_phone` varchar(191) DEFAULT NULL,
  `app_https` varchar(191) DEFAULT NULL,
  `app_url` varchar(191) NOT NULL,
  `app_date_format` varchar(191) NOT NULL DEFAULT 'L',
  `app_date_locale` varchar(191) NOT NULL DEFAULT 'en',
  `app_default_role` varchar(191) NOT NULL DEFAULT '2',
  `app_background` varchar(191) DEFAULT NULL,
  `app_icon` varchar(191) DEFAULT NULL,
  `app_locale` varchar(191) NOT NULL DEFAULT 'en',
  `app_direction` varchar(191) NOT NULL DEFAULT 'ltr',
  `app_timezone` varchar(191) NOT NULL DEFAULT 'UTC',
  `app_user_registration` tinyint(1) NOT NULL DEFAULT 0,
  `queue_connection` varchar(191) NOT NULL DEFAULT 'sync',
  `mail_from_name` varchar(191) NOT NULL DEFAULT 'Restaurant POS',
  `mail_from_address` varchar(191) DEFAULT NULL,
  `mail_mailer` varchar(191) NOT NULL DEFAULT 'log',
  `mail_host` varchar(191) DEFAULT NULL,
  `mail_username` varchar(191) DEFAULT NULL,
  `mail_password` varchar(191) DEFAULT NULL,
  `mail_port` varchar(191) NOT NULL DEFAULT '2525',
  `mail_encryption` varchar(191) DEFAULT 'tls',
  `mailgun_domain` varchar(191) DEFAULT NULL,
  `mailgun_endpoint` varchar(191) DEFAULT NULL,
  `mailgun_secret` varchar(191) DEFAULT NULL,
  `recaptcha_enabled` tinyint(1) NOT NULL DEFAULT 0,
  `recaptcha_public` varchar(191) DEFAULT NULL,
  `recaptcha_private` varchar(191) DEFAULT NULL,
  `tax_rate` double(8,2) NOT NULL DEFAULT 0.00,
  `is_tax_fix` tinyint(1) NOT NULL DEFAULT 0,
  `is_vat` tinyint(1) NOT NULL DEFAULT 0,
  `is_tax_included` tinyint(1) NOT NULL DEFAULT 0,
  `tax_id` varchar(191) NOT NULL DEFAULT '1',
  `currency_symbol` varchar(191) NOT NULL DEFAULT '$',
  `currency_symbol_on_left` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  `print_font_family` varchar(191) NOT NULL DEFAULT 'monospace',
  `print_name_address_position` varchar(191) NOT NULL DEFAULT 'center',
  `print_name_address_size` varchar(191) NOT NULL DEFAULT '17',
  `print_header_footer_size` varchar(191) NOT NULL DEFAULT '14',
  `print_items_font_size` varchar(191) NOT NULL DEFAULT '8',
  `print_terms_conditions_font_size` varchar(191) NOT NULL DEFAULT '7',
  `print_font_color` varchar(191) NOT NULL DEFAULT '#00000',
  `printer_width` varchar(191) NOT NULL DEFAULT '100mm',
  `printer_height` varchar(191) NOT NULL DEFAULT '170mm',
  `signature_required` tinyint(1) NOT NULL DEFAULT 0,
  `terms_conditions` longtext DEFAULT NULL,
  `print_auto` tinyint(1) NOT NULL DEFAULT 1,
  `invoice_type_title` varchar(191) DEFAULT NULL,
  `tax_title` varchar(191) NOT NULL DEFAULT 'Tax',
  `advance_cashbook_mode` tinyint(1) NOT NULL DEFAULT 1,
  `advance_print_on_submit` tinyint(1) NOT NULL DEFAULT 1,
  `advance_customer_tip_collection` tinyint(1) NOT NULL DEFAULT 1,
  `advance_send_notification` tinyint(1) NOT NULL DEFAULT 0,
  `template_order_created` longtext DEFAULT NULL,
  `template_order_cancelled` longtext DEFAULT NULL,
  `template_order_checkout` longtext DEFAULT NULL,
  `wa_status` tinyint(1) NOT NULL DEFAULT 0,
  `wa_twilio_account_sid` varchar(191) DEFAULT NULL,
  `wa_twilio_auth_token` varchar(191) DEFAULT NULL,
  `wa_twilio_from` varchar(191) DEFAULT NULL,
  `sms_status` tinyint(1) NOT NULL DEFAULT 0,
  `sms_channel` varchar(191) DEFAULT NULL,
  `vonage_key` varchar(191) DEFAULT NULL,
  `vonage_secret` varchar(191) DEFAULT NULL,
  `vonage_from` varchar(191) DEFAULT NULL,
  `twilio_account_sid` varchar(191) DEFAULT NULL,
  `twilio_auth_token` varchar(191) DEFAULT NULL,
  `twilio_from` varchar(191) DEFAULT NULL,
  `mysqldump_path` varchar(191) NOT NULL DEFAULT 'mysqldump',
  `display_logo` tinyint(1) NOT NULL DEFAULT 0,
  `bypass_kitchen_bar` tinyint(1) NOT NULL DEFAULT 0,
  `allow_table_reselect` tinyint(1) NOT NULL DEFAULT 0,
  `table_is_option` tinyint(1) NOT NULL DEFAULT 0,
  `allow_to_edit_checked_orders` tinyint(1) NOT NULL DEFAULT 0,
  `disable_room_reservations` tinyint(1) NOT NULL DEFAULT 0,
  `vat_number` varchar(191) DEFAULT NULL,
  `elengent_search` tinyint(1) NOT NULL DEFAULT 0,
  `item_based_tax` tinyint(1) NOT NULL DEFAULT 0,
  `item_consumption_mode` tinyint(1) NOT NULL DEFAULT 1,
  `autoclose_service_table_model` tinyint(1) NOT NULL DEFAULT 0,
  `autoclose_pickup_model` tinyint(1) NOT NULL DEFAULT 0,
  `autoclose_customer_model` tinyint(1) NOT NULL DEFAULT 0,
  `autoclose_shipping_model` tinyint(1) NOT NULL DEFAULT 0,
  `taxation` tinyint(1) NOT NULL DEFAULT 1,
  `digital_menu` tinyint(1) NOT NULL DEFAULT 1,
  `allow_expiry_date` tinyint(1) NOT NULL DEFAULT 0,
  `digital_menu_require_pin` tinyint(1) NOT NULL DEFAULT 1,
  `seating_pin_max_hours` int(10) unsigned NOT NULL DEFAULT 8,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `taxes` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `tax_title` varchar(191) NOT NULL,
  `tax_rate` double(8,2) NOT NULL DEFAULT 0.00,
  `is_tax_fix` tinyint(1) NOT NULL DEFAULT 0,
  `is_vat` tinyint(1) NOT NULL DEFAULT 0,
  `is_tax_included` tinyint(1) NOT NULL DEFAULT 0,
  `tax_id` varchar(191) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `user_activity_logs` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint(20) unsigned NOT NULL,
  `activity` varchar(191) NOT NULL,
  `device` varchar(191) NOT NULL,
  `ip` varchar(191) NOT NULL,
  `link` varchar(191) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `user_roles` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(191) NOT NULL,
  `is_primary` tinyint(1) NOT NULL DEFAULT 0,
  `permissions` longtext DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `users` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(191) NOT NULL,
  `email` varchar(191) NOT NULL,
  `phone` varchar(191) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `avatar` varchar(191) DEFAULT NULL,
  `password` varchar(191) NOT NULL,
  `remember_token` varchar(100) DEFAULT NULL,
  `status` tinyint(1) NOT NULL DEFAULT 1,
  `role_id` bigint(20) unsigned NOT NULL,
  `email_verified_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_email_unique` (`email`),
  KEY `users_role_id_foreign` (`role_id`),
  CONSTRAINT `users_role_id_foreign` FOREIGN KEY (`role_id`) REFERENCES `user_roles` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

