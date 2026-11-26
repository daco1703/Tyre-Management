# Reminder notification setup

The shared app supports two delivery paths. **Local reminders** are scheduled on the phone from the latest synced fleet records. **Remote push** reaches registered phones through the shared server: Android uses Firebase Cloud Messaging (FCM), and iOS uses Apple Push Notification service (APNs) directly. iOS does not need a Firebase project or `GoogleService-Info.plist`.

An APK built without Firebase configuration still compiles and can schedule local reminders after the user enables notifications. It cannot register for Android remote push. The app reports that limitation instead of pretending the phone has registered.

## Website and iPhone Home Screen push

Web Push uses the existing Vercel API and Neon database. No Firebase project is needed for the website. The server generates a private VAPID key pair once and stores it outside fleet records; only the public key is sent to the browser. Keep the same database when deploying updates so existing subscriptions remain valid. Notification registrations and private keys are excluded from recovery exports; after restoring a backup, each device must enable notifications again.

Use the production website over HTTPS. On desktop Chrome/Edge/Firefox or supported Android browsers, sign in and open **Team & settings → Notifications → Enable notifications**. Accept the browser permission prompt. On iPhone/iPad, first open the site in Safari, use **Share → Add to Home Screen**, then open the installed icon and enable notifications there. An ordinary Safari tab cannot receive this app's Web Push subscription. Browsers must support Push API, service workers and Web Notifications.

If permission was denied, enable it in the browser/phone settings before retrying. Turning notifications off removes this device's subscription. Only opted-in devices receive reminders; the admin's task intervals do not grant notification permission on staff phones.

## Activate the daily Vercel job

1. Open the existing Vercel project → **Settings → Environment Variables**.
2. Add **`CRON_SECRET`** for **Production**, using a new private random value of at least 32 characters. A password manager can generate it, or run `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` locally. Do not paste it into chat, Git or client-side `VITE_` variables.
3. Redeploy the latest `main` deployment. Keep the existing `DATABASE_URL`/`POSTGRES_URL` unchanged. Confirm **Settings → Cron Jobs** lists `/api/notifications/dispatch` with `30 3 * * *`.
4. Open the app's notification settings and enable the device. If it previously showed missing server setup, retry Enable after deployment. Use **Test this device**, then check delivery and tap navigation with the app closed. A successful health endpoint alone does not verify notification delivery.

The schedule is once daily around **9 AM India time**; the free Vercel Hobby plan can run within the scheduled hour. The job sends one generic count summary per opted-in device per India calendar day when at least one selected reminder is due. It covers NSD, inspections, driver-change checks, upcoming licences and expired licences. Completing work or changing admin intervals changes subsequent server summaries. There are no empty daily messages.

The endpoint requires the secret as a Bearer token, which Vercel attaches automatically. Devices cannot invoke the job through ordinary app login. It claims deliveries in the database, sends batches of at most 20 outside transactions, and supports up to 500 enrolled devices (five per account). The function allows up to 300 seconds with Fluid Compute; the job stops after a 270-second budget and reports any remaining deliveries. Inspect Cron Jobs/runtime logs for failures or a nonzero `remaining` count. Failed sends may be retried through Vercel's authenticated Run action; successful devices are deduplicated for that day. Vercel does not guarantee automatic retries or exact delivery time.

Android native remote push also needs Firebase below; signed native iOS remote push needs APNs below. The downloaded unconfigured APK uses scheduled local alerts. Server-side provider credentials and a native rebuild are separate requirements.

## Local reminders first

1. Install a build containing the notification plugins, sign in to the shared app, and sync the fleet records.
2. Enable phone reminders in the app's notification settings and accept the Android/iOS notification permission prompt.
3. Use **Test this device**, including opening it from the phone notification, and check that the dashboard reminders open correctly.

Android 13 and later require `POST_NOTIFICATIONS`, which is declared in the app manifest. The `fleet-reminders` channel is created at normal importance (3), with the white `ic_stat_tyre` status icon and the company red accent. Users can change sound and channel preferences in Android settings.

The app does **not** request `SCHEDULE_EXACT_ALARM` or `USE_EXACT_ALARM`. Capacitor Local Notifications 7 falls back to inexact alarms when exact alarms are unavailable. These are date reminders; Android power management can delay their delivery. There is no exact-alarm settings prompt.

Local alerts use the last synchronized records. Reopen the app with an internet connection to refresh changed deadlines and schedules. Clearing app data or reinstalling removes local schedules; force-stopping Android can prevent delivery until the app is reopened. Remote push also needs network access and the server's scheduled delivery job described in the [README](../README.md).

Local schedules contain a rolling 30-day window of daily reminders plus known later deadlines (including two-month checks), grouped to at most one notification per day and 50 pending reminders. Licence warnings and the first expired day are included. Local alerts cannot see changes recorded on another device while this app is closed, and daily repetition is finite until the app is reopened and synced. When working remote delivery is selected, the app cancels its local plans to avoid duplicate channels.

## Add Firebase for Android remote push

Use the owner's Firebase account; no Firebase project or credentials are supplied with this repository.

