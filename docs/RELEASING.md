# Shared website, Android and iOS releases

The React client and `shared/` business rules serve all three platforms. They use the same Vercel API and existing private Neon database. Releasing a client must not reset or replace that database.

Use Node 24 and `npm ci`. `shared/release.js` owns the version and numeric build number. Both Android and iOS use the same values, and package/lock versions match them.

```sh
npm run check:versions
npm run release:bump -- patch
# Or choose explicit values, increasing the build number:
npm run release:set -- 1.10.0 12
# Align native/package metadata with the current shared values:
npm run release:sync
```

For a feature, run the version check, appropriate tests and `npm run build`; sync both native projects. The validation workflow runs Node 24 tests/browser checks, an Android compile with Java 21, and an unsigned iOS simulator compile on macOS. A workflow file alone does not mean those remote jobs passed: inspect the actual GitHub Actions result.

## Release archives

```sh
npm run bundle:release
```

This builds the shared client, syncs Android/iOS and creates three files in `downloads/`:

- `Shepards-Tyre-Management-VERSION-web-client.zip`: compiled `dist/` assets and instructions. It needs the app's API and database; static hosting alone does not provide sign-in or records.
- `Shepards-Tyre-Management-VERSION-ios-project-source.zip`: the iOS project and shared source/configuration needed to rebuild, including Android metadata for release checks.
- `Shepards-Tyre-Management-VERSION-bundles-SHA256SUMS.txt`: archive checksums.

Archives contain per-file manifests and checksums, sorted paths, fixed ZIP timestamps and normalized permissions. Stored ZIP entries avoid differences between compression-library versions. They exclude Git internals, environment files, databases/backups, signing files, dependencies, build directories, test screenshots and old downloads/APKs. Rebuilding unchanged inputs reproduces the checksums. Verify the ZIP contents before sharing.

The source archive has no installed dependencies or generated native web assets. Extract it and run:

```sh
npm ci
npm run check:versions
npm run ios:sync
```

Use a checkout of the repository to regenerate the release archives themselves; the archive builder obtains its source-file list from Git. Source archives can build the app without Git.

## Android

Build with Java 21 and the Android SDK:

```sh
npm run android:sync
bash android/gradlew -p android --no-daemon assembleDebug
```

Preserve the existing package ID and private signing key when issuing updates for installed phones. Do not commit that key. The validation workflow's debug APK uses the runner's temporary debug key and is labelled **not an installed-app upgrade**. Its successful compilation validates the code; it does not establish signing compatibility with an installed app.

## iOS simulator

On a Mac with Xcode, run `npm run ios:sync` and open `ios/App/App.xcodeproj` with the `App` scheme. The project uses Swift Package Manager, not CocoaPods.

```sh
xcodebuild -resolvePackageDependencies -project ios/App/App.xcodeproj -scheme App
xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath build/ios-simulator CODE_SIGNING_ALLOWED=NO build
```

This does not require an Apple Developer account. The `.app`/ZIP produced by this build runs in an iOS simulator on a Mac; **it cannot be installed on an iPhone**. An iOS source ZIP is also not an IPA. A Linux build or browser test does not validate Xcode compilation.

## Optional signed iPhone IPA

The **Build signed iOS IPA manually** workflow runs only through `workflow_dispatch` on `main`, using the `ios-signing` GitHub environment. Configure that environment with appropriate review protection and these secrets:

| Secret                         | Required value                                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `IOS_P12_BASE64`               | Base64 Apple signing certificate and private key exported as a `.p12`.                                                  |
| `IOS_P12_PASSWORD`             | Password protecting the `.p12`.                                                                                         |
| `IOS_PROVISION_PROFILE_BASE64` | Base64 provisioning profile for `in.tyresaathi.logbook`, the same team/certificate and the intended registered devices. |
| `IOS_TEAM_ID`                  | Apple Developer team ID.                                                                                                |
| `IOS_SIGNING_IDENTITY`         | Matching signing certificate identity, such as an Apple Distribution identity.                                          |

Use `release-testing` for an Ad Hoc profile or `debugging` for a development profile. The certificate and profile must support the selected method. Registered-device distribution generally needs an Apple Developer membership and the target devices in its provisioning profile. Without the required signing setup, this workflow cannot produce an installable device IPA.

The workflow uses Xcode 16 or later, installs its profile in Xcode's current provisioning directory and scopes signing settings to the App target so Swift package targets receive no provisioning overrides. It restores the original project afterward, removes its temporary profile/keychain and retains only the IPA artifact for seven days. Restrict repository/workflow access because an IPA is signed software. It never uploads to App Store Connect or TestFlight and never publishes automatically. Confirm an actual signed build and installation on an authorized iPhone before claiming device validation.
