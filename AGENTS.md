# Shared app and release requirements

The user wants one shared application for the website, Android APK and iOS. Keep business rules in `shared/` and use the same React client, translations, branding and shared API on all three platforms. Future features must include any required native behavior and release updates for both Android and iOS.

Use Node 24 (`.nvmrc` and package engines). `shared/release.js` owns the app version and build number. Run `npm run check:versions` for each feature/release; use `npm run release:bump -- patch` or `npm run release:set -- VERSION BUILD` to synchronize package/lock, Android and iOS metadata. Keep build numbers increasing. Check the web build, appropriate tests and available native builds. When macOS/Xcode or signing credentials are unavailable, state that limitation and leave the macOS CI result unverified until observed.

The live app uses Vercel and the existing private Neon/PostgreSQL database. Preserve accounts, tyre history and fleet data. A client or native release must not create, reset, replace, migrate or restore production data as a side effect. Use isolated test databases and keep database URLs, records and backups outside Git and release bundles.

Preserve the existing Android package ID and private signing key for phone updates. A GitHub Actions debug APK has an ephemeral signing key and must not be presented as an upgrade for installed copies. Do not commit signing keys or credentials.

iOS source archives and unsigned simulator builds are not installable iPhone IPAs. Building a device IPA requires macOS/Xcode, a valid Apple signing certificate and a matching provisioning profile. Manual signing automation may prepare an IPA with supplied secrets; it must never publish to the App Store or TestFlight automatically. Report the signing method and actual validation performed accurately.

Use `npm run bundle:release` for the versioned web-client and iOS-source archives. Review their manifests/checksums and ensure they exclude environment files, databases, backups, signing files, dependencies, generated build output and old APKs.
