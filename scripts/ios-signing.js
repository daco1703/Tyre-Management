import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { appVersion, buildNumber } from "../shared/release.js";
import { configureAppSigning } from "./ios-project-signing.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const required = [
  "IOS_P12_BASE64",
  "IOS_P12_PASSWORD",
  "IOS_PROVISION_PROFILE_BASE64",
  "IOS_TEAM_ID",
  "IOS_SIGNING_IDENTITY",
];
const missing = required.filter((name) => !process.env[name]);
if (process.platform !== "darwin" || missing.length) {
  console.error(
    process.platform !== "darwin"
      ? "Signed iOS builds require macOS and Xcode."
      : `Missing signing secrets: ${missing.join(", ")}`,
  );
  process.exit(1);
}
const method = process.env.IOS_EXPORT_METHOD || "release-testing";
const configuration = method === "debugging" ? "Debug" : "Release";
const pushEnvironment = method === "debugging" ? "development" : "production";
if (
  !["release-testing", "debugging"].includes(method) ||
  !/^[A-Z0-9]{10}$/.test(process.env.IOS_TEAM_ID)
) {
  console.error("Use release-testing or debugging and a valid Apple team ID.");
  process.exit(1);
}
const run = (program, args, capture = false) => {
  const result = spawnSync(program, args, {
    cwd: root,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${path.basename(program)} failed. Check the build log; signing credentials were not printed by this script.`,
    );
  return result.stdout?.trim();
};
const xml = (value) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const temp = mkdtempSync(
  path.join(process.env.RUNNER_TEMP || tmpdir(), "shepards-ios-signing-"),
);
const keychain = path.join(temp, "signing.keychain-db"),
  keychainPassword = randomBytes(32).toString("hex");
let profileInstalled = "",
  previousKeychains = [],
  keychainCreated = false;
const projectPath = path.join(root, "ios/App/App.xcodeproj/project.pbxproj");
let originalProject;
try {
  previousKeychains = [
    ...run("security", ["list-keychains", "-d", "user"], true).matchAll(
      /"([^"]+)"/g,
    ),
  ].map((match) => match[1]);
  const certificate = path.join(temp, "certificate.p12"),
    profile = path.join(temp, "profile.mobileprovision");
  writeFileSync(
    certificate,
    Buffer.from(process.env.IOS_P12_BASE64, "base64"),
    { mode: 0o600 },
  );
  writeFileSync(
    profile,
    Buffer.from(process.env.IOS_PROVISION_PROFILE_BASE64, "base64"),
    { mode: 0o600 },
  );
  run("security", ["create-keychain", "-p", keychainPassword, keychain], true);
  keychainCreated = true;
  run("security", ["set-keychain-settings", "-lut", "21600", keychain], true);
  run("security", ["unlock-keychain", "-p", keychainPassword, keychain], true);
  run(
    "security",
    [
      "import",
      certificate,
      "-P",
      process.env.IOS_P12_PASSWORD,
      "-T",
      "/usr/bin/codesign",
      "-T",
      "/usr/bin/security",
      "-t",
      "cert",
      "-f",
      "pkcs12",
      "-k",
      keychain,
    ],
    true,
  );
  run(
    "security",
    [
      "set-key-partition-list",
      "-S",
      "apple-tool:,apple:,codesign:",
      "-s",
      "-k",
      keychainPassword,
      keychain,
    ],
    true,
  );
  run(
    "security",
    ["list-keychains", "-d", "user", "-s", keychain, ...previousKeychains],
    true,
  );
  const plist = path.join(temp, "profile.plist");
  writeFileSync(plist, run("security", ["cms", "-D", "-i", profile], true), {
    mode: 0o600,
  });
  const uuid = run(
    "/usr/libexec/PlistBuddy",
    ["-c", "Print :UUID", plist],
    true,
  );
  const profileTeam = run(
    "/usr/libexec/PlistBuddy",
    ["-c", "Print :TeamIdentifier:0", plist],
    true,
  );
  const identifier = run(
    "/usr/libexec/PlistBuddy",
    ["-c", "Print :Entitlements:application-identifier", plist],
    true,
  );
  if (
    !/^[A-Fa-f0-9-]+$/.test(uuid) ||
    profileTeam !== process.env.IOS_TEAM_ID ||
    identifier !== `${profileTeam}.in.tyresaathi.logbook`
  )
    throw new Error(
      "The provisioning profile must match the Apple team and in.tyresaathi.logbook bundle ID.",
    );
  const profilePushEnvironment = run(
    "/usr/libexec/PlistBuddy",
    ["-c", "Print :Entitlements:aps-environment", plist],
    true,
  );
  if (profilePushEnvironment !== pushEnvironment)
    throw new Error(
      `The provisioning profile must enable Push Notifications with the ${pushEnvironment} APNs environment for ${method}.`,
    );
  const profileDirectory = path.join(
    homedir(),
    "Library/Developer/Xcode/UserData/Provisioning Profiles",
  );
  mkdirSync(profileDirectory, { recursive: true });
  const destination = path.join(profileDirectory, `${uuid}.mobileprovision`);
  if (existsSync(destination))
    throw new Error(
      "A profile with this UUID is already installed; use a clean signing runner.",
    );
  writeFileSync(
    destination,
    Buffer.from(process.env.IOS_PROVISION_PROFILE_BASE64, "base64"),
    { mode: 0o600 },
  );
  profileInstalled = destination;
  originalProject = readFileSync(projectPath);
  writeFileSync(
    projectPath,
    configureAppSigning(originalProject.toString("utf8"), {
      teamId: profileTeam,
      identity: process.env.IOS_SIGNING_IDENTITY,
      profileUuid: uuid,
    }),
  );
  const output = path.join(root, "artifacts/ios-device"),
    archive = path.join(output, "Shepards.xcarchive");
  mkdirSync(output, { recursive: true });
  const options = path.join(temp, "ExportOptions.plist");
  writeFileSync(
    options,
    `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>method</key><string>${method}</string><key>destination</key><string>export</string><key>signingStyle</key><string>manual</string><key>teamID</key><string>${xml(profileTeam)}</string><key>signingCertificate</key><string>${xml(process.env.IOS_SIGNING_IDENTITY)}</string><key>provisioningProfiles</key><dict><key>in.tyresaathi.logbook</key><string>${xml(uuid)}</string></dict></dict></plist>`,
    { mode: 0o600 },
  );
  run("xcodebuild", [
    "-resolvePackageDependencies",
    "-project",
    "ios/App/App.xcodeproj",
    "-scheme",
    "App",
  ]);
  run("xcodebuild", [
    "-project",
    "ios/App/App.xcodeproj",
    "-scheme",
    "App",
    "-configuration",
    configuration,
    "-destination",
    "generic/platform=iOS",
    "-archivePath",
    archive,
    "archive",
  ]);
  run("xcodebuild", [
    "-exportArchive",
    "-archivePath",
    archive,
    "-exportOptionsPlist",
    options,
    "-exportPath",
    path.join(output, "export"),
  ]);
  console.log(
    `Signed device IPA ${appVersion} (${buildNumber}) exported locally. Nothing was sent to App Store Connect or TestFlight.`,
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (originalProject) writeFileSync(projectPath, originalProject);
  if (profileInstalled) rmSync(profileInstalled, { force: true });
  if (keychainCreated) {
    try {
      run(
        "security",
        ["list-keychains", "-d", "user", "-s", ...previousKeychains],
        true,
      );
    } catch {}
    try {
      run("security", ["delete-keychain", keychain], true);
    } catch {}
  }
  rmSync(temp, { recursive: true, force: true });
}
