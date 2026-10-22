# Android test update

[Download Shepards Tyre Management 1.4.0](https://github.com/daco1703/Tyre-Management/blob/main/downloads/Shepards-Tyre-Management-1.4-test.apk?raw=true)

Install over the earlier build without uninstalling. The package ID and test signing certificate are unchanged. The app opens the login for **https://tyre-management.onrender.com/** directly. Use admin or an assigned staff username/password. Forgot username/password displays Contact the admin.

**Admin:** Team & settings → Add staff → enter a unique username, password and confirmation. Only admin can add or remove staff. Removing access retains the employee's historical log entries.

All accounts share live vehicle/tyre records. Each entry includes the authenticated username and timestamp. Losing internet displays **You are offline. Please connect to the internet.** and blocks entries until reconnection. Offline login and public staff signup have been removed. The server must also run version 1.4; deploy the latest main commit on Render if automatic deployment is disabled.

Old phone-only records are not deleted or automatically uploaded to the server. Export any needed local records using the old version before upgrading. This version uses shared-server records only.

Tyre Location retains positions 1–18 from right to left per row and the extra gap between rows 2/3. Removal to stock/remolding/scrap, mileage, scrap reasons including Other, and Excel vehicle import are retained. [Blank Excel template](https://github.com/daco1703/Tyre-Management/blob/main/downloads/TyreSaathi-vehicle-template.xlsx?raw=true).

This is a debug-signed APK for phone testing. SHA-256 checksums are in SHA256SUMS.txt. Older APKs remain for reference.
