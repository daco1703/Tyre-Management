# Shepards Tyre Management

English/Hindi tyre logbook for Shepards Shipping Services. The app uses one shared server and requires internet. Android defaults to **https://www.shepards-tyre-management.com/**. This is an original implementation, inspired by the requested tyre-management workflows.

## Accounts and live records

- A new database seeds the requested **admin** owner account and fleet name **Shepards Shipping Services**. Use the initial password supplied by the owner. Existing server accounts and changed passwords are preserved on deployment/restart when the database is on persistent storage. There is no setup key.
- Only the admin can create staff accounts under **Team & settings → Add staff**, entering a unique username, password and confirmation. Usernames are case-insensitive and remain reserved after removal. Staff sign in directly with their assigned credentials. Public signup and invitation-code signup are disabled.
- Only the admin can add vehicles manually or import vehicles from Excel; the server rejects staff requests for both actions. Staff can view vehicles and record tyre work.
- Only the admin can **Remove staff**. This revokes all that staff member's sessions, including waiting live connections. Historical entries are retained. Staff can change their own passwords and record inventory movements, but cannot create/remove accounts.
- Every vehicle/tyre entry, fitment, removal, remold, scrap, odometer update and imported vehicle is recorded with the authenticated username and server timestamp. Clients cannot choose a different author. The logbook and CSV/JSON reports retain this attribution.
- All accounts using the same database see the same data. PostgreSQL/Vercel clients poll committed records every five seconds while the app is visible, and refresh when reopened. Older APKs remain compatible through bounded waiting requests. SQLite installations retain immediate in-process notifications. Database transactions recheck the current session and revision so conflicting staff writes cannot overwrite records.
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

