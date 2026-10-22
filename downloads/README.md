# Android offline test build

[Download TyreSaathi 1.2.0 APK with Excel import](https://github.com/daco1703/Tyre-Management/blob/main/downloads/TyreSaathi-1.2-excel-test.apk?raw=true)

This is a debug-signed test build for Android 6.0 or later with a current Android System WebView. Its package ID and signing certificate match the previous test builds, so install it as an update if you already installed version 1.0 or 1.1. Do not uninstall to update.

1. Download the APK on your Android phone. Open it from Downloads and choose Install. If Android requests it, allow your browser or file manager to install this app.
2. Open TyreSaathi and tap **Use offline on this phone**. You can turn on airplane mode before the first launch.
3. Enter your garage name and tap **Open offline garage**. No server, account or internet connection is needed.
4. Add a vehicle, then some tyres. Open the vehicle and tap an empty wheel position to fit a tyre. Update the odometer or return a tyre to the garage to test the logbook and daily tally. Use the language button to try Hindi.
5. Close and reopen the app to check persistence. Export your records from **Team & settings → Export records (JSON)**.

To add vehicles in bulk, open **Vehicles → Import from Excel**. Download the [blank Excel template](https://github.com/daco1703/Tyre-Management/blob/main/downloads/TyreSaathi-vehicle-template.xlsx?raw=true), fill one vehicle per row, then select it in the app. Choose a worksheet if necessary, review the preview and confirm the ready rows. Duplicate/invalid rows are skipped. The columns are Vehicle Registration, Vehicle Name / Driver, Odometer (km), and Has Spare (Yes/No). Only registration is mandatory. Import up to 200 rows per worksheet in a `.xlsx` file up to 2 MB. This works offline.

Records are stored only on this phone. Clearing app storage or uninstalling removes them; install updates without uninstalling. Exports are record files; this build does not have a restore/import screen. Offline records stay separate from a shared server and do not merge automatically when you switch modes.

The repository includes `SHA256SUMS.txt` for the APK checksum. Automated browser checks cover offline writes, persistence, Hindi and export; the installed APK still needs testing on your physical phone. This is not a Play Store release.
