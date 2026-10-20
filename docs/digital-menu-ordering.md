# Digital menu ordering: table codes and email verification

Guests order from the QR code on their table. Two checks make sure an order
really comes from someone sitting at that table:

1. **Table code.** Staff open the table and give the guests a 6-digit code.
2. **Verified email.** The guest confirms their email address with a code
   sent to it.

Both are on by default and can be switched off separately in
**Settings > Advance > Digital menu ordering**. With both off, the digital
menu works as it did before.

## Seating workflow

1. **Seat the guests.** Open the table from the till (**Service table** picker,
   then **Open table** under the table) or from **Setup > Service tables**
   (**Open table**). A dialog shows the code in large digits.
2. **Give them the code.** Read it out, or press **Print slip** for a small
   slip with the table name, the code and the menu's QR code.
3. **Guests order.** On the digital menu they enter the code in **Table code**,
   add their name and (when email verification is on) verify their email
   address, then place the order. The code is remembered in that browser tab,
   so later orders from the same phone don't ask again.
4. **The table closes by itself** when its last open order is paid, cancelled,
   deleted or moved to another table. A table that still has another open
   order stays open. Paid orders that are edited later never close a table
   that has since been opened for new guests.
5. **Close it by hand** with **Close table** in the same dialog, for example
   when guests leave without ordering.

The **Open** badge in the table picker and in Setup > Service tables shows
which tables are open. Pressing **Table code** on an open table shows its code
again. **Regenerate** gives the table a new code (the old one stops working).

### Wrong codes

- Five wrong codes in a row lock the table for ten minutes. Guests see "Too
  many incorrect table codes. Please ask a member of staff."
- **Regenerate** clears the lock straight away.
- Each client address can try at most 20 codes a minute.

### How long a code lasts

A code stops working after **Table code valid for (hours)** (default 8), as
if the table had been closed. Opening the table again gives it a new code.

## Email verification

1. The guest enters their email address and presses **Send code**.
2. A 6-digit code arrives by email ("Your verification code for <restaurant>").
   It is valid for 10 minutes.
3. The guest types it in and presses **Verify**. The address shows as
   verified and stays verified for that table until the table is closed, or
   for the table code's validity, at most 4 hours.
4. The order is saved under the verified address. With verification on, the
   customer record is picked by that address only, never by phone number.

Limits:

- A new code for the same address and table once a minute.
- At most 5 codes per address, 10 per client address and 30 per table in any
  hour.
- Five wrong tries burn a code; the guest asks for a new one.
- When the table code is required, a code is only sent after the table code
  is checked.

### Outgoing mail must be set up

Email verification needs **Settings > Outgoing mail** with a sender address
and an **Outgoing mail method** that actually delivers (SMTP, Mailgun or
SendMail):

- It can't be switched on while the mailer is **Log** or no sender address is
  set; saving shows an error.
- If mail stops being set up later (for example the mailer is changed to
  **Log**), verification is paused and the Advance screen says so. Guests can
  then order with the table code alone.
- If sending fails (wrong SMTP host or password, for example), the guest sees
  "We could not send the code. Please ask a member of staff." and the server
  log records the error, without the code.

Before relying on it, open a table and send a code to your own address from
the digital menu to check that mail arrives.

## Settings

| Setting | Where | Default |
| --- | --- | --- |
| Require a table code (`digital_menu_require_pin`) | Settings > Advance > Digital menu ordering | On |
| Require a verified email address (`digital_menu_verify_email`) | Settings > Advance > Digital menu ordering | On (paused until outgoing mail is set up) |
| Table code valid for (hours) (`seating_pin_max_hours`) | Settings > Advance > Digital menu ordering | 8 (1 to 72) |

The app config (`/api/v1/app-config`) exposes the two switches as
`modes.digital_menu_pin` and `modes.digital_menu_verify_email`.

## Who can open and close tables

Anyone with the **POS portal** (`pos_portal`) or **Manage service tables**
(`manage_service_tables`) permission. Opening, regenerating and closing are
recorded in the activity log with the table's name; the code itself is never
logged.

## API

Staff (signed in):

| Method and path | What it does |
| --- | --- |
| `POST /api/v1/pos/tables/{id}/seat` | Open the table. Returns `{pin, started_at, is_open}`. Calling it again returns the same code; send `regenerate: true` for a new one. |
| `POST /api/v1/pos/tables/{id}/pin/regenerate` | New code for the table; clears a lock. |
| `POST /api/v1/pos/tables/{id}/close` | Close the table: no code, and every email code and token for the table is deleted. |
| `GET /api/v1/pos/tables/{id}/pin` | The current code, or `pin: null` when the table is closed. |

Guests (no sign-in):

| Method and path | Body |
| --- | --- |
| `POST /api/v1/digital-menu/email-otp/send` | `{table_id, pin, email}` |
| `POST /api/v1/digital-menu/email-otp/verify` | `{table_id, email, code}`, returns `{verification_token}` |
| `POST /api/v1/digital-menu/order-collect` | As before, plus `pin` and, with verification on, `email` and `email_token` |

Errors come back on the `pin`, `email` and `otp` fields. The public table
list (`/api/v1/digital-menu/tables`) shows `is_open` for each table but never
the code or its counters.

## Upgrading

On start the server adds what it needs to an existing database:

- columns `seating_pin`, `seating_started_at`, `pin_failed_attempts` and
  `pin_locked_until` on `service_tables`;
- columns `digital_menu_require_pin`, `digital_menu_verify_email` and
  `seating_pin_max_hours` on `settings`;
- the `digital_menu_email_otps` table (migration
  `2026_10_20_000001_create_digital_menu_email_otps_table`).

Because both checks default to on, **guests can't order from the digital
menu after upgrading until staff open their table.** Switch **Require a table
code** off first if you'd rather roll it out later.
