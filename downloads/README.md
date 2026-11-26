# Website, Android and iOS downloads

[Download Android APK 1.12.0](https://github.com/daco1703/Tyre-Management/blob/main/downloads/Shepards-Tyre-Management-1.12-test.apk?raw=true)

**Reminders (1.12):** sign in, open **Team & settings → Notifications**, enable this device and grant notification permission. Choose NSD, inspections, driver-change and licence reminders separately. The supplied APK schedules phone alerts from its last synced records without Firebase. Reopen it regularly to refresh schedules. Remote delivery uses current server records and needs private Vercel/Firebase/Apple setup as applicable; see [notification setup](../docs/PUSH_SETUP.md). iPhone Home Screen Web Push needs the daily Vercel job and does not need Firebase or a native IPA.

Install over the earlier build without uninstalling. The package ID and test signing certificate are unchanged. New installations open **https://tyre-management-shepards.vercel.app/** directly. Updates preserve a saved HTTPS server, including the company domain. The old Render default switches to the confirmed production address and requires fresh sign-in. Use admin or an assigned staff username/password. Forgot username/password displays Contact the admin.

**iPhone/iPad without a Mac:** open [the website](https://tyre-management-shepards.vercel.app/) in Safari, choose **Share → Add to Home Screen**, enable **Open as Web App** if offered, then tap **Add**. The iOS interface supports English/Hindi, light/dark appearance and floating navigation. It uses the same account and fleet records and requires internet.

[iOS project and shared source 1.12.0 ZIP](https://github.com/daco1703/Tyre-Management/blob/main/downloads/Shepards-Tyre-Management-1.12.0-ios-project-source.zip?raw=true) · [Compiled web client 1.12.0 ZIP](https://github.com/daco1703/Tyre-Management/blob/main/downloads/Shepards-Tyre-Management-1.12.0-web-client.zip?raw=true)

The iOS ZIP contains a Swift Package Manager Xcode project and the shared source. It is **not an installable IPA**. Native iPhone builds require macOS/Xcode and Apple signing. GitHub workflows provide an unsigned simulator build and an optional manual signing path once the owner supplies Apple credentials privately. See [iOS build instructions](../docs/IOS_BUILD.md) and [release instructions](../docs/RELEASING.md). The web-client ZIP needs the existing working API; uploading static files alone does not provide login or storage.

**Admin:** Team & settings → Add staff → enter a unique username, password and confirmation. Only admin can add or remove staff. Removing access retains the employee's historical log entries.

All accounts share live vehicle/tyre records. Each entry includes the authenticated username and timestamp. Losing internet displays **You are offline. Please connect to the internet.** and blocks entries until reconnection. Offline login and public staff signup have been removed. Deploy server version **1.12.0** on Vercel with the existing private Neon/PostgreSQL connection. Vercel hosts both the website and API. Deployment access must be public for staff phones; the app's own login protects records. Changing the app's address does not import old records or configure DNS. Normal client updates do not reset the database.

Old phone-only records are not deleted or automatically uploaded to the server. Export any needed local records using the old version before upgrading. This version uses shared-server records only.

Tyre Location retains positions 1–18 from right to left per row and the extra gap between rows 2/3. Removal to stock/remolding/scrap, mileage, scrap reasons including Other, and Excel vehicle import are retained. [Blank Excel template](https://github.com/daco1703/Tyre-Management/blob/main/downloads/TyreSaathi-vehicle-template.xlsx?raw=true).

This is a debug-signed APK for phone testing. SHA-256 checksums are in SHA256SUMS.txt. Older APKs remain for reference.

Version 1.5 adds BS vehicle classes and driver changes, vehicle tyre inspections, direct NSD tread percentages with advisory two-month reminders, date-filtered vehicle/overall reports, dd/mm/yyyy dates, Radial/Horse construction, manufacturer selection, and remolding vendors Sharvayu / Guardex MRF / Other. Login no longer asks for a fleet name.

Version 1.6 bundles cleaned logo/banner artwork permanently, including the Android launcher. There is no branding upload step. Smaller text is larger and status colours are brighter. NSD is one average percentage; new and freshly remolded tyres start at 100%, and manual NSD entry is fitted-only. Existing three-point history remains intact and is shown as an average. Only admin can add/import vehicles. All staff can import tyres from Excel and record sales; sold tyres leave active stock and remain in the Sold tab with their full history and sale notes.

[Blank tyre Excel template](https://github.com/daco1703/Tyre-Management/blob/main/downloads/Shepards-tyre-template.xlsx?raw=true). Use text cells for Tyre ID to preserve leading zeros. New/Used/Remold, Radial/Horse and Previous km are optional; defaults are New, Radial and 0. The seven supplied manufacturer logos are bundled unchanged; custom manufacturers use initials.

Version 1.7 refines cards, spacing, buttons, readable colours and logo sizing. The manufacturer dropdown is MRF, Apollo, CEAT, JK Tyre, Bridgestone, Michelin, Goodyear and Custom / other. Their original uploaded logos are bundled at full resolution, with proportions preserved. The tyre map groups positions 1–6 as Horse and 7–18 as Trolley, with a larger gap between rows 2 and 3.

**Admin only:** open a vehicle → **Vehicle Sold**, review the tyre list, enter the final odometer, optionally add buyer/reference notes, confirm and record the sale. The vehicle leaves active fleet counts/lists and is retained in Sold vehicles. Its fitted tyres, including the spare, move to tyre Sold with final mileage and linked history; garage stock remains available. The sold vehicle is read-only and remains available in reports. The current Vercel server supports this action.

Version 1.8 fixes the squeezed tyre-detail header, keeps company logo/wordmark panels at equal heights, and uses distinct inventory/history cards. Brand, status, condition, construction and mileage have separate stable sections. Full tyre IDs stay on one readable line; swipe the Horse/Trolley diagram sideways on a narrow phone to see both sides. The page itself does not scroll sideways. English/Hindi layouts were checked at nine widths with all 210 brand/condition/construction/status combinations per language, custom/long text and the reported regression (562 screen/form checks). Existing accounts, data and sale/inspection workflows are preserved.

Version 1.9 runs the website/API on Vercel with durable PostgreSQL storage. Shared updates poll every five seconds while visible, server failures no longer report false offline status, and account/session/fleet writes are transactional across instances. The database must be connected before sign-in works. Full SQLite/PostgreSQL backup migration tools are described in the main README; older records are not automatically copied.

Version 1.10 adds the native iOS project, iPhone/iPad appearance and Safari installation help. Website, APK and iOS versions are synchronized by release scripts and checked in CI. This release has no database migration. Browser emulation and APK build/signature checks do not replace real-device verification.

Version 1.11 adds separate admin reminder durations, audited admin tyre-identity corrections, Excel import from Add tyre, driver profiles and searchable vehicle assignment, mandatory per-tyre invoices, fleet purchase/remold counts and an admin-only cost report with a dynamic graph. Driver profiles can be added/edited by admin and staff. Staff financial data is filtered on the server. Existing records and unknown historical costs remain intact. Install this APK before adding tyres or completing remolding; older forms lack the required invoice fields. The sidebar shield/tagline block has been removed.
