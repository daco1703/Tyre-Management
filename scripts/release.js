import { readFileSync, writeFileSync } from "node:fs";
import { appVersion, buildNumber } from "../shared/release.js";

const root = new URL("../", import.meta.url);
const paths = {
  metadata: "shared/release.js",
  package: "package.json",
  lock: "package-lock.json",
  android: "android/app/build.gradle",
  ios: "ios/App/App.xcodeproj/project.pbxproj",
};
const read = (path) => readFileSync(new URL(path, root), "utf8");
const write = (path, value) => writeFileSync(new URL(path, root), value);
function validate(version, build) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    throw new Error("Use a numeric MAJOR.MINOR.PATCH release version.");
  if (!version.split(".").every((part) => Number.isSafeInteger(Number(part))))
    throw new Error("Release version components must be safe integers.");
  if (!Number.isSafeInteger(build) || build < 1 || build > 2100000000)
    throw new Error(
      "The build number must be an integer from 1 to 2100000000.",
    );
}
function captures(text, pattern, label) {
  const values = [...text.matchAll(pattern)].map((match) =>
    match[1].trim().replace(/^"|"$/g, ""),
  );
  if (!values.length) throw new Error(`No ${label} found in native project.`);
  return values;
}
function check(version = appVersion, build = buildNumber) {
  validate(version, build);
  const pkg = JSON.parse(read(paths.package)),
    lock = JSON.parse(read(paths.lock));
  const observed = [
    ["package.json", pkg.version, version],
    ["package-lock.json", lock.version, version],
    ["package-lock.json root package", lock.packages?.[""]?.version, version],
    ["package.json Node", pkg.engines?.node, "24.x"],
    ["package-lock.json Node", lock.packages?.[""]?.engines?.node, "24.x"],
    [".nvmrc", read(".nvmrc").trim(), "24"],
    ...captures(
      read(paths.android),
      /\bversionName\s+"([^"]+)"/g,
      "Android versionName",
    ).map((value) => ["Android versionName", value, version]),
    ...captures(
      read(paths.android),
      /\bversionCode\s+(\d+)/g,
      "Android versionCode",
    ).map((value) => ["Android versionCode", Number(value), build]),
    ...captures(
      read(paths.ios),
      /\bMARKETING_VERSION\s*=\s*([^;]+);/g,
      "iOS MARKETING_VERSION",
    ).map((value) => ["iOS MARKETING_VERSION", value.trim(), version]),
    ...captures(
      read(paths.ios),
      /\bCURRENT_PROJECT_VERSION\s*=\s*([^;]+);/g,
      "iOS CURRENT_PROJECT_VERSION",
    ).map((value) => [
      "iOS CURRENT_PROJECT_VERSION",
      Number(value.trim()),
      build,
    ]),
  ];
  const mismatches = observed.filter(
    ([, actual, expected]) => actual !== expected,
  );
  if (mismatches.length)
    throw new Error(
      mismatches
        .map(
          ([label, actual, expected]) =>
            `${label}: ${actual} (expected ${expected})`,
        )
        .join("\n") + "\nRun npm run release:sync to align metadata.",
    );
  if (Number(process.versions.node.split(".")[0]) !== 24)
    throw new Error("Use Node 24 for release checks and builds.");
  console.log(
    `Release versions match: website/Android/iOS ${version}, build ${build}, Node 24.`,
  );
}
function sync(version, build) {
  validate(version, build);
  // Read and validate every required file before writing any release metadata.
  const pkg = JSON.parse(read(paths.package)),
    lock = JSON.parse(read(paths.lock));
  let android = read(paths.android),
    ios = read(paths.ios);
  captures(android, /\bversionName\s+"([^"]+)"/g, "Android versionName");
  captures(android, /\bversionCode\s+(\d+)/g, "Android versionCode");
  captures(ios, /\bMARKETING_VERSION\s*=\s*([^;]+);/g, "iOS MARKETING_VERSION");
  captures(
    ios,
    /\bCURRENT_PROJECT_VERSION\s*=\s*([^;]+);/g,
    "iOS CURRENT_PROJECT_VERSION",
  );
  if (!lock.packages?.[""])
    throw new Error("package-lock.json has no root package.");
  pkg.version = lock.version = lock.packages[""].version = version;
  android = android
    .replace(/\bversionName\s+"[^"]+"/g, `versionName "${version}"`)
    .replace(/\bversionCode\s+\d+/g, `versionCode ${build}`);
  ios = ios
    .replace(
      /\bMARKETING_VERSION\s*=\s*[^;]+;/g,
      `MARKETING_VERSION = ${version};`,
    )
    .replace(
      /\bCURRENT_PROJECT_VERSION\s*=\s*[^;]+;/g,
      `CURRENT_PROJECT_VERSION = ${build};`,
    );
  write(
    paths.metadata,
    `// Shared release metadata for the website and both native applications.\n// Update with \`npm run release:bump\` or \`npm run release:set -- VERSION BUILD\`.\nexport const appVersion = "${version}";\nexport const buildNumber = ${build};\n`,
  );
  write(paths.package, JSON.stringify(pkg, null, 2) + "\n");
  write(paths.lock, JSON.stringify(lock, null, 2) + "\n");
  write(paths.android, android);
  write(paths.ios, ios);
  check(version, build);
}
try {
  const [command = "check", value, number] = process.argv.slice(2);
  if (command === "check") check();
  else if (command === "sync") sync(appVersion, buildNumber);
  else if (command === "set") {
    if (
      Number(number) < buildNumber ||
      (value !== appVersion && Number(number) === buildNumber)
    )
      throw new Error("A new release must increase the native build number.");
    sync(value || "", Number(number));
  } else if (command === "bump") {
    const part = value || "patch",
      index = { major: 0, minor: 1, patch: 2 }[part];
    if (index === undefined)
      throw new Error("Use release:bump -- major, minor or patch.");
    const next = appVersion.split(".").map(Number);
    next[index]++;
    for (let i = index + 1; i < next.length; i++) next[i] = 0;
    sync(next.join("."), buildNumber + 1);
  } else
    throw new Error(
      "Commands: check | sync | set VERSION BUILD | bump [patch|minor|major]",
    );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
