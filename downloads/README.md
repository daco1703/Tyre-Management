# Android test build

[Download Shepards Tyre Management 1.3.0](https://github.com/daco1703/Tyre-Management/blob/main/downloads/Shepards-Tyre-Management-1.3-test.apk?raw=true)

Install this APK as an **update** over the earlier TyreSaathi build. Do not uninstall or clear storage; this keeps your offline records. The Android package ID and test signing certificate are unchanged.

Open **Use offline on this phone**, sign in as **admin** with the initial password supplied by the fleet owner. A new garage defaults to **Shepards Shipping Services**. Existing garage records and names are preserved. Offline login is required after reopening the app. **Forgot username/password** displays **Contact the admin.** Change the password under **Team & settings → Change password** if needed; offline and server passwords are separate.

**Tyre Location** numbers positions 1–18 from right to left on each row, with an extra gap between rows 2 and 3. Existing positions are preserved. The spare remains SP.

To remove a fitted tyre, open its vehicle, tap the tyre, then **Remove tyre**. Enter the current vehicle odometer and choose **Return to stock**, **Send for remolding**, or **Scrap tyre**. Scrap requires a reason; select **Other** to enter a different reason. Every removal saves kilometres since fitting and lifetime tyre kilometres. Spares accrue zero running kilometres. Remolding tyres have a separate inventory tab and daily tally; **Record remolding** returns a completed remold to stock without losing mileage.

To add vehicles in bulk, open **Vehicles → Import from Excel**. Download the [blank Excel template](https://github.com/daco1703/Tyre-Management/blob/main/downloads/TyreSaathi-vehicle-template.xlsx?raw=true), fill one vehicle per row, select the file, review the preview and confirm. Duplicate/invalid rows are skipped. Only registration is mandatory; name/driver, odometer and spare are optional. Import up to 200 rows in a `.xlsx` workbook up to 2 MB. This works offline.

Export records regularly. Uninstalling the app or clearing storage deletes the phone's records. This debug-signed build is for testing; Android file choosing, sharing and installation should also be checked on your phone. No public server is included.

SHA-256 checksums for downloads are in `SHA256SUMS.txt`. Older APKs remain available for reference; install 1.3 as the update.
