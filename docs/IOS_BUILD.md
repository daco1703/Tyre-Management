# Shepards Tyre Management for iPhone and iPad

The native project is [App.xcodeproj](../ios/App/App.xcodeproj), with shared scheme **App** and bundle identifier **in.tyresaathi.logbook**. The release scripts synchronize its version and build number from [shared/release.js](../shared/release.js). It supports iOS/iPadOS 18 or newer, matching the modern WebKit APIs used by the shared interface. The company SS icon and branded launch screen are bundled permanently. The shared English/Hindi interface, accounts and fleet records use the same HTTPS server as Android and the website.

The project uses **Swift Package Manager**, with Capacitor pinned to 7.6.9. App, Filesystem and Share plugins reference the installed npm packages, so run `npm ci` before opening Xcode. Xcode resolves Capacitor and the Filesystem plugin's native dependency from GitHub. CocoaPods is not required.

Capacitor 7 generates a Swift 5.9 manifest using the iOS 18 enum that requires PackageDescription 6.0. The repository's `capacitor:sync:after` and `capacitor:update:after` hooks replace that platform declaration with `.iOS("18.0")`, preserving the app's deployment target and all dependencies. Keep these hooks when changing sync commands; a manual edit alone would be overwritten by the next sync.

## Build and run on a Mac

Install Xcode 16 or newer with an iOS 18-or-newer Simulator runtime, and Node 24. Use an Xcode/SDK version currently accepted by Apple when preparing a store submission. From the repository root:

```sh
npm ci
npm run build
npx cap sync ios
open ios/App/App.xcodeproj
```

Choose the **App** scheme and an iPhone/iPad Simulator in Xcode, then Run. To build a simulator app from the command line:

```sh
xcodebuild -resolvePackageDependencies \
  -project ios/App/App.xcodeproj -scheme App

xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath ios/DerivedData \
  CODE_SIGNING_ALLOWED=NO build
```

The output is `ios/DerivedData/Build/Products/Debug-iphonesimulator/App.app`. A simulator `.app` runs in the iOS Simulator; it cannot be installed on a physical iPhone.

## Install on an iPhone

In Xcode, select **App → Signing & Capabilities**, choose your Apple development team, and leave automatic signing enabled. Connect the iPhone, select it as the run destination, enable Developer Mode on the phone when prompted, and Run. A personal Apple ID can support development testing subject to Apple's provisioning limits. TestFlight, App Store distribution and the signed distribution workflow require the appropriate Apple Developer Program account and signing setup.

For distribution, select a physical-device/generic iOS destination, choose **Product → Archive**, and use Xcode Organizer to validate and distribute the signed archive. Configure signing credentials through Xcode or the repository's protected CI secrets; do not put certificates, provisioning profiles, passwords or private keys in source or chat. An unsigned simulator build is not a signed IPA or a TestFlight release.

## GitHub build workflows

[Validate website, Android and iOS](../.github/workflows/validate.yml) runs the shared checks and a macOS simulator compile. Its iOS artifact is clearly labelled **NOT installable on iPhone**. A successful workflow run verifies compilation with the runner's installed Xcode; the source project alone does not establish that result.

[Build signed iOS IPA manually](../.github/workflows/ios-signed-device.yml) is available through GitHub Actions on `main`. Configure the protected **ios-signing** environment with **IOS_P12_BASE64**, **IOS_P12_PASSWORD**, **IOS_PROVISION_PROFILE_BASE64**, **IOS_TEAM_ID**, and **IOS_SIGNING_IDENTITY** secrets. Select `release-testing` for an appropriate distribution profile or `debugging` for a development profile. The profile must match this bundle identifier and include the intended test devices.

The manual workflow exports an IPA as an Actions artifact. It does not upload to TestFlight or the App Store. An IPA can be installed only where its provisioning/signing permits; a simulator artifact cannot substitute for it.

## Refresh the bundled interface

After changing the web app, run `npm run build` followed by `npx cap sync ios`. The generated `ios/App/App/public`, `capacitor.config.json` and `config.xml` are deliberately ignored by Git and are recreated by sync. Do not replace the SPM project with a new `cap add` operation. The checked-in scheme and project settings are retained by sync.

App settings use the iOS WebView's local storage; shared fleet records remain in PostgreSQL. `capacitor://localhost` is an allowed native API origin and login uses revocable bearer tokens. The live deployment must permit public API access before app sign-in, including unauthenticated preflight requests. A Vercel account-login page cannot authenticate this native app.

## Privacy and release checks

`App/PrivacyInfo.xcprivacy` belongs to the app's Copy Bundle Resources phase. It declares Filesystem's file-timestamp API reason **C617.1**, no tracking, and the source-supported collection of user IDs, names and user-entered fleet content for app functionality. There is no native Preferences/UserDefaults plugin, so a UserDefaults API reason has not been added. Revisit that declaration if native preferences, analytics or other SDKs are introduced.

The app retains Apple's default transport security and uses HTTPS. Cache-based exports use the native share sheet, without Photos or broad storage permissions. The standard HTTPS encryption declaration is included. The owner should match App Store Connect privacy/export answers and the privacy policy to the actual hosting, logging and distribution setup before publishing.

The cloud workspace used to prepare this project is Linux and cannot compile or launch UIKit/Xcode. Project generation, plugin synchronization and static resource checks can run there. A successful macOS/Xcode build and a real-device check are still needed to verify native compilation, keyboard behavior, file import/share, safe areas and signed installation.
