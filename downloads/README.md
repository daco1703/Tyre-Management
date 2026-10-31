# Android test update

[Download Shepards Tyre Management 1.8.2](https://github.com/daco1703/Tyre-Management/blob/main/downloads/Shepards-Tyre-Management-1.8.2-test.apk?raw=true)

Install over the earlier build without uninstalling. The package ID and test signing certificate are unchanged. The app opens the login for **https://www.shepards-tyre-management.com/** directly. Phones using the old default or saved Render address switch to this domain automatically and require fresh sign-in; other chosen custom servers remain selected. Use admin or an assigned staff username/password. Forgot username/password displays Contact the admin.

**Admin:** Team & settings → Add staff → enter a unique username, password and confirmation. Only admin can add or remove staff. Removing access retains the employee's historical log entries.

All accounts share live vehicle/tyre records. Each entry includes the authenticated username and timestamp. Losing internet displays **You are offline. Please connect to the internet.** and blocks entries until reconnection. Offline login and public staff signup have been removed. Deploy server version **1.8.2** on Render if automatic deployment is disabled. The company domain must be connected to the service and serve HTTPS; use `PUBLIC_ORIGIN=https://www.shepards-tyre-management.com` in Render. Changing the app's address does not move records between servers or configure the domain's DNS.

Old phone-only records are not deleted or automatically uploaded to the server. Export any needed local records using the old version before upgrading. This version uses shared-server records only.

Tyre Location retains positions 1–18 from right to left per row and the extra gap between rows 2/3. Removal to stock/remolding/scrap, mileage, scrap reasons including Other, and Excel vehicle import are retained. [Blank Excel template](https://github.com/daco1703/Tyre-Management/blob/main/downloads/TyreSaathi-vehicle-template.xlsx?raw=true).

This is a debug-signed APK for phone testing. SHA-256 checksums are in SHA256SUMS.txt. Older APKs remain for reference.

Version 1.5 adds BS vehicle classes and driver changes, vehicle tyre inspections, direct NSD tread percentages with advisory two-month reminders, date-filtered vehicle/overall reports, dd/mm/yyyy dates, Radial/Horse construction, manufacturer selection, and remolding vendors Sharvayu / Guardex MRF / Other. Login no longer asks for a fleet name.

Version 1.6 bundles cleaned logo/banner artwork permanently, including the Android launcher. There is no branding upload step. Smaller text is larger and status colours are brighter. NSD is one average percentage; new and freshly remolded tyres start at 100%, and manual NSD entry is fitted-only. Existing three-point history remains intact and is shown as an average. Only admin can add/import vehicles. All staff can import tyres from Excel and record sales; sold tyres leave active stock and remain in the Sold tab with their full history and sale notes.

[Blank tyre Excel template](https://github.com/daco1703/Tyre-Management/blob/main/downloads/Shepards-tyre-template.xlsx?raw=true). Use text cells for Tyre ID to preserve leading zeros. New/Used/Remold, Radial/Horse and Previous km are optional; defaults are New, Radial and 0. The seven supplied manufacturer logos are bundled unchanged; custom manufacturers use initials.

Version 1.7 refines cards, spacing, buttons, readable colours and logo sizing. The manufacturer dropdown is MRF, Apollo, CEAT, JK Tyre, Bridgestone, Michelin, Goodyear and Custom / other. Their original uploaded logos are bundled at full resolution, with proportions preserved. The tyre map groups positions 1–6 as Horse and 7–18 as Trolley, with a larger gap between rows 2 and 3.

**Admin only:** open a vehicle → **Vehicle Sold**, review the tyre list, enter the final odometer, optionally add buyer/reference notes, confirm and record the sale. The vehicle leaves active fleet counts/lists and is retained in Sold vehicles. Its fitted tyres, including the spare, move to tyre Sold with final mileage and linked history; garage stock remains available. The sold vehicle is read-only and remains available in reports. Update Render to 1.7 before using this action.

Version 1.8 fixes the squeezed tyre-detail header, keeps company logo/wordmark panels at equal heights, and uses distinct inventory/history cards. Brand, status, condition, construction and mileage have separate stable sections. Full tyre IDs stay on one readable line; swipe the Horse/Trolley diagram sideways on a narrow phone to see both sides. The page itself does not scroll sideways. English/Hindi layouts were checked at nine widths with all 210 brand/condition/construction/status combinations per language, custom/long text and the reported regression (562 screen/form checks). Existing accounts, data and sale/inspection workflows are preserved.
