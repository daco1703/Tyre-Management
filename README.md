# Shepards Tyre Management

English/Hindi tyre logbook for Shepards Shipping Services. The app uses one shared server and requires internet. Android defaults to **https://www.shepards-tyre-management.com/**. This is an original implementation, inspired by the requested tyre-management workflows.

## Accounts and live records

- A new database seeds the requested **admin** owner account and fleet name **Shepards Shipping Services**. Use the initial password supplied by the owner. Existing server accounts and changed passwords are preserved on deployment/restart when the database is on persistent storage. There is no setup key.
- Only the admin can create staff accounts under **Team & settings → Add staff**, entering a unique username, password and confirmation. Usernames are case-insensitive and remain reserved after removal. Staff sign in directly with their assigned credentials. Public signup and invitation-code signup are disabled.
- Only the admin can add vehicles manually or import vehicles from Excel; the server rejects staff requests for both actions. Staff can view vehicles and record tyre work.
- Only the admin can **Remove staff**. This revokes all that staff member's sessions, including waiting live connections. Historical entries are retained. Staff can change their own passwords and record inventory movements, but cannot create/remove accounts.
- Every vehicle/tyre entry, fitment, removal, remold, scrap, odometer update and imported vehicle is recorded with the authenticated username and server timestamp. Clients cannot choose a different author. The logbook and CSV/JSON reports retain this attribution.
- All accounts on the server see the same data. Authenticated live-update requests wait for committed changes and deliver them to connected phones immediately. Waiting requests refresh at least every 10 seconds. Revisions and SQLite transactions reject conflicting writes rather than overwrite another user's work.
- There is no offline-login or offline-entry option. Losing connectivity displays **You are offline. Please connect to the internet.** (with a Hindi translation) and blocks entries. Reconnecting refreshes shared records. The app shell can cache only so this warning can be shown when offline; API data is not service-worker cached.
- Upgrading from the older offline APK ignores its local-mode preference. Existing IndexedDB records are not erased or automatically uploaded; they are separate from the live server. Export any needed local records using the old version before upgrading. Do not uninstall/clear storage to update.

## Tyres and vehicles

- Unique tyre IDs, manufacturer dropdown with Other, Radial / Horse construction, New / Used / Remold condition and scrap history. Size is hidden; historical sizes remain preserved. The dropdown contains MRF, Apollo, CEAT, JK Tyre, Bridgestone, Michelin and Goodyear, plus Custom / other. The seven original high-resolution images provided by the owner are bundled unchanged under `public/brands`, preserving their original formats and proportions. CSS sizes each image for its context; there are no external favicon requests. Custom and historical manufacturer names remain intact, with initials when no logo is available. `public/brands/sources.json` records source-file checksums.
- **Tyre Location** numbers 18 road positions from right to left on each row: 1–2, 3–6, 7–10, 11–14 and 15–18. Rows 1–2 are grouped as **Horse** (positions 1–6); rows 3–5 are grouped as **Trolley** (positions 7–18), with a larger labelled separation between the two sections. Optional spare remains SP. Stable internal slot IDs preserve older assignments and history.
- A fitted tyre can be removed directly to stock, out for remolding or scrap. Each removal saves fitting/removal odometers, kilometres since fitting, lifetime kilometres and destination. A New tyre becomes Used on removal. Spare tyres accrue no road kilometres.
- Tyres out for remolding are counted separately and cannot be fitted until **Record remolding** returns them to stock. Mileage is preserved; completed remolding increments its cycle count. Sending and completing remolding record the vendor: Sharvayu, Guardex MRF, or Other with a custom name. Every cycle retains its vendor history.
- Scrap requires a dropdown reason: burst, worn tread, sidewall damage, cuts, bead damage, tread separation, age cracks, irreparable puncture, failed remold, or Other with required text. Reasons remain on the tyre, in history and in exports.
- Daily closing totals use India time and carry balances forward on days without movement. Active total = fitted + garage stock + out for remolding. Scrapped tyres stay in history.
- **Vehicles → Import from Excel** downloads a blank `.xlsx` template and previews ready/skipped rows before saving. Registration is required; route/name, separate driver name and BS3/BS4/BS6 vehicle class are optional in Excel, blank odometer is 0 and blank spare is No. Maximum 200 vehicle rows / 2 MB. Duplicate registrations (case, spaces and hyphens ignored) and invalid rows are skipped. Multiple worksheets, common English/Hindi headings and Hindi Yes/No values are supported. Existing vehicles are not overwritten. Imported vehicles have empty 18-position layouts; tyres are not created. The ready batch is atomic, with one attributed log entry per vehicle.
- **Tyre inventory → Import tyres from Excel** downloads a blank template, validates and previews up to 200 rows / 2 MB, and imports Ready rows into garage stock. Required columns: Tyre ID (text to preserve leading zeros) and Manufacturer. Optional columns: Condition (New/Used/Remold, default New), Tyre Type (Radial/Horse, default Radial), Previous km (default 0). Custom manufacturer names are supported. Duplicates, including IDs belonging to sold/scrapped tyres, are skipped; existing tyres are never overwritten. Each imported tyre has its own username-attributed receipt event.
- **Record tyre sale** is available on stock and scrapped tyres. Fitted tyres must first be removed with their mileage; tyres away for remolding must first return. The inventory opens on **Active tyres**, excluding sold/scrapped records. Sold tyres leave active inventory and remain in **Sold** with brand, construction, condition, mileage, NSD, remold/scrap history, sale timestamp, staff username and optional buyer/reference notes. Sales cannot be entered twice and IDs remain reserved. Active total = stock + fitted + out for remolding.
- **Admin only → Vehicle → Vehicle Sold** reviews the currently fitted tyres, asks for the final odometer, optional buyer/reference notes and a confirmation. The vehicle moves out of active lists/counts and into **Sold vehicles**. Its fitted road tyres and spare move to tyre **Sold** together, with final cycle/lifetime kilometres and per-tyre sale entries linked to the vehicle sale. Garage stock is unaffected. History remains in read-only vehicle detail and reports. Sold registrations and tyre IDs stay reserved, and the server rejects new fitments/inspections/odometer/driver changes for sold vehicles. Changing the fitted tyres while a sale form is open requires reopening/reviewing it; backward odometers and stale revisions fail without partial changes.
- CSV log reports and JSON inventory exports are available; there is no JSON restore/import screen. Movements cannot be edited/deleted in the UI.

