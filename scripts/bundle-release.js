import {
  readFileSync,
  writeFileSync,
  readdirSync,
  lstatSync,
  mkdirSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { appVersion, buildNumber } from "../shared/release.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output-directory");
const outputDirectory =
  outputIndex < 0
    ? path.join(root, "downloads")
    : path.resolve(args[outputIndex + 1] || "");
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const rootFiles = new Set([
  ".gitignore",
  ".gitattributes",
  ".dockerignore",
  ".nvmrc",
  "AGENTS.md",
  "README.md",
  "package.json",
  "package-lock.json",
  "capacitor.config.json",
  "index.html",
  "vite.config.js",
  "vercel.json",
  "Dockerfile",
  "compose.yaml",
  "Caddyfile",
]);
const sourceDirectories = new Set([
  "src",
  "shared",
  "public",
  "server",
  "api",
  "tests",
  "scripts",
  "docs",
  "android",
  "ios",
  ".github",
]);
const forbiddenParts = new Set([
  ".git",
  "node_modules",
  "artifacts",
  "downloads",
  "data",
  "backups",
  "build",
  "dist",
  ".gradle",
  ".vercel",
  "Pods",
  "DerivedData",
  "xcuserdata",
]);
function safeSource(name) {
  const parts = name.split("/"),
    basename = parts.at(-1);
  return (
    (rootFiles.has(name) || sourceDirectories.has(parts[0])) &&
    !parts.some(
      (part) => forbiddenParts.has(part) || part.startsWith(".env"),
    ) &&
    !/\.(?:sqlite3?(?:-[a-z]+)?|db(?:-[a-z]+)?|pem|p8|p12|pfx|key|jks|keystore|keychain(?:-db)?|mobileprovision|provisionprofile|cer|cert|crt|xcuserstate|apk|ipa|log)$/i.test(
      basename,
    ) &&
    !["local.properties", "google-services.json", ".DS_Store"].includes(
      basename,
    )
  );
}
function file(name) {
  const target = path.join(root, name);
  if (lstatSync(target).isSymbolicLink())
    throw new Error(`Refusing to bundle symlink: ${name}`);
  return {
    name,
    data: readFileSync(target),
    mode: name === "android/gradlew" ? 0o100755 : 0o100644,
  };
}
function filesBelow(relative) {
  const result = [];
  for (const entry of readdirSync(path.join(root, relative), {
    withFileTypes: true,
  })) {
    const name = `${relative}/${entry.name}`;
    if (entry.isSymbolicLink())
      throw new Error(`Refusing to bundle symlink: ${name}`);
    if (entry.isDirectory()) result.push(...filesBelow(name));
    else if (entry.isFile()) result.push(file(name));
  }
  return result;
}
function textFile(name, text) {
  return { name, data: Buffer.from(text), mode: 0o100644 };
}
function archive(filename, entries, kind, instructions) {
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const manifest = {
    appVersion,
    buildNumber,
    kind,
    signed: false,
    files: entries.map(({ name, data }) => ({
      path: name,
      bytes: data.length,
      sha256: sha256(data),
    })),
  };
  entries.push(
    textFile("BUNDLE-README.md", instructions),
    textFile("BUNDLE-MANIFEST.json", JSON.stringify(manifest, null, 2) + "\n"),
  );
  entries.push(
    textFile(
      "SHA256SUMS.txt",
      entries
        .map(({ name, data }) => `${sha256(data)}  ${name}`)
        .sort()
        .join("\n") + "\n",
    ),
  );
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const records = [],
    directory = [];
  let offset = 0;
  for (const { name, data, mode } of entries) {
    if (name.startsWith("/") || name.split("/").includes(".."))
      throw new Error("Unsafe archive path");
    // Stored ZIP entries avoid compression-library differences across platforms.
    const encoded = Buffer.from(name),
      compressed = data,
      crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(33, 12); // Fixed 1980-01-01, 00:00:00: reproducible ZIP metadata.
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(encoded.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(0x314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(33, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(encoded.length, 28);
    central.writeUInt32LE((mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    records.push(local, encoded, compressed);
    directory.push(central, encoded);
    offset += local.length + encoded.length + compressed.length;
    if (offset > 0xffffffff)
      throw new Error("Release archive exceeds ZIP32 limits.");
  }
  const central = Buffer.concat(directory),
    end = Buffer.alloc(22);
  if (entries.length > 65535)
    throw new Error("Release archive has too many entries.");
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  const zip = Buffer.concat([...records, central, end]);
  writeFileSync(path.join(outputDirectory, filename), zip);
  return `${sha256(zip)}  ${filename}`;
}

try {
  if (outputIndex >= 0 && !args[outputIndex + 1])
    throw new Error("--output-directory requires a directory path.");
  execFileSync(
    process.execPath,
    [path.join(root, "scripts/release.js"), "check"],
    { stdio: "inherit" },
  );
  mkdirSync(outputDirectory, { recursive: true });
  const webFiles = filesBelow("dist");
  if (!webFiles.some((entry) => entry.name === "dist/index.html"))
    throw new Error("Build the web client first.");
  const tracked = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: root },
  )
    .toString()
    .split("\0")
    .filter(Boolean);
  const sourceFiles = [...new Set(tracked)].filter(safeSource).sort().map(file);
  for (const required of [
    "package.json",
    "package-lock.json",
    "src/main.jsx",
    "shared/release.js",
    "ios/App/App.xcodeproj/project.pbxproj",
    "ios/App/CapApp-SPM/Package.swift",
    "docs/RELEASING.md",
  ])
    if (!sourceFiles.some((entry) => entry.name === required))
      throw new Error(`Missing required source: ${required}`);
  const webName = `Shepards-Tyre-Management-${appVersion}-web-client.zip`,
    iosName = `Shepards-Tyre-Management-${appVersion}-ios-project-source.zip`;
  const webInstructions = `# Shepards Tyre Management ${appVersion} — web client\n\nThe dist folder contains the compiled shared React client. This archive does not contain a database or a working API server. Serve it with this app's Vercel API connected to the existing private Neon database; a static host alone cannot sign users in or save records. The full source and deployment instructions are in the matching ios-project-source ZIP. Do not replace or reset the live database when updating the client.\n\nBuild ${buildNumber}. This is not an APK, IPA or offline app. See BUNDLE-MANIFEST.json and SHA256SUMS.txt for file verification.\n`;
  const sourceInstructions = `# Shepards Tyre Management ${appVersion} — iOS project and shared source\n\nThis archive contains the shared website/API/Android/iOS source needed to rebuild the app. It excludes dependencies, compiled builds, database records, environment variables and signing credentials.\n\nUse Node 24: npm ci; npm run check:versions; npm run ios:sync. On a Mac with Xcode, open ios/App/App.xcodeproj and select the App scheme. Swift Package Manager resolves native dependencies. See docs/RELEASING.md for unsigned simulator validation and optional signed-device IPA instructions. A source ZIP or simulator .app is not installable on an iPhone. A device IPA needs Apple signing and an appropriate provisioning profile; no IPA is supplied or implied by this source archive.\n\nUse the existing Vercel API and private Neon database. Never include database URLs, certificates, profiles or live records in a release archive.\n\nBuild ${buildNumber}. See BUNDLE-MANIFEST.json and SHA256SUMS.txt for file verification.\n`;
  const checksums = [
    archive(webName, webFiles, "compiled-web-client", webInstructions),
    archive(
      iosName,
      sourceFiles,
      "ios-project-and-shared-source",
      sourceInstructions,
    ),
  ];
  writeFileSync(
    path.join(
      outputDirectory,
      `Shepards-Tyre-Management-${appVersion}-bundles-SHA256SUMS.txt`,
    ),
    checksums.join("\n") + "\n",
  );
  console.log(checksums.join("\n"));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
