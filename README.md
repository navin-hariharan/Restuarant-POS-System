# Restaurant POS

Point of sale for restaurants: POS screen, kitchen display, digital menu with
table ordering, sales, cash books, stock and ingredients, expenses, customers,
room reservations, reports, users and roles, translations, notifications
(mail, SMS, WhatsApp) and database backups.

Developed by **Navin Hariharan**. All rights reserved.

- `server/`: the Rust server (axum, sqlx). One binary serves the JSON API
  (`/api/v1`), the web app and uploaded images (`/storage`).
- `web/`: the React web app (Vite, Tailwind).
- Database: MariaDB 10.6+ or MySQL 8.

## Deploy on Dokploy

1. In Dokploy create a **MariaDB** database service (or use an existing
   MariaDB/MySQL server). Note its internal host, port, database, user and
   password.
2. Create an **Application**, connect this repository, and choose
   **Build Type: Dockerfile** (Dockerfile path `Dockerfile`, context `.`).
3. Environment (Application > Environment):

   ```
   DB_HOST=<database service host>
   DB_PORT=3306
   DB_DATABASE=pos
   DB_USERNAME=pos
   DB_PASSWORD=<password>
   APP_URL=https://pos.example.com
   ADMIN_EMAIL=you@example.com
   ADMIN_PASSWORD=<first admin password>
   ```

   `DATABASE_URL=mysql://user:password@host:3306/pos` can replace the `DB_*`
   values.
4. Advanced > Volumes: mount a volume at **`/data`** (uploaded images,
   backups, translations). Without it they are lost on redeploy.
5. Domains: add your domain with **container port 8080** and HTTPS on.
   Dokploy's proxy terminates TLS.
6. Deploy. On an empty database the schema and starting data are created and
   the administrator is `ADMIN_EMAIL` / `ADMIN_PASSWORD` (when no password is
   set, a generated one is printed once in the deployment logs).

The container runs as a non-root user and has a health check
(`pos-server healthcheck`, which calls `/api/health`).

### Bringing data from the previous system

Nothing is imported automatically. Sign in as an administrator and open
**Settings > Database Backups**:

1. **Upload** the old database backup (`.sql` or `.sql.gz`). To bring the old
   product images and translations too, upload a `.zip` of the old server's
   `storage/app/public` (or `public/storage`) folder and language files.
2. Press **Restore** on the uploaded backup. A safety backup of the current
   database is taken first. The restored database is upgraded automatically.
3. Sign in again with an account from the restored database. Old passwords
   keep working.

After restoring, review **Settings > General / Localization** (date format,
time zone) and **Settings > Advance**: the previous system kept some of these
in a configuration file, while now the values stored in the database are the
ones used.

## Run locally with Docker Compose

```
cp .env.example .env      # set the passwords
docker compose up -d --build
```

Open http://localhost:8080.

## Configuration

Everything an administrator can change lives in the database and is edited in
**Settings**. Environment variables only describe the deployment:

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` or `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD` | `127.0.0.1:3306/pos`, user `pos` | Database connection |
| `PORT` | `8080` | HTTP port |
| `APP_URL` | empty | Public address used in links in mails and exports; links are relative when empty |
| `DATA_DIR` | `/data` in Docker | Uploaded images, backups, translations |
| `WEB_DIR` | `/app/web` in Docker | Built web app |
| `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | `Administrator`, `admin@example.com`, generated | First administrator of an empty database |
| `DB_WAIT_SECONDS` | `90` | How long to wait for the database at start |
| `DB_BACKUPS_LIMIT` | `10` | Manual backups kept |
| `MAX_BACKUP_UPLOAD_MB` | `1024` | Largest backup upload |
| `THROTTLE_MAX_ATTEMPTS` | `120` | API requests per minute per user |
| `DEMO_MODE` | `false` | Accept but discard changes |
| `LOG_LEVEL` | `info` | Log detail (`warn`, `debug`, ...) |
| `MYSQLDUMP_PATH`, `MYSQL_CLIENT_PATH` | `mariadb-dump`, `mariadb` | Backup tools |

### Command line

```
pos-server                              start the server
pos-server migrate                      create or upgrade the database schema, then exit
pos-server set-password <email> [pass]  reset a user's password (signs them out everywhere)
pos-server healthcheck                  exit 0 when the server is healthy
```

In Docker: `docker exec -it <container> pos-server set-password you@example.com`.

## Development

```
# server (needs a MariaDB database)
cd server
DATABASE_URL=mysql://pos:pos@127.0.0.1:3306/pos DATA_DIR=../data cargo run

# web app, with the API proxied to the server on :8080
cd web
npm install
npm run dev
```

`npm run build` collects the translation keys of the web app and the server
into `server/lang/en.json` and builds `web/dist`.

Tests: `cargo test` in `server/`, `npm test` and `npm run typecheck` in `web/`.

## License

Copyright © 2026 Navin Hariharan. **All rights reserved.**

Restaurant POS is proprietary software owned by Navin Hariharan. It may not
be copied, modified, distributed or used without Navin Hariharan's written
permission. See [LICENSE.md](LICENSE.md).

Third-party components keep their own licenses, listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