## Inspections, reminders and reports (1.8)

- The company logo and wordmark are permanently bundled in the website, login, main navigation, Android launcher and splash assets. Cleaned artwork was prepared from the supplied reference images. No account upload or branding setup is required. Earlier uploaded branding remains in the database for compatibility but is no longer used by this client. Smaller text is larger and condition/status colours use brighter green, amber, purple and blue alongside the red company theme.
- New vehicles require BS3, BS4 or BS6, and allow a separate current driver name. Older vehicle records with no class remain unclassified rather than receiving an invented class.
- **Vehicle → Record tyre inspection** records the performed date, all-tyres-checked status, positional issues (including misalignment and Other), notes and optional tread readings. The vehicle shows its latest inspection and issue summary. Tyre history also includes inspections involving that tyre.
- NSD uses **one average tread remaining percentage, 0–100%**. New and freshly remolded tyres receive an automatic 100% baseline. Manual updates are available only for fitted tyres, in their detail screen or vehicle inspection. Used stock without a reading remains unknown until fitted and measured. Existing three-point readings are displayed as their arithmetic average without rewriting their history. Remolding resets current NSD to 100% and retains earlier measurements and kilometres. The next advisory check is two calendar months after first fitting a fresh tyre or after its latest reading, clamped at month end. Backdated readings do not postpone a newer reminder or replace a fresh remold baseline. Reminders appear while using the connected app and do not block work; there are no background phone notifications.
- **Change driver** records old/new names and shows an advisory to check all tyres. Staff can continue other work. A current inspection marked **All tyres checked** completes the reminder and records who checked it; older inspections cannot clear a newer driver change.
- **Vehicle report** and **Reports** count fitments, inspections, issues, NSD readings, removals, driver changes/checks vehicle sales and recorded tyre kilometres from removals/vehicle sales. Filter by vehicle, BS class, staff and dates: This month, Last month, Last year (previous calendar year), or Custom. Summary and detailed CSV exports are available. Inspection/NSD report dates use the performed date, while the logbook retains the recorded timestamp. Tyre kilometres sum completed removal/vehicle-sale cycles in the selected period, not distance driven during that period.
- Display dates and CSV report dates use **dd/mm/yyyy**, with timestamps in India time. Internal JSON dates retain ISO format for compatibility. Existing records/accounts remain intact.

## Layout review (1.8)

Tyre details have a dedicated identity section and a separate status/condition/construction row. Known brand names stay together; long custom names can wrap. Inventory entries and movement histories use separate cards, with stable label/value spacing. Settings, staff controls, inspection rows and reports handle long text in either language. Logo and wordmark panels share one explicit height at each breakpoint.

