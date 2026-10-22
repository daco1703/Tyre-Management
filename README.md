# TyreSaathi

A tyre logbook for commercial vehicles, in English and Hindi. Includes an Android app with a standalone offline mode, and a shared mode backed by one fleet server. Built from an empty repository for the requested tyre-management workflow. This is an original implementation; it does not reuse Regrip, TyreBook or Fleeca code, branding or private data. The supplied XAPK exceeded the workspace transfer limit and could not be inspected.

## What works

- Owner and staff accounts, private invite codes, staff deactivation and password changes.
- Unique tyre IDs, brand/model, size, New / Used / Remold condition, garage stock and scrapped history.
- 18 road positions per vehicle: two front singles and four rear axles with dual wheels, plus an optional spare position. Left/right are viewed facing forward from the driver’s seat; `LO/LI/RI/RO` mean left outer/inner and right inner/outer. `SP` is the spare.
- Fit and return tyres with odometer readings and optional notes. Moving a tyre between vehicles or positions uses return → fit so both movements are recorded. Return a tyre before scrapping or recording a completed remold. A New tyre becomes Used on return, including a spare; remold tyres retain their condition.
- Accumulated tyre mileage from entered odometer readings. Spares do not accrue road mileage. Previous mileage can be entered when receiving an existing tyre.
- Daily closing tally in **Asia/Kolkata**, with stock split by condition. Days without movement carry the last closing balance forward. These are recorded-day totals; backdated events and GPS tracking are not implemented.
- Shared chronological log with staff attribution, search, date filtering, CSV export and JSON record export. Existing movements cannot be edited or deleted in the UI.
- Server revisions and SQLite transactions reject conflicting writes, rather than overwriting another staff member’s changes. Phones refresh every 10 seconds and on reconnect.
- **Standalone offline mode:** choose “Use offline on this phone” without an account, server or internet connection. Vehicles, stock, fitments, mileage, daily tallies and movements are saved transactionally in IndexedDB on that phone. A record is reported saved only after the storage transaction succeeds. Stale writes from another window are rejected.
- **Shared server mode:** cached records can be viewed offline after successful sign-in, but shared changes require internet. Website offline reload requires an online visit and the service worker to finish caching. The APK bundles its screens and can start a new offline garage without any initial connection.
- Original adaptive Android icon, splash screen, hardware-back navigation and native file sharing for exports. Self-hosted English/Hindi fonts; no external analytics or font service.

## Run locally

Requires Node.js **24 or later**. No external database, account or API key is needed for local development.

```sh
npm ci
npm run dev
```

The server listens on port 3000. In development, the first account creates the owner and fleet. It returns a private staff invitation code. **Do not expose the development server publicly.** Production protects initial owner registration with a setup key.

```sh
npm test
npm run build
# First install Playwright Chromium, or supply an existing Chromium executable.
npx playwright install chromium
npm run test:ui
# On this cloud machine:
BROWSER_PATH=/usr/bin/chromium npm run test:ui
BROWSER_PATH=/usr/bin/chromium npm run test:offline
```

Browser tests launch a separate production server on port 3100 with a temporary database. Build first. Sample records and screenshots belong to tests; they do not populate real inventory. Override `UI_TEST_PORT` if needed. Screenshots are written to ignored `artifacts/`.

## Use on Android

### Test immediately without a server

