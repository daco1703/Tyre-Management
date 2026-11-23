import { readFileSync, writeFileSync } from "node:fs";

// Capacitor 7 emits a Swift 5.9 manifest with .v18 when the app targets iOS 18.
// That enum requires PackageDescription 6.0. The string API supports the same
// deployment target with Swift 5.9 and survives future iOS version changes.
if (process.env.CAPACITOR_PLATFORM_NAME &&
    process.env.CAPACITOR_PLATFORM_NAME !== "ios") process.exit(0);

const root = new URL("../", import.meta.url);
const project = readFileSync(new URL("ios/App/App.xcodeproj/project.pbxproj", root), "utf8");
const versions = [...new Set([...project.matchAll(/\bIPHONEOS_DEPLOYMENT_TARGET\s*=\s*([\d.]+);/g)].map(match => match[1]))];
if (versions.length !== 1 || !/^\d+\.\d+(?:\.\d+)?$/.test(versions[0]))
  throw new Error("Review differing or missing iOS deployment targets before synchronizing Swift packages.");

const manifest = new URL("ios/App/CapApp-SPM/Package.swift", root);
const original = readFileSync(manifest, "utf8");
const pattern = /(platforms:\s*\[)\.iOS\((?:\.v[\d_]+|"[\d.]+")\)(\])/g;
if ([...original.matchAll(pattern)].length !== 1)
  throw new Error("Unexpected Capacitor Swift manifest; refusing to change package dependencies.");
const updated = original.replace(pattern, `$1.iOS("${versions[0]}")$2`);
if (updated !== original) {
  writeFileSync(manifest, updated);
  console.log(`Swift package deployment target normalized to iOS ${versions[0]}.`);
}
