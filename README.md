# Shepards Tyre Management

English/Hindi tyre logbook for Shepards Shipping Services. The app uses one shared server and requires internet. Android defaults to **https://tyre-management.onrender.com/**. This is an original implementation, inspired by the requested tyre-management workflows.

## Accounts and live records

- A new database seeds the requested **admin** owner account and fleet name **Shepards Shipping Services**. Use the initial password supplied by the owner. Existing server accounts and changed passwords are preserved on deployment/restart. There is no setup key.
- Only the admin can create staff accounts under **Team & settings → Add staff**, entering a unique username, password and confirmation. Usernames are case-insensitive and remain reserved after removal. Staff sign in directly with their assigned credentials. Public signup and invitation-code signup are disabled.
- Only the admin can **Remove staff**. This revokes all that staff member's sessions, including waiting live connections. Historical entries are retained. Staff can change their own passwords and record inventory movements, but cannot create/remove accounts.
- Every vehicle/tyre entry, fitment, removal, remold, scrap, odometer update and imported vehicle is recorded with the authenticated username and server timestamp. Clients cannot choose a different author. The logbook and CSV/JSON reports retain this attribution.
- All accounts on the server see the same data. Authenticated live-update requests wait for committed changes and deliver them to connected phones immediately. Waiting requests refresh at least every 10 seconds. Revisions and SQLite transactions reject conflicting writes rather than overwrite another user's work.
- There is no offline-login or offline-entry option. Losing connectivity displays **You are offline. Please connect to the internet.** (with a Hindi translation) and blocks entries. Reconnecting refreshes shared records. The app shell can cache only so this warning can be shown when offline; API data is not service-worker cached.
- Upgrading from the older offline APK ignores its local-mode preference. Existing IndexedDB records are not erased or automatically uploaded; they are separate from the live server. Export any needed local records using the old version before upgrading. Do not uninstall/clear storage to update.

## Tyres and vehicles

- Unique tyre IDs, brands/sizes, New / Used / Remold stock and scrap history.
- **Tyre Location** numbers 18 road positions from right to left on each row: 1–2, 3–6, 7–10, 11–14 and 15–18. Extra spacing is only between rows 2 and 3. Optional spare remains SP. Stable internal slot IDs preserve older assignments and history.
- A fitted tyre can be removed directly to stock, out for remolding or scrap. Each removal saves fitting/removal odometers, kilometres since fitting, lifetime kilometres and destination. A New tyre becomes Used on removal. Spare tyres accrue no road kilometres.
- Tyres out for remolding are counted separately and cannot be fitted until **Record remolding** returns them to stock. Mileage is preserved; completed remolding increments its cycle count.
- Scrap requires a dropdown reason: burst, worn tread, sidewall damage, cuts, bead damage, tread separation, age cracks, irreparable puncture, failed remold, or Other with required text. Reasons remain on the tyre, in history and in exports.
- Daily closing totals use India time and carry balances forward on days without movement. Active total = fitted + garage stock + out for remolding. Scrapped tyres stay in history.
- **Vehicles → Import from Excel** downloads a blank `.xlsx` template and previews ready/skipped rows before saving. Registration is required; name/driver is optional, blank odometer is 0 and blank spare is No. Maximum 200 vehicle rows / 2 MB. Duplicate registrations (case, spaces and hyphens ignored) and invalid rows are skipped. Multiple worksheets, common English/Hindi headings and Hindi Yes/No values are supported. Existing vehicles are not overwritten. Imported vehicles have empty 18-position layouts; tyres are not created. The ready batch is atomic, with one attributed log entry per vehicle.
- CSV log reports and JSON inventory exports are available. Reports are exports only; there is no JSON restore/import screen. Movements cannot be edited/deleted in the UI.

## Android update

