<div align="center">

<img src="docs/assets/banner.webp" alt="Restaurant POS: orders, kitchen, digital menu and reports in one app" width="100%" />

<br />
<br />

# Restaurant POS

**Take orders, run the kitchen and close the day from one fast, dependable app.**

From the first tap at the counter to the last report of the night.

<br />

![Rust](https://img.shields.io/badge/Server-Rust%20%2B%20axum-dea584?style=for-the-badge&logo=rust&logoColor=white)
![React](https://img.shields.io/badge/Web-React%2018-61dafb?style=for-the-badge&logo=react&logoColor=black)
![MariaDB](https://img.shields.io/badge/Database-MariaDB%20%7C%20MySQL-003545?style=for-the-badge&logo=mariadb&logoColor=white)
![Docker](https://img.shields.io/badge/Deploy-Docker%20%7C%20Dokploy-2496ed?style=for-the-badge&logo=docker&logoColor=white)

![Version](https://img.shields.io/badge/version-1.0.0-1d6ef1?style=flat-square)
![Responsive](https://img.shields.io/badge/screens-280px%20→%204K-34d3b2?style=flat-square)
![Dark mode](https://img.shields.io/badge/theme-light%20%2B%20dark-0f172a?style=flat-square)
![License](https://img.shields.io/badge/license-proprietary-ef4444?style=flat-square)

<br />

[**Features**](#-features) ·
[**Screenshots**](#-take-the-tour) ·
[**Quick start**](#-quick-start) ·
[**Deploy on Dokploy**](#-deploy-on-dokploy) ·
[**Configuration**](#%EF%B8%8F-configuration) ·
[**Development**](#-development)

<br />

Designed and developed by **Navin Hariharan**. All rights reserved.

</div>

---

## 🐧 Meet the app

Restaurant POS is a complete point of sale for restaurants, cafés, cloud kitchens and hotels with a dining room. One small Rust server runs everything. It serves the API, the web app and the uploaded pictures, and it stores its data in MariaDB or MySQL.

Waiters take orders on a tablet, the kitchen sees them on a big screen, guests order from a QR code on their table, and the owner checks the numbers from a phone. Every screen is the same web app, so there is nothing to install on the devices.

<div align="center">
  <img src="docs/assets/devices.webp" alt="The point of sale on a laptop, the kitchen display on a tablet and the digital menu on phones" width="100%" />
</div>

<table>
  <tr>
    <td width="33%" valign="top">
      <h3>⚡ Fast</h3>
      One compiled binary of about 16 MB with no PHP, no Node and no web server to tune. Responses are compressed, and screens refresh in the background as soon as anything changes.
    </td>
    <td width="33%" valign="top">
      <h3>🛡️ Dependable</h3>
      Database backups with one-click restore and an automatic safety copy before every restore. The container runs as a non-root user and has its own health check.
    </td>
    <td width="33%" valign="top">
      <h3>📱 Everywhere</h3>
      Built for every screen, from 280 px folding phones through tablets and laptops to 4K and ultra-wide monitors, in light and dark themes.
    </td>
  </tr>
</table>

---

## ✨ Features

<table>
  <tr>
    <td width="50%" valign="top">

### 🧾 Point of sale
- Dine-in, pickup and delivery orders, with tables, pickup points and delivery addresses
- Product grid with category rail, search and barcode scanning
- Variants, modifiers (add-ons) and notes for the chef
- Discounts as a percentage or an amount, tips, and split bills
- Order-level or item-level tax, inclusive or exclusive, VAT or fixed
- Several payment methods per restaurant (cash, card, UPI and more)
- Cash register: open and close the drawer, with a cash book per shift
- Printed receipts with a configurable layout (paper size, fonts, logo, terms) and optional auto-print

</td>
    <td width="50%" valign="top">

### 👨‍🍳 Kitchen display
- Live order board with **Kitchen** and **Bar** queues
- Colour-coded timers: under 10 minutes, 10 to 20 minutes, over 20 minutes
- Tick items as they are ready, or mark a whole order ready
- Assign a chef, acknowledge new orders and print kitchen tickets
- Sound alert for new orders, plus a full-screen mode for wall screens

### 📲 Digital menu
- A QR code for every table opens the menu on the guest's phone
- Guests browse, search, pick add-ons and send the order to the kitchen
- Orders arrive on the POS and the kitchen display straight away

</td>
  </tr>
  <tr>
    <td width="50%" valign="top">

### 📊 Dashboard and reports
- Today, this month and this year at a glance, compared with the previous period
- Sales by month against last year, plus revenue broken down into cost, profit, tax and tips
- Reports for sales, expense summaries, categories, best-selling items, tax and expenses
- Filters for period, order type, table, payment method and staff
- Export to CSV and print any report

### 🥕 Catalogue and stock
- Food items with pictures, SKUs, costs, margins and a kitchen or bar flag
- Categories, modifiers and ingredients
- Ingredient consumption, stock alerts and expiry alerts

</td>
    <td width="50%" valign="top">

### 🏨 Rooms and reservations
- Guest rooms, booking sources and reservation statuses
- Check-in and check-out, with room-service orders billed to the stay

### 👥 People and security
- Users and roles with fine-grained permissions
- Separate access for the admin area, order taking, the kitchen and billing
- Activity log of who did what and when
- Optional reCAPTCHA and self-registration

### 🧰 Operations
- Mail (SMTP or Mailgun), SMS (Vonage or Twilio) and WhatsApp notifications with editable templates
- Translations with right-to-left support and a translation editor
- Import and export data as CSV or Excel
- **Database backups**: create, download, upload and restore

</td>
  </tr>
</table>

---

## 📸 Take the tour

### Dashboard

<img src="docs/screenshots/dashboard.webp" alt="Dashboard with sales, profit, expenses, sales by month and revenue breakdown" width="100%" />

### Point of sale

<img src="docs/screenshots/pos.webp" alt="Point of sale with the product grid and an order in the cart" width="100%" />

### Kitchen display

<img src="docs/screenshots/kitchen.webp" alt="Kitchen display with colour-coded order tickets" width="100%" />

### Light or dark, your choice

<img src="docs/assets/light-dark.webp" alt="The dashboard in the light and dark themes" width="100%" />

### In your pocket

<img src="docs/assets/phones.webp" alt="Dashboard, point of sale, digital menu and kitchen display on phones" width="100%" />

<details>
<summary><b>🖼️ More screens (click to expand)</b></summary>
<br />

| Food items | Sale orders |
| :---: | :---: |
| <img src="docs/screenshots/products.webp" alt="Food items" /> | <img src="docs/screenshots/sales.webp" alt="Sale orders" /> |
| **Sales report** | **Most sold items** |
| <img src="docs/screenshots/report.webp" alt="Sales report" /> | <img src="docs/screenshots/items-report.webp" alt="Most sold items report" /> |
| **Database backups** | **Settings** |
| <img src="docs/screenshots/backup.webp" alt="Database backups" /> | <img src="docs/screenshots/settings.webp" alt="Settings" /> |
| **POS in dark mode** | **Kitchen in dark mode** |
| <img src="docs/screenshots/pos-dark.webp" alt="POS, dark theme" /> | <img src="docs/screenshots/kitchen-dark.webp" alt="Kitchen display, dark theme" /> |
| **POS on a tablet** | **Kitchen on a tablet** |
| <img src="docs/screenshots/tablet-pos.webp" alt="POS on a tablet" /> | <img src="docs/screenshots/tablet-kitchen.webp" alt="Kitchen display on a tablet" /> |
| **Sign in** | **Reports in dark mode** |
| <img src="docs/screenshots/login.webp" alt="Sign-in page" /> | <img src="docs/screenshots/report-dark.webp" alt="Sales report, dark theme" /> |

</details>

> [!NOTE]
> The screenshots use a demo restaurant, *The Hungry Penguin*, with an illustrated menu and sample orders. No real customer data is shown.

---

## 🏗️ How it fits together

```mermaid
flowchart LR
    subgraph Devices["Any device with a browser"]
        POS["🧾 Point of sale"]
        KDS["👨‍🍳 Kitchen display"]
        DM["📲 Digital menu (QR)"]
        ADM["📊 Admin and reports"]
    end

    subgraph Server["pos-server (one Rust binary)"]
        WEB["Web app<br/>React + Vite"]
        API["JSON API<br/>/api/v1 (axum)"]
        FILES["Uploads<br/>/storage"]
    end

    DB[("MariaDB / MySQL")]
    DATA[["/data volume<br/>images · backups · translations"]]
    OUT["✉️ Mail · SMS · WhatsApp"]

    POS & KDS & DM & ADM -->|HTTPS| WEB
    WEB --> API
    API <--> DB
    API <--> DATA
    FILES --- DATA
    API --> OUT
```

| Layer | Technology |
| --- | --- |
| **Server** | Rust, [axum](https://github.com/tokio-rs/axum), [tokio](https://tokio.rs), [sqlx](https://github.com/launchbadge/sqlx), tower-http (compression, limits, timeouts) |
| **Web app** | React 18, TypeScript, Vite, Tailwind CSS, TanStack Query, Recharts |
| **Database** | MariaDB 10.6+ or MySQL 8 |
| **Packaging** | Multi-stage Dockerfile on Debian slim, running as a non-root user |

### Security built in

- 🔐 Passwords hashed with bcrypt, and API tokens stored only as SHA-256 hashes
- 🚦 Rate limits on the API and on sign-in attempts
- 🧱 A strict Content Security Policy plus `nosniff`, frame and referrer headers
- 🙈 Stored mail passwords and SMS/WhatsApp tokens are never sent back to the browser
- 💳 Digital-menu orders are priced on the server from the database, never from the guest's browser
- 🧯 Upload checks: file types are verified by content, archives are size-capped, and paths are sanitised

---

## 🚀 Quick start

Run the app and a database on your own computer with Docker Compose:

```bash
cp .env.example .env      # set the passwords
docker compose up -d --build
```

Open **http://localhost:8080** and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env`. If no password is set, a generated one is printed once in `docker compose logs app`.

---

## ☁️ Deploy on Dokploy

1. In Dokploy, create a **MariaDB** database service, or use an existing MariaDB/MySQL server. Note its internal host, port, database, user and password.
2. Create an **Application**, connect this repository, and choose **Build Type: Dockerfile** (Dockerfile path `Dockerfile`, context `.`).
3. Set the environment (Application > Environment):

   ```env
   DB_HOST=<database service host>
   DB_PORT=3306
   DB_DATABASE=pos
   DB_USERNAME=pos
   DB_PASSWORD=<password>
   APP_URL=https://pos.example.com
   ADMIN_EMAIL=you@example.com
   ADMIN_PASSWORD=<first admin password>
   ```

   `DATABASE_URL=mysql://user:password@host:3306/pos` can replace the `DB_*` values.
4. Under Advanced > Volumes, mount a volume at **`/data`** for uploaded images, backups and translations. Without it they are lost on every redeploy.
5. Under Domains, add your domain with **container port 8080** and HTTPS on. Dokploy's proxy handles TLS.
6. Deploy. On an empty database the schema and starting data are created, and the administrator is `ADMIN_EMAIL` / `ADMIN_PASSWORD`. When no password is set, a generated one is printed once in the deployment logs.

> [!TIP]
> The container runs as a non-root user and has a health check (`pos-server healthcheck`, which calls `/api/health`), so Dokploy knows when a new version is ready.

### 📦 Bringing data from the previous system

Nothing is imported automatically. Sign in as an administrator and open **Settings > Database Backups**:

1. **Upload** the old database backup (`.sql` or `.sql.gz`). To bring the old product images and translations too, upload a `.zip` of the old server's `storage/app/public` (or `public/storage`) folder and language files.
2. Press **Restore** on the uploaded backup. A safety backup of the current database is taken first, and the restored database is upgraded automatically.
3. Sign in again with an account from the restored database. Old passwords keep working.

> [!IMPORTANT]
> After restoring, review **Settings > General / Localization** (date format, time zone) and **Settings > Advance**. The previous system kept some of these values in a configuration file. Now the values stored in the database are the ones used.

---

## ⚙️ Configuration

Everything an administrator can change lives in the database and is edited in **Settings**. Environment variables only describe the deployment:

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` or `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD` | `127.0.0.1:3306/pos`, user `pos` | Database connection |
| `PORT` | `8080` | HTTP port |
| `APP_URL` | empty | Public address used in links in mails and exports (links are relative when empty) |
| `DATA_DIR` | `/data` in Docker | Uploaded images, backups, translations |
| `WEB_DIR` | `/app/web` in Docker | Built web app |
| `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | `Administrator`, `admin@example.com`, generated | First administrator of an empty database |
| `DB_WAIT_SECONDS` | `90` | How long to wait for the database at start |
| `DB_BACKUPS_LIMIT` | `10` | Manual backups kept |
| `MAX_BACKUP_UPLOAD_MB` | `1024` | Largest backup upload |
| `THROTTLE_MAX_ATTEMPTS` | `120` | API requests per minute per user |
| `TRUSTED_PROXIES` | `1` | Proxies in front of the app that add `X-Forwarded-For` (Traefik in Dokploy is one); `0` ignores the header and uses the connection's address |
| `TRUST_X_REAL_IP` | `false` | Use `X-Real-IP` when there is no `X-Forwarded-For` |
| `DEMO_MODE` | `false` | Accept changes but discard them |
| `LOG_LEVEL` | `info` | Log detail (`warn`, `debug`, ...) |
| `MYSQLDUMP_PATH`, `MYSQL_CLIENT_PATH` | `mariadb-dump`, `mariadb` | Backup tools |

### 🖥️ Command line

```text
pos-server                              start the server
pos-server migrate                      create or upgrade the database schema, then exit
pos-server set-password <email> [pass]  reset a user's password (signs them out everywhere)
pos-server healthcheck                  exit 0 when the server is healthy
```

In Docker: `docker exec -it <container> pos-server set-password you@example.com`.

---

## 🛠️ Development

```bash
# server (needs a MariaDB database)
cd server
DATABASE_URL=mysql://pos:pos@127.0.0.1:3306/pos DATA_DIR=../data cargo run

# web app, with the API proxied to the server on :8080
cd web
npm install
npm run dev
```

`npm run build` collects the translation keys of the web app and the server into `server/lang/en.json` and builds `web/dist`.

| Check | Command |
| --- | --- |
| Server tests | `cargo test` in `server/` |
| Lints | `cargo clippy --all-targets` in `server/` |
| Web tests | `npm test` in `web/` |
| Type check | `npm run typecheck` in `web/` |

### 🗂️ Project layout

```text
.
├── server/                 Rust server
│   ├── src/api/            API modules (POS, sales, reports, settings, backups, ...)
│   ├── sql/schema.sql      Database schema for a new installation
│   └── lang/en.json        English source strings for translations
├── web/                    React web app
│   ├── src/pages/          Screens (dashboard, POS, kitchen, digital menu, ...)
│   ├── src/components/     Shared UI
│   └── public/             Logo, icons, placeholder images, order chime
├── docs/                   README pictures (banner, mock-ups, screenshots)
├── Dockerfile              Production image (web build, server build, slim runtime)
└── docker-compose.yml      App and MariaDB for running locally
```

---

## ❓ FAQ

<details>
<summary><b>Which devices do I need?</b></summary>

Any device with a modern browser. Use a laptop or tablet for the counter, a large screen for the kitchen, and the guests' own phones for the digital menu. The app can also be added to the home screen like an app.
</details>

<details>
<summary><b>Can I change the logo and the restaurant name?</b></summary>

Yes. Set the name, address and phone in **Settings > General**, and the logo and sign-in background in **Settings > Appearance**. Receipts can print the logo too (**Settings > Invoice printing**).
</details>

<details>
<summary><b>How do I move to a new server?</b></summary>

Create a backup in **Settings > Database Backups** and download it. On the new server, upload it in the same place and press **Restore**. Copy the `/data` volume across if you want to keep the uploaded pictures.
</details>

<details>
<summary><b>I forgot the admin password.</b></summary>

Run `pos-server set-password you@example.com` on the server (with Docker: `docker exec -it <container> pos-server set-password you@example.com`).
</details>

---

## 📄 License

Copyright © 2026 Navin Hariharan. **All rights reserved.**

Restaurant POS is proprietary software owned by Navin Hariharan. It may not be copied, modified, distributed or used without Navin Hariharan's written permission. See [LICENSE.md](LICENSE.md).

Third-party components keep their own licenses, listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

<div align="center">
<br />
<img src="docs/assets/logo.png" alt="" width="48" />
<br />
<sub>Made with care for busy kitchens · <b>Navin Hariharan</b></sub>
</div>