1. Create or select a project in the [Firebase console](https://console.firebase.google.com/).
2. Add an **Android** app with the exact package name **`in.tyresaathi.logbook`**. Keep that package name and the existing private Android signing key when updating installed copies.
3. Download the app's `google-services.json` and place it at **`android/app/google-services.json`** in a private workspace. This file is ignored by Git and excluded from source bundles. Do not commit it or substitute a made-up configuration.
4. Enable the Firebase Cloud Messaging HTTP v1 API for that project. Create or use a service account authorized to send FCM messages for the same project.
5. Put its service-account JSON into the **server-only** environment variable **`FCM_SERVICE_ACCOUNT`**, using the hosting provider's private environment settings. The JSON must contain `project_id`, `client_email` and `private_key`. The private key belongs on the server, never in the Android client, browser code, repository or release archives.
6. Rebuild the native app:

   ```sh
   npm ci
   npm run android:sync
   bash android/gradlew -p android --no-daemon assembleDebug
   ```

7. Install the appropriate signed build, sign in, and enable phone notifications again. Verify actual remote registration and a delivered notification, including its tap action.

When the Android app is already open, current reminders appear in the dashboard; foreground FCM messages do not create an additional phone banner. Background FCM messages use Android's notification area. Native iOS uses its configured foreground alert presentation.

The Android Google Services Gradle plugin is conditional. Without the file, no Firebase resources are generated and the native configuration check returns `configured: false`. JavaScript skips both `PushNotifications.register()` and `unregister()` in that state and uses local reminders. With a real client configuration, registration can be attempted; permission, network, Google Play services and backend credentials still determine whether remote delivery works.

A website deployment cannot add `google-services.json` to an already installed APK. A native rebuild and update are required. `google-services.json` configures the Android client; it is separate from the server's privileged `FCM_SERVICE_ACCOUNT` credentials.

### Optional GitHub build configuration

The Android validation workflow accepts the private **`ANDROID_GOOGLE_SERVICES_JSON`** Actions secret. Store the complete downloaded client JSON as that secret. The workflow writes it to `android/app/google-services.json` only for trusted `main` builds; pull-request checks can compile without it. A protected environment may be used for stricter control.

This does not configure the running server's FCM service account. Set that credential separately in the hosting provider. CI debug APKs use the CI debug key and are labelled as such; they are not upgrades for phones signed with the existing private key.

## Add APNs for iPhone/iPad remote push

Native iOS builds require macOS and Xcode. Remote APNs delivery also requires an appropriate Apple Developer Program team, the app identifier **`in.tyresaathi.logbook`**, and a signing/provisioning setup that permits Push Notifications. No Apple account, signing identity or APNs key is supplied with the source.

1. In Apple Developer, enable Push Notifications for the existing app identifier. Create or refresh the matching provisioning profiles after enabling the capability.
2. In Xcode, open `ios/App/App.xcodeproj`, select target **App**, choose the owner's team, and verify its **Push Notifications** capability and signing profile.
3. Create an APNs authentication key in the Apple Developer account. Keep the `.p8` file private, together with its key ID and team ID.
4. Configure these **server-only** environment variables:

   | Variable           | Value                                                                                  |
   | ------------------ | -------------------------------------------------------------------------------------- |
   | `APNS_KEY`         | Complete `.p8` PEM contents, including its line breaks                                 |
   | `APNS_TEAM_ID`     | Apple's 10-character team ID                                                           |
   | `APNS_KEY_ID`      | The APNs key's 10-character key ID                                                     |
   | `APNS_TOPIC`       | Exactly `in.tyresaathi.logbook`                                                        |
   | `APNS_ENVIRONMENT` | `sandbox` for a development build, or `production` for a production distribution build |

5. Sync the project with `npm ci` and `npm run ios:sync`, then build and sign on the Mac. Test registration and delivery on the intended phone/profile.

The project uses `App/App.entitlements`, with `aps-environment` expanded from the target's build setting:

| Xcode configuration | `APS_ENVIRONMENT` | Server `APNS_ENVIRONMENT` |
| ------------------- | ----------------- | ------------------------- |
| Debug               | `development`     | `sandbox`                 |
| Release             | `production`      | `production`              |

Use matching build and server environments when testing; a development token is not interchangeable with a production token. The iOS token sent to the server is the APNs hexadecimal token, not an FCM registration token.

The AppDelegate forwards Apple's registration success and failure callbacks to Capacitor. Local and remote plugins both use Capacitor's shared notification router; do not replace `UNUserNotificationCenter`'s delegate in the AppDelegate. Visible remote alerts and tap actions do not require a `remote-notification` background mode, so none is added.

### Local-only iOS development

Local notifications themselves do not require an APNs key or remote registration. A signed development build can test local alerts without server APNs credentials. If its development profile does not support the Push entitlement, use a local-only signing configuration with `CODE_SIGN_ENTITLEMENTS` empty and `APS_ENVIRONMENT` empty. Disable the Push capability for that local-only target if automatic signing requires it. Restore the checked-in entitlement and matching Push-capable profile before testing remote delivery or preparing a remote-enabled distribution build.

The unsigned simulator compile remains:

```sh
npm ci
npm run ios:sync
xcodebuild -resolvePackageDependencies \
  -project ios/App/App.xcodeproj -scheme App
xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath ios/DerivedData \
  CODE_SIGNING_ALLOWED=NO build
```

A simulator `.app` or source ZIP is not an installable iPhone IPA. Linux can synchronize the project and check its source/resources; macOS/Xcode compilation, signing and real-device delivery remain separate checks. See [IOS_BUILD.md](IOS_BUILD.md) and [RELEASING.md](RELEASING.md).

## Native configuration check

The app registers a small **`NotificationConfig`** bridge plugin on Android and iOS:

```js
const { configured } = await NotificationConfig.getStatus();
```

On Android it checks for the Firebase resources generated by a real `google-services.json`. This avoids calling Firebase Messaging before a default Firebase app can be initialized. On iOS it checks the APNs environment build flag; permission and Apple's actual registration callback still decide whether registration succeeds. The getter reveals no keys or configuration contents and does not prove that server provider credentials are configured or that a notification has been delivered.

Keep real Firebase JSON, service-account JSON, `.p8` keys, signing certificates, provisioning profiles and backend credentials out of Git and release archives. The repository ignores common credential filenames and the bundle script excludes them. Keep any differently named private credential file outside the repository as well.