[Download Shepards Tyre Management 1.4.0](https://github.com/daco1703/Tyre-Management/blob/main/downloads/Shepards-Tyre-Management-1.4-test.apk?raw=true).

Install as an update over the earlier APK. The package ID and test signing certificate are unchanged. Open the app and sign in directly to the live server with admin or assigned staff credentials. **Forgot username/password** displays **Contact the admin.** Under Team & settings, admin can add/remove staff. Existing offline preferences do not restore offline access. **Change server** can configure another HTTPS origin if needed.

This is a debug-signed test APK. Automated browser checks include Android-platform routing, bearer authentication and reopening; Android installation, file choosing, sharing and hardware-back navigation must also be checked on a phone. Native compilation/signature verification do not replace device testing.

## Development and validation

Node.js 24 or later:

```sh
npm ci
npm run dev
npm test
npm run build
# Supply an installed Chromium, or install it with npx playwright install chromium.
BROWSER_PATH=/usr/bin/chromium npm run test:ui
BROWSER_PATH=/usr/bin/chromium npm run test:login
```

The development server listens on port 3000 and seeds an admin only for a new database. Do not expose the development server publicly. Browser suites use temporary databases/test-only passwords on ports 3100/3120, not real fleet data. Screenshots go in ignored `artifacts/`.

Tests cover inventory/mileage invariants, scrap reasons, positions, Excel normalization/atomicity, accounts and permissions, session revocation, backups, conflicting writes and live updates. Browser checks cover the delayed-startup login regression, failed initial data load/retry, admin-created staff, cross-user live logbook updates, Android bearer login/reopen, English/Hindi layouts and internet-required behavior.

For Android, install JDK 21, Android platform 35 and Build Tools 35.0.0; set JAVA_HOME and ANDROID_HOME. The Gradle wrapper is checksum-pinned.

```sh
npm run android:build
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk`. Keep the same signing key for updates; do not commit keystores. Use a protected release keystore for production distribution. Android cleartext traffic and device/cloud backups are disabled. Fonts are bundled.

## Production server

The fleet's live address is **https://tyre-management.onrender.com/**. The server and Android build must both be updated to 1.4 for admin-created staff and live updates. Deploy the repository's `main` branch using the Render service's existing settings; if automatic deployments are disabled, use **Manual Deploy → Deploy latest commit**. The public `GET /api/health` response includes `ok` and the running version; it contains no fleet records. Existing users, inventory and logs stay in the persistent database.

Server patch **1.4.1** fixes browser login behind Render's HTTPS proxy. The server reads Render's built-in `RENDER_EXTERNAL_URL` as its allowed public website origin and detects the standard Render proxy automatically; no Android update is needed. For a custom domain or another host, set `PUBLIC_ORIGIN` to the exact HTTPS origin (for example `https://tyres.example.com`, without a path). An explicit `TRUST_PROXY=0/1` overrides automatic proxy detection. Foreign website origins remain rejected. After deploying, `/api/health` should report version `1.4.1`.

Use one instance with persistent storage and HTTPS. The supplied `render.yaml` prepares a Node 24 service and 1 GB persistent disk; new deployments require the owner's Render account and review of current charges. Build with `npm ci --include=dev && npm test && npm run build && npm prune --omit=dev`, start with `npm start`. On Render set `DATABASE_PATH=/var/data/tyresaathi.sqlite`, `NODE_ENV=production`, `TRUST_PROXY=1`, and retain the disk mounted at `/var/data`.

For a VPS, Docker Compose and Caddy configuration are included:

```sh
FLEET_DOMAIN=tyres.your-domain.in docker compose up -d --build
```

Configure DNS and ports 80/443. Keep the persistent `fleet_data` volume. Never run `docker compose down -v` against business records. Docker deployment still needs verification on the selected host; the Node production workflow and Android build are validated separately.

Environment variables: `PORT` (3000), `DATABASE_PATH` (`./data/tyresaathi.sqlite`), `NODE_ENV` (`production` for hosting), and `TRUST_PROXY` (`1` only behind one trusted proxy). Sessions use HttpOnly/SameSite=Strict/Secure cookies on the website and revocable seven-day bearer tokens in Android. Passwords use salted scrypt hashes. Change the initial admin password before sharing access.

## Backup and restore

The UI’s CSV/JSON exports are useful reports. JSON includes tyre/vehicle/movement records but **does not include accounts, and there is no JSON import UI**. Use the consistent SQLite backup command for complete recovery, including accounts:

```sh
# For local/Node hosting. The destination must be a new file.
npm run backup -- /secure/backup/location/fleet-2026-10-22.sqlite

# In the Docker deployment, create a consistent backup then copy it off the host.
docker compose exec app node server/backup.js /app/data/fleet-backup.sqlite
docker compose cp app:/app/data/fleet-backup.sqlite ./fleet-backup.sqlite
```

Keep dated backups outside the host and restrict access: they contain business data and password hashes. For restore, stop the app, preserve the current database and its `-wal`/`-shm` files as a rollback copy, then replace the database with the backup. Remove old WAL/SHM files from the restored database path **only while the app is stopped and after preserving them**. Preserve correct filesystem ownership and start the app again. Check sign-in and stock totals. A restored backup may restore sessions that were active at backup time; revoke them if the backup was exposed. Verify restore on a separate instance before relying on a backup strategy.

### Account recovery by a server administrator

Run locally on the server, after a full backup. Do not put the new password in command arguments or chat. Bash can collect it without echoing or storing it in shell history:

```sh
read -r -s -p 'New password (10+ characters): ' FLEET_ADMIN_PASSWORD
export FLEET_ADMIN_PASSWORD
node server/reset-password.js your_username
unset FLEET_ADMIN_PASSWORD
```

Set `DATABASE_PATH` if needed. This resets an existing active account and revokes all its sessions. The command never prints the password. Container operators can pass it through their host’s secure environment mechanism.

## Limits

One fleet per server. Large histories or many concurrent users may need a normalized database later. GPS tracking, tread inspections, purchase costs, automatic remote backups, Play Store publication and automatic migration of old phone-only records are not included. Keep dated off-server backups and verify restoration.