1. [Download the TyreSaathi 1.1.0 offline test APK](https://github.com/daco1703/Tyre-Management/blob/main/downloads/TyreSaathi-1.1-offline-test.apk?raw=true) and install it. If you installed the earlier test APK, install this as an update using the same signing key; do not uninstall to update.
2. You can turn on **airplane mode before the first launch**. Open TyreSaathi and choose **Use offline on this phone**. Enter your garage name and tap **Open offline garage**. No username, password or server address is required.
3. Add a vehicle with its current odometer and optional spare position. Add a few tyres using unique IDs, brands, sizes and New / Used / Remold conditions.
4. Open Vehicles, select the vehicle and tap an empty wheel position to fit a stock tyre. Update the odometer or return the tyre to the garage to test mileage and stock movements. The dashboard and logbook update automatically.
5. Switch between English and Hindi using the language button. Close and reopen the app, still in airplane mode, to check your saved records.
6. In Team & settings, use **Export records (JSON)** to save/share a copy of your local records. This version does not include a JSON restore/import screen.

Offline mode stores everything only on this device. **Uninstalling the app, clearing its storage, or browser storage eviction can remove local records.** Export copies regularly; Android device/cloud backup is disabled for this app. Offline mode has no staff accounts or shared synchronization. Switching to shared server mode keeps your local garage separate; it does not upload or merge offline records. Choose Use offline on this phone again to reopen the existing local garage.

### Share records between staff phones

The same **hosted HTTPS server address** must be reachable from every staff phone. An APK alone cannot share a database between phones. Hosting is not provisioned by this repository. In an offline garage, open Team & settings → Use a shared server to switch modes.

1. Deploy the server as described below and create the owner account using the protected setup key.
2. Install the built APK on Android 6.0+ with a current Android System WebView. This is a **debug-signed test APK**, not a Play Store release. Android may require permission to install from your file manager/browser.
3. On first launch, enter your fleet server’s HTTPS origin, for example `https://tyres.your-domain.in`. Sign in, or choose Join fleet using the owner’s private invitation code.
4. Start by adding vehicles and receiving each physical tyre into stock. Open a vehicle and tap an empty position to fit a tyre. Record current odometer readings to maintain running distances.

Alternatively, open the hosted site in Chrome on Android and choose **Add to home screen → Install app**. This works without sideloading an APK.

### Build the APK

Requires a full JDK **21**, Android SDK platform **35**, Build Tools **35.0.0** and accepted SDK licenses. Set `JAVA_HOME` and `ANDROID_HOME` for your machine. The Gradle wrapper is pinned to 8.11.1 and its published SHA-256 checksum.

```sh
npm ci
npm run android:build
```

The output is `android/app/build/outputs/apk/debug/app-debug.apk`. Use Android Studio’s signed bundle/APK flow with your own protected release keystore for production distribution. Keep that signing key for all future updates; do not commit it. Native HTTPS server connections verify certificates and reject cleartext traffic. Android app backups are disabled to avoid backing up its session token.

## Host the shared server

Use **one instance with persistent storage**. This version supports one fleet per server. Do not run multiple replicas with independent SQLite files, put the database on an ephemeral filesystem, or deploy it as a static-only website. Free hosts that erase files or lack persistent disks are unsuitable.

### Render: hosted server without managing a VPS

The included `render.yaml` provisions a Node 24 web service with managed HTTPS and a 1 GB persistent disk. It uses Render's **paid Starter plan** because persistent storage is required. Review Render's current service and disk charges before confirming deployment. No account, service or charge is created just by committing this file.

1. Sign in to Render and choose **New → Blueprint**, then connect `daco1703/Tyre-Management` from GitHub. You can also open [Deploy on Render](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2Fdaco1703%2FTyre-Management).
2. Review the `tyresaathi` service, Starter plan and persistent disk, then deploy. Render runs the tests and frontend build before starting the server. The app's HTTPS URL appears on the service page after deployment succeeds; it is not known before that step.
3. In the service's **Environment** settings, privately view the generated `FLEET_SETUP_KEY`. Open the service URL, create your owner account and enter that key in **Owner setup key**. Do not send the key in chat.
4. Enter the same service URL in the Android app. Share a staff invitation code from Team & settings with your employees.

The database stays at `/var/data/tyresaathi.sqlite` on the disk across normal deployments. Keep the generated setup key and disk when editing settings. A deleted service/disk can lose data: arrange regular off-server backups using the backup instructions below. Deploy one instance only. This blueprint is a deployment configuration; a live public server still requires your Render account, GitHub connection and deployment approval.

### VPS with Docker and automatic HTTPS

Requirements: a Linux server with Docker Compose, a domain/subdomain pointing to it, and inbound TCP ports 80/443. A small server with 1 GB RAM is a reasonable starting point for a small fleet. Provider/domain costs are separate.

```sh
# From this project directory on your server; substitute your own DNS name.
FLEET_DOMAIN=tyres.your-domain.in docker compose up -d --build
```

Caddy obtains and renews HTTPS certificates. Only Caddy is exposed; the app port remains private. `TRUST_PROXY=1` is appropriate for this single trusted reverse proxy. Configure a persistent `FLEET_DOMAIN` environment variable or a local ignored `.env` file for future Compose commands.

Production creates a random owner setup key in `/app/data/setup-key`, with restricted file permissions. Read it privately from the app container through your hosting terminal:

```sh
docker compose exec app cat /app/data/setup-key
```

Enter it into the **Owner setup key** field on the first signup. Never share it in chat or put it in source control. The server disables owner creation once the owner exists; staff must have the current invite code. Rotate the invitation code in Team & settings when needed. Keep the owner password secure; there is no email reset service.

The `fleet_data` volume retains records across container rebuilds. **Never run `docker compose down -v` on a real fleet** unless intentionally deleting all its data and with a verified backup.

### Other container or Node hosts

Build the supplied Dockerfile or run `npm ci && npm run build`, then `npm start` with a persistent data directory. Add HTTPS using the host’s trusted proxy. The Dockerfile runs as the non-root `node` user; the mounted directory must be writable by that user. A Node-only deployment needs all dependencies during build, then can omit dev dependencies at runtime.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port behind the HTTPS proxy |
| `DATABASE_PATH` | `./data/tyresaathi.sqlite` | Persistent SQLite file |
| `NODE_ENV` | development | Use `production` for hosted use, static assets and Secure cookies |
| `TRUST_PROXY` | unset | Set `1` only behind one trusted reverse proxy; do not expose the app port directly |
| `FLEET_SETUP_KEY` | generated protected file in production | Optional securely injected bootstrap key; do not commit it |

Readiness endpoint: `GET /api/health` returns `{"ok":true}`. It is intentionally public. Login, stock, vehicles and team data require authentication. Web sessions use HttpOnly, SameSite=Strict cookies; the native app uses a revocable seven-day bearer session. Passwords use salted scrypt hashes. Production hosting must use HTTPS. Put regular off-server backups and host updates in place before recording business inventory.

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

## Validation and limits

`npm test` covers inventory invariants, all wheel positions, spare mileage, remold/scrap lifecycle, Indian date boundaries, daily closing balances, authentication, session revocation, staff permissions, persistence, and concurrent updates. `npm run test:ui` exercises owner/staff signup, bilingual mobile/desktop screens, tyre fit/return, odometer changes, export, shared-mode offline write blocking and layout overflow. `npm run test:offline` exercises account-free setup with an unavailable API, all three tyre conditions, fitting/returning tyres, spare mileage, odometer updates, local persistence across offline reload and closing all pages, Hindi, JSON export and concurrent-window conflict protection. Production and native builds must be rerun after code changes.

Native compilation and signature verification are separate from physical-device testing. Test an installed build on your actual phone before entering business records. Automated browser tests do not exercise Android’s file chooser or hardware-back behavior. Deployment, domain setup, Play Store publication, automated remote backups, GPS tracking, tyre inspections/tread depth, purchase costs, and reconciliation between local offline records and the shared server are not included in this version.

Validation in the cloud workspace: all 24 domain/API/recovery tests and the production browser smoke workflow passed. The APK compiled and its signature verified. Compose configuration syntax passed. The optional Docker image build stalled during dependency installation here, including after proxy/trust configuration checks; it was stopped. The same frozen dependency installation completed in a standalone Node container. The full Docker image and HTTPS deployment still need validation on the selected host; the direct Node production workflow was validated separately.

The server stores the fleet’s state and event snapshots transactionally in SQLite. It is suited to a small fleet on one server; large histories and many concurrent users may need a normalized database and more granular synchronization in a future version.
