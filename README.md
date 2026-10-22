# Shepards Tyre Management

A tyre logbook for commercial vehicles, in English and Hindi. Includes an Android app with a standalone offline mode, and a shared mode backed by one fleet server. Built from an empty repository for the requested tyre-management workflow. This is an original implementation; it does not reuse Regrip, TyreBook or Fleeca code, branding or private data. The supplied XAPK exceeded the workspace transfer limit and could not be inspected.

## What works

- Default admin login for offline and shared modes, private staff invite codes on the shared server, staff deactivation and password changes. The default fleet name is **Shepards Shipping Services**. Forgot username/password displays **Contact the admin.**
- Unique tyre IDs, brand/model, size, New / Used / Remold condition, garage stock and scrapped history.
- Excel vehicle import in offline and shared modes: download a blank `.xlsx` template, select a worksheet and review ready/skipped rows before confirming. Duplicate registrations and invalid rows are skipped in the preview. The selected valid rows are saved as one transaction with individual vehicle log entries.
- 18 road positions per vehicle: two front singles and four rear axles with dual wheels, plus an optional spare position. The **Tyre Location** diagram numbers positions 1–18 from right to left on each row: 1/2 on the front axle, 3–6 on the next, 7–10, 11–14 and 15–18. An extra gap appears only between rows 2 and 3. Dropdowns, history and CSV reports use the same numbers. `SP` remains the spare. Internal slot IDs stay stable so existing tyre locations and historical records are preserved.
- Remove a fitted tyre directly to stock, out for remolding, or scrap. Each removal saves the fitting/removal odometers, kilometres since fitting, lifetime tyre kilometres, destination and optional notes in one transaction. A New tyre becomes Used on removal, including a spare. Remolding tyres are counted separately and cannot be fitted until **Record remolding** returns them to stock as Remold. Completed remolding increments the cycle count without resetting mileage.
- Scrapping requires a reason: burst/blowout, worn tread, sidewall damage/bulge, deep cuts/exposed cords, bead damage, tread/belt separation, age cracks/rubber deterioration, irreparable puncture, failed remold/casing unfit, or Other with a required explanation. Reasons remain on the tyre, in movement history and in CSV/JSON reports.
- Accumulated tyre mileage from entered odometer readings. Spares do not accrue road mileage. Previous mileage can be entered when receiving an existing tyre.
- Daily closing tally in **Asia/Kolkata**, with stock split by condition. Days without movement carry the last closing balance forward. These are recorded-day totals; backdated events and GPS tracking are not implemented.
- Shared chronological log with staff attribution, search, date filtering, CSV export and JSON record export. Existing movements cannot be edited or deleted in the UI.
- Server revisions and SQLite transactions reject conflicting writes, rather than overwriting another staff member’s changes. Phones refresh every 10 seconds and on reconnect.
- **Standalone offline mode:** choose “Use offline on this phone” and sign in as admin without a server or internet connection. Vehicles, stock, fitments, mileage, daily tallies and movements are saved transactionally in IndexedDB on that phone. A record is reported saved only after the storage transaction succeeds. Stale writes from another window are rejected.
- **Shared server mode:** cached records can be viewed offline after successful sign-in, but shared changes require internet. Website offline reload requires an online visit and the service worker to finish caching. The APK bundles its screens and can start a new offline garage without any initial connection.
- Original adaptive Android icon, splash screen, hardware-back navigation and native file sharing for exports. Self-hosted English/Hindi fonts; no external analytics or font service.

## Run locally

Requires Node.js **24 or later**. No external database, account or API key is needed for local development.

```sh
npm ci
npm run dev
```

The server listens on port 3000. A new database seeds the requested **admin** owner account and **Shepards Shipping Services** fleet. Use the initial password provided by the fleet owner; it is stored as a verifier, never plaintext. There is no owner setup key or public owner signup. Existing accounts, changed passwords and fleet records are preserved on restart. Change the initial password under **Team & settings → Change password** before exposing the shared service. Create staff invitation codes from Team & settings. Do not expose the development server publicly.

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

Browser tests launch separate production servers on ports 3100/3110 with temporary databases. The offline suite normally seeds a test-only local verifier; supplying `SHEPARDS_TEST_PASSWORD` privately runs the same suite against the initial default verifier and also exercises legacy profile migration. No production password is committed in the tests. Build first. Sample records and screenshots belong to tests; they do not populate real inventory. Override `UI_TEST_PORT` if needed. Screenshots are written to ignored `artifacts/`.