The tyre map preserves the Horse/Trolley positions and shows full tyre IDs on one line in a readable monospace font. Four full identifiers cannot fit across a narrow phone screen without making the text too small, so only the diagram scrolls horizontally; swipe it to see both sides. The rest of the page remains within the screen. Tile width adapts to the longest fitted identifier. No IDs are shortened with ellipses.

`test:layout` uses an isolated database and covers all seven brands × three conditions × two constructions × five statuses in English and Hindi, plus the exact reported regression and long custom values. It reviews 562 screen/form states across 320, 360, 390, 430, 700, 701, 960, 1200 and 1440 pixels, including branding alignment, full map IDs, metric text, long staff names, inspection and sale dialogs, card/control overlaps and page overflow. Viewport screenshots and a coverage summary are saved in ignored `artifacts/layout-review/`. These are automated Chromium checks; actual Android font/display settings and touch scrolling still need phone verification.

Version **1.8.1** removes the redundant Fleet Workspace/company/live-records block from the sidebar. The sidebar scrolls independently when a short window or browser zoom leaves too little height, keeping all six menu items and the profile/settings button accessible by mouse and keyboard. Sidebar branding adapts to its available width. `test:sidebar` covers admin/staff accounts, English/Hindi, desktop widths 701–1440 and heights 320–768, plus the mobile navigation.

## Android update