[Download Shepards Tyre Management 1.9.0](https://github.com/daco1703/Tyre-Management/blob/main/downloads/Shepards-Tyre-Management-1.9-test.apk?raw=true).

Version **1.9.0** uses **https://www.shepards-tyre-management.com/** for new installations and migrates phones using the old default or a saved `https://tyre-management.onrender.com` address. The phone saves the new address and clears its old bearer token before its first network request, so sign in again after updating. Separately chosen custom HTTPS servers remain selected. The app now supports the Vercel/PostgreSQL backend, accurate server-error messages and five-second shared updates. Changing the address does not copy records between different databases or provision DNS/HTTPS. Browser requests continue to use the website's own origin.

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

## Vercel deployment (1.9 — no Render dependency)

Vercel now hosts both the website and its API. A durable external PostgreSQL database, such as **Neon**, stores accounts, sessions, vehicles, tyres and log entries. `vercel.json` routes `/api/*` to the bundled Node function `api/index.js`; it makes no requests to Render. SQLite remains available for local development and older standalone installations, and is never used as a fallback inside Vercel.

### Connect the database and publish

1. Open the Vercel project, choose **Storage → Create Database** (or browse **Marketplace**) and select **Neon / PostgreSQL**. Create or select a database, then connect it to this project. Review the provider's plan in that UI. The integration should add a private **DATABASE_URL** environment variable. **POSTGRES_URL** is also supported. Do not add a `VITE_` prefix or put credentials in source/chat.
2. Enable the database connection for **Production** and for **Preview** if testing preview deployments. Production staff should use the production company domain. Provider-managed preview branches may have separate test records; they do not automatically share production data.
3. Deploy the latest `main` commit. Use the repository root, **Vite**, build command **npm run build**, output directory **dist**, and Node **24.x**. The API creates its tables and seeds the admin exactly once on first connection; changed passwords/accounts are preserved across cold starts and redeploys.
4. Under **Settings → Domains**, add **www.shepards-tyre-management.com**. Apply the exact DNS targets Vercel displays at the domain registrar and wait for its domain/HTTPS status to become valid. Do not guess a CNAME or IP address.
5. Under **Settings → Deployment Protection**, allow public access on the deployment used by staff/Android. App sign-in still protects fleet data. A redirect to a Vercel account-login page prevents the Android API from working.
6. Open **https://www.shepards-tyre-management.com/api/health**. It should return **`{"ok":true,"version":"1.9.0"}`**. This performs a live database query. `databaseNotConfigured` means connect the database/environment variable and redeploy; `databaseUnavailable` means the configured database could not be reached. These failures return JSON 503, never a new temporary database.

Connecting a new database starts a new fleet unless a full existing backup is imported. Keep any Render records/accounts or full SQLite backup until migration is verified. The old Render health result `1.8.2` describes that older service, not the new Vercel deployment. No old records have been copied merely by changing the app's address. Render can be retired after the Vercel/database setup and any required import are verified.

### Shared writes and authentication

Each Vercel instance uses a bounded PostgreSQL pool with certificate verification enabled. Initial schema/seed creation and all account/session/fleet writes share a transaction-scoped advisory lock. A write revalidates the authenticated user and session inside that transaction, checks the revision and commits the full action atomically. Removing staff, changing passwords and revoking sessions therefore applies across instances. Login limits are stored in the database as well. A failed initialization can retry on the next request without poisoning a warm instance.

The frontend uses a five-second polling interval and stops polling when hidden or signed out. Each poll reads authoritative committed records; it does not rely on another function's memory. Existing APKs that lack polling hints receive bounded waiting responses. The company origin, exact main-branch preview, and exact deployment hostnames injected by Vercel are accepted for this fleet. Other websites and spoofed forwarding headers remain rejected. An explicit **PUBLIC_ORIGIN** for another fleet disables these automatic fleet origins. Set **TRUST_PROXY=0/1** only to override the platform's standard proxy detection.

A missing database, suspended/failed service or an HTML error page is shown as a server problem. The offline message is reserved for the device's offline state. The initial connection allows up to 60 seconds; Retry fetches authoritative records and resumes updates. None of this configures the Vercel account, DNS or database integration automatically.

### Validation

The default **npm test** suite retains the SQLite/model/API regressions and serverless missing-configuration checks. Optional real PostgreSQL tests require an isolated **local** disposable instance with a role allowed to create test databases; they create/drop unique child databases and refuse a non-loopback test host:

```sh
# Set TEST_DATABASE_URL securely to a disposable local PostgreSQL instance.
npm run test:postgres
# Include the real React + Vercel handler + two-instance browser check:
BROWSER_PATH=/usr/bin/chromium npm run test:postgres
```

Checks cover concurrent initialization, persistence after a cold restart, duplicate/revision races, atomic import/vehicle sales, cross-instance staff/password revocation, native bearer auth, rewritten API paths, recovery refusal/rollback and spaced browser polling. Local tests are not verification of the live Vercel project, provider integration, DNS or deployment-protection settings.

## Backup, migration and recovery

UI JSON/CSV exports are reports: they omit staff password hashes and are **not** the complete backup format used below. The PostgreSQL recovery tools preserve users (including password hashes), fleet settings and all log records. They deliberately omit sessions/rate limits; everyone signs in again after import. Automated off-server backup scheduling and provider recovery retention are separate from the connection setup.

Use **DATABASE_URL** privately in the operator's environment (or **POSTGRES_URL** for the runtime); never put it in shell arguments or committed files. Every destination backup file must be new; files are created with private permissions. Keep dated copies off the application host.

```sh
# Full PostgreSQL account + fleet backup:
npm run backup:postgres -- /secure/backups/fleet-backup.json

# Migrate a supplied COMPLETE SQLite backup into a pristine PostgreSQL database:
npm run migrate:postgres -- /secure/backups/old-fleet.sqlite

# Restore a full PostgreSQL JSON backup into a pristine PostgreSQL database:
npm run restore:postgres -- /secure/backups/fleet-backup.json
```

Imports are atomic and refuse a target with existing records, changed admin credentials, additional staff/settings, or a prior-import marker. They preserve user IDs, usernames, hashes, vehicle/tyre IDs and history, reset the user sequence, and revoke sessions. Invalid data or a failed import rolls back. Test recovery against a separate database before relying on a backup. These tools never write to the old source database or overwrite live PostgreSQL data.

For an older standalone SQLite installation, **npm run backup -- /secure/backups/fleet.sqlite** creates a consistent SQLite backup. Preserve the live database and WAL/SHM files before any manual replacement. The SQLite backup and password-reset commands explicitly refuse PostgreSQL configuration so an operator cannot accidentally back up/reset an unrelated local file.

### Account recovery

After a full backup, an operator can reset an active account without printing the new password:

```sh
read -r -s -p 'New password (10+ characters): ' FLEET_ADMIN_PASSWORD
export FLEET_ADMIN_PASSWORD
npm run reset-password:postgres -- your_username
unset FLEET_ADMIN_PASSWORD
```

This revokes all of that user's sessions. For a standalone SQLite installation without PostgreSQL configured, use **node server/reset-password.js your_username** with the same private environment variable.

### Standalone development/legacy hosting

**npm run dev** uses SQLite at **./data/tyresaathi.sqlite** by default. Set **DATABASE_URL** to use PostgreSQL on a continuously running Node server as well. The included Docker/Compose/Caddy and Render files remain legacy examples; the Vercel deployment does not call those services. SQLite hosting needs a persistent disk/volume and one instance. Never rely on a temporary filesystem for business records or remove the data volume during an upgrade.

## Limits

One fleet per database. Large histories or many concurrent users may need a normalized database later. GPS tracking, purchase costs, automatic remote backups, Play Store publication and automatic migration of old phone-only records are not included. Keep dated off-server backups and verify restoration.