## Use on Android

### Test immediately without a server

1. [Download the Shepards Tyre Management 1.3.0 test APK](https://github.com/daco1703/Tyre-Management/blob/main/downloads/Shepards-Tyre-Management-1.3-test.apk?raw=true) and install it. If you installed the earlier test APK, install this as an update using the same signing key; do not uninstall to update.
2. You can turn on **airplane mode before the first launch**. Open **Shepards Tyre Management** and choose **Use offline on this phone**. The fleet name defaults to **Shepards Shipping Services** and username to **admin**. Enter the initial password supplied by the owner and tap **Open offline garage**. No server address is required. Existing offline records are retained and get the new login on upgrade. Login is required after reopening/reloading the app or signing out.
3. Add a vehicle with its current odometer and optional spare position. Add a few tyres using unique IDs, brands, sizes and New / Used / Remold conditions.
4. Open Vehicles, select the vehicle and tap an empty wheel position to fit a stock tyre. Tap a fitted tyre → **Remove tyre**, enter the current odometer and choose **Return to stock**, **Send for remolding** or **Scrap tyre**. For scrap, select a reason; Other requires text. The dashboard and logbook update automatically.
5. Switch between English and Hindi using the language button. Close and reopen the app, still in airplane mode, then sign in to check your saved records. You can change the offline password in Team & settings; local and shared passwords are separate.
6. In Team & settings, use **Export records (JSON)** to save/share a copy of your local records. This version does not include a JSON restore/import screen.

Offline mode stores everything only on this device. **Uninstalling the app, clearing its storage, or browser storage eviction can remove local records.** Export copies regularly; Android device/cloud backup is disabled for this app. Offline mode has one local admin login and no shared synchronization. The login gates access in the app; local records are not encrypted. Offline password changes apply only to this phone. Forgot username/password displays Contact the admin; there is no automatic local password reset or email reset service. Switching to shared server mode keeps your local garage separate; it does not upload or merge offline records. Choose Use offline on this phone again to reopen the existing local garage.

### Import vehicles from Excel

Open **Vehicles → Import from Excel**. Download the template from the dialog, or [download it from this repository](https://github.com/daco1703/Tyre-Management/blob/main/downloads/TyreSaathi-vehicle-template.xlsx?raw=true). Fill one vehicle per row below the headings, save as `.xlsx`, and choose the file in the app. For files with multiple sheets, select the vehicle worksheet. Preview the rows and tap **Import N vehicles** to save only the ready rows.

| Template column | Required | Accepted values / default |
|---|---|---|
| Vehicle Registration | Yes | Text containing letters, numbers, spaces or hyphens; normalized to uppercase without spaces, up to 30 characters |
| Vehicle Name / Driver | No | Text, up to 100 characters |
| Odometer (km) | No | Whole non-negative kilometres up to 99,999,999; blank = 0. Proper comma grouping such as 120,000 or 1,20,000 is accepted |
| Has Spare | No | Yes/No, True/False, 1/0, or हाँ/नहीं; blank = No |

Common alternate headings such as Registration, Vehicle No and वाहन नंबर are also recognized. Files must be `.xlsx` and at most 2 MB, with at most 200 nonempty vehicle rows per selected worksheet. Save old `.xls` files as `.xlsx` before importing. The template contains headings only, so it cannot accidentally add sample vehicles.

Existing vehicles are not overwritten; import duplicate checks ignore registration case, spaces and hyphens. Duplicate registrations and invalid rows are marked as skipped. Cancel or correct the workbook to include skipped rows. All imports create empty 18-position road layouts with the requested optional spare; they do not create or fit tyres. In shared mode, a concurrent staff change causes the entire save to be rejected and the preview refreshed. A successful import saves all its ready rows together; it does not leave a partial import. Each vehicle receives a dated log entry with staff attribution (or admin in offline mode). Excel import adds vehicles only; JSON record restore and offline-to-server migration are separate features.

### Share records between staff phones

The same **hosted HTTPS server address** must be reachable from every staff phone. An APK alone cannot share a database between phones. Hosting is not provisioned by this repository. In an offline garage, open Team & settings → Use a shared server to switch modes.

1. Deploy the server as described below, sign in to the seeded admin account and change its initial password.
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
2. Review the `shepards-tyre-management` service, Starter plan and persistent disk, then deploy. Render runs the tests and frontend build before starting the server. The app's HTTPS URL appears on the service page after deployment succeeds; it is not known before that step.
3. Open the service URL and sign in as **admin** using the initial password supplied by the owner. Change it under **Team & settings → Change password**. There is no owner setup key. Existing deployed accounts retain their credentials.
4. Enter the same service URL in the Android app. Share a staff invitation code from Team & settings with your employees.

The database stays at `/var/data/tyresaathi.sqlite` on the disk across normal deployments. Keep the persistent disk when editing settings. A deleted service/disk can lose data: arrange regular off-server backups using the backup instructions below. Deploy one instance only. This blueprint is a deployment configuration; a live public server still requires your Render account, GitHub connection and deployment approval.

### VPS with Docker and automatic HTTPS

Requirements: a Linux server with Docker Compose, a domain/subdomain pointing to it, and inbound TCP ports 80/443. A small server with 1 GB RAM is a reasonable starting point for a small fleet. Provider/domain costs are separate.

```sh
# From this project directory on your server; substitute your own DNS name.
FLEET_DOMAIN=tyres.your-domain.in docker compose up -d --build
```

Caddy obtains and renews HTTPS certificates. Only Caddy is exposed; the app port remains private. `TRUST_PROXY=1` is appropriate for this single trusted reverse proxy. Configure a persistent `FLEET_DOMAIN` environment variable or a local ignored `.env` file for future Compose commands.

A new database seeds the requested admin account. Sign in with the owner-supplied initial password and change it in Team & settings. Public registration is only for staff with the current invite code. Rotate the invitation code in Team & settings when needed. Keep the owner password secure; Forgot username/password directs users to contact the admin. Existing accounts and passwords are never reset during deployment.

The `fleet_data` volume retains records across container rebuilds. **Never run `docker compose down -v` on a real fleet** unless intentionally deleting all its data and with a verified backup.

### Other container or Node hosts

Build the supplied Dockerfile or run `npm ci && npm run build`, then `npm start` with a persistent data directory. Add HTTPS using the host’s trusted proxy. The Dockerfile runs as the non-root `node` user; the mounted directory must be writable by that user. A Node-only deployment needs all dependencies during build, then can omit dev dependencies at runtime.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port behind the HTTPS proxy |
| `DATABASE_PATH` | `./data/tyresaathi.sqlite` | Persistent SQLite file |
| `NODE_ENV` | development | Use `production` for hosted use, static assets and Secure cookies |
| `TRUST_PROXY` | unset | Set `1` only behind one trusted reverse proxy; do not expose the app port directly |

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

`npm test` covers inventory invariants, all wheel positions, spare mileage, remold/scrap lifecycle, Indian date boundaries, daily closing balances, authentication, session revocation, staff permissions, persistence, and concurrent updates. `npm run test:ui` exercises owner login and invited staff signup, bilingual mobile/desktop screens, tyre fit/return, odometer changes, export, shared-mode offline write blocking and layout overflow. `npm run test:offline` exercises offline admin login with an unavailable API, all three tyre conditions, fitting/returning tyres, spare mileage, odometer updates, local persistence across offline reload and closing all pages, Hindi, JSON export and concurrent-window conflict protection. Production and native builds must be rerun after code changes.

Native compilation and signature verification are separate from physical-device testing. Test an installed build on your actual phone before entering business records. Automated browser tests do not exercise Android’s file chooser or hardware-back behavior. Deployment, domain setup, Play Store publication, automated remote backups, GPS tracking, tyre inspections/tread depth, purchase costs, and reconciliation between local offline records and the shared server are not included in this version.

Validation in the cloud workspace includes domain/API/recovery tests and production browser workflows. Excel checks cover workbook/template parsing, multiple worksheets, Hindi values, defaults, duplicates, invalid rows, preview cancellation, offline persistence, atomic saving and the 200-row limit. The APK compiles and its signature is verified. Compose configuration syntax passed. The optional Docker image build stalled during dependency installation here, including after proxy/trust configuration checks; it was stopped. The same frozen dependency installation completed in a standalone Node container. The full Docker image and HTTPS deployment still need validation on the selected host; the direct Node production workflow was validated separately.

The server stores the fleet’s state and event snapshots transactionally in SQLite. It is suited to a small fleet on one server; large histories and many concurrent users may need a normalized database and more granular synchronization in a future version.