[Download Shepards Tyre Management 1.8.2](https://github.com/daco1703/Tyre-Management/blob/main/downloads/Shepards-Tyre-Management-1.8.2-test.apk?raw=true).

Version **1.8.2** uses **https://www.shepards-tyre-management.com/** for new installations and migrates phones using the old default or a saved `https://tyre-management.onrender.com` address. The phone saves the new address and clears its old bearer token before its first network request, so sign in again after updating. Separately chosen custom HTTPS servers remain selected. This changes the connection address; it does not copy records between different servers or provision DNS/HTTPS. Browser requests continue to use the website's own origin.

Install as an update over the earlier APK. The package ID and test signing certificate are unchanged. Open the app and sign in directly to the live server with admin or assigned staff credentials. **Forgot username/password** displays **Contact the admin.** Under Team & settings, admin can add/remove staff. Existing offline preferences do not restore offline access. **Change server** can configure another HTTPS origin if needed.

This is a debug-signed test APK. Automated browser checks include Android-platform routing, bearer authentication and reopening; Android installation, file choosing, sharing and hardware-back navigation must also be checked on a phone. Native compilation/signature verification do not replace device testing.

## Development and validation

Node.js 24 (the supported major version is pinned in `package.json`):

```sh
npm ci
npm run dev
npm test
npm run build
# Supply an installed Chromium, or install it with npx playwright install chromium.
BROWSER_PATH=/usr/bin/chromium npm run test:ui
BROWSER_PATH=/usr/bin/chromium npm run test:login
BROWSER_PATH=/usr/bin/chromium npm run test:layout
BROWSER_PATH=/usr/bin/chromium npm run test:sidebar
```

The development server listens on port 3000 and seeds an admin only for a new database. Do not expose the development server publicly. Browser suites use temporary databases/test-only passwords on ports 3100/3120/3135/3140, not real fleet data. Screenshots go in ignored `artifacts/`.

Tests cover vehicle-sale permissions/atomicity/final mileage/spares, active fleet exclusion, source-logo checksums, average NSD/defaults/legacy readings, stock-only sales, tyre import validation/atomicity, admin-only vehicle creation/import, inventory/mileage invariants, scrap reasons, positions, Excel normalization/atomicity, accounts and permissions, session revocation, backups, conflicting writes and live updates. Browser checks cover the delayed-startup login regression, failed initial data load/retry, admin-created staff, cross-user live logbook updates, Android bearer login/reopen, English/Hindi layouts and internet-required behavior.

For Android, install JDK 21, Android platform 35 and Build Tools 35.0.0; set JAVA_HOME and ANDROID_HOME. The Gradle wrapper is checksum-pinned.

```sh
npm run android:build
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk`. Keep the same signing key for updates; do not commit keystores. Use a protected release keystore for production distribution. Android cleartext traffic and device/cloud backups are disabled. Fonts are bundled.

## Production server

The fleet's shared address is **https://www.shepards-tyre-management.com/**. The current browser/server and Android versions are **1.8.2**. The website can be hosted on Vercel with the API on Render, or the entire app can be hosted on Render. Both use the existing Express/SQLite backend. Deploy the repository's `main` branch using the Render service's existing settings; if automatic deployments are disabled, use **Manual Deploy → Deploy latest commit**. The public `GET /api/health` response includes `ok` and the running version; it contains no fleet records. Existing users, inventory and logs stay in the database when it is on persistent storage.

### Vercel website with the existing Render backend

`vercel.json` configures Vite, `npm run build`, and output directory `dist`. Requests under `/api/` are rewritten to `https://tyre-management.onrender.com/api/`, so the website can reach login, fleet records and live updates. The direct Render address is deliberate: rewriting to the company domain would loop when that domain points to Vercel. Build logs ending in **Deployment completed** indicate a successful build; publishing only `dist` without the API rewrite leaves the website unable to connect.

1. Import this repository into Vercel, use the repository root, and deploy the latest `main` commit. Keep the Vite preset, build command `npm run build`, output directory `dist`, and Node 24. The npm `cache-dir`/install-script messages in the reported successful build were warnings, not build failures.
2. Add `www.shepards-tyre-management.com` under the Vercel project's **Settings → Domains** and apply Vercel's DNS instructions at the domain provider. For this arrangement, that hostname points to Vercel; Render remains reachable at its direct `.onrender.com` address. The Render Blueprint's custom-domain entry is only for direct Render website hosting and is unnecessary for this arrangement.
3. Keep the Render backend running and set its `PUBLIC_ORIGIN=https://www.shepards-tyre-management.com`, `NODE_ENV=production`, and `TRUST_PROXY=1`. Use the company domain to sign in. Unrelated Vercel preview URLs remain rejected by the backend's exact-origin checks. If testing another deployment hostname, the backend's configured public origin must explicitly match it.
4. Verify `https://www.shepards-tyre-management.com/api/health` returns JSON with `ok: true`, then check browser and Android sign-in. Production access must be public for staff phones to use the API. Website files and API responses should not redirect to a Vercel account-login page.

This configuration hosts the **website on Vercel and the database/API on Render**. Vercel does not run `npm start` as a persistent database server for this Vite deployment. Do not move SQLite to a Vercel Function's `/tmp` directory: that would still be temporary, isolated storage. Moving the whole backend to Vercel requires a durable external database and a storage-layer migration. Keeping a Render Free backend retains the data-loss limitation described below; the API rewrite does not add persistence or automatic backups. Local build and proxy-origin tests do not verify the live Vercel project, DNS, deployment protection, or Render availability.

### Direct Render hosting

Version **1.8.2** retains the earlier fix for browser login behind Render's HTTPS proxy. Set `PUBLIC_ORIGIN=https://www.shepards-tyre-management.com` (without a trailing slash) in the existing Render service. The Blueprint includes that value and the `www.shepards-tyre-management.com` custom domain. Connect/verify the domain under Render **Settings → Custom Domains** and apply Render's DNS instructions at the domain provider; the domain must serve HTTPS before phones can connect. Repository changes do not update DNS or verify a manually configured service.

Without an explicit `PUBLIC_ORIGIN`, Render's built-in `RENDER_EXTERNAL_URL` remains allowed and the exact HTTPS company domain is additionally allowed, including when Render forwards an internal HTTP Host. An explicit `PUBLIC_ORIGIN` overrides these automatic choices. Unrelated websites, lookalike domains and forged forwarding headers remain rejected. An explicit `TRUST_PROXY=0/1` overrides automatic proxy detection. After deploying, `/api/health` should report version `1.8.2`. `test:login` covers both public browser origins and native fresh-install/upgrade sign-in and token isolation using local fixtures; it does not verify live DNS or TLS.

Use one instance with persistent storage and HTTPS. The supplied `render.yaml` prepares a Node 24 service and 1 GB persistent disk; new deployments require the owner's Render account and review of current charges. Build with `npm ci --include=dev && npm test && npm run build && npm prune --omit=dev`, start with `npm start`. On Render set `DATABASE_PATH=/var/data/tyresaathi.sqlite`, `NODE_ENV=production`, `TRUST_PROXY=1`, and retain the disk mounted at `/var/data`.

Render Free does not provide persistent disks. With the current SQLite backend, an ephemeral database can disappear on restart or redeployment. A committed `render.yaml` does not prove that an existing service has applied its disk configuration. Preserve the live database before changing deployments or paths; CSV/JSON exports retain records but omit staff accounts and have no restore screen. Use a supported persistent disk or migrate to a durable external database before relying on this server for business records. Automatic off-server backups are not configured.

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

One fleet per server. Large histories or many concurrent users may need a normalized database later. GPS tracking, purchase costs, automatic remote backups, Play Store publication and automatic migration of old phone-only records are not included. Keep dated off-server backups and verify restoration.
