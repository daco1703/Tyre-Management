import { isDay } from "./dates.js";

export const driverLicenseKey = (value) =>
  typeof value === "string"
    ? value.toUpperCase().replace(/[^A-Z0-9]/g, "")
    : "";

const todayInIndia = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

// Profile edits merge only these fields; identity, timestamps and assignment
// history are managed by the model rather than accepted from form payloads.
export function normalizeDriver(
  input,
  { previous = {}, today = todayInIndia() } = {},
) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return { error: "invalidDriverData" };
  const read = (key) =>
    Object.hasOwn(input, key) ? input[key] : previous[key];
  const rawName = read("name");
  if (
    typeof rawName !== "string" ||
    !rawName.trim() ||
    rawName.trim().length > 100
  )
    return { error: "driverNameRequired" };
  const name = rawName.trim().replace(/\s+/g, " ");
  const dob = read("dob");
  if (!isDay(dob) || dob < "1900-01-01" || !isDay(today) || dob > today)
    return { error: "invalidDriverDob" };
  const rawLicense = read("licenseNo");
  if (rawLicense === undefined || rawLicense === null || rawLicense === "")
    return { error: "licenseRequired" };
  if (typeof rawLicense !== "string") return { error: "invalidLicenseNo" };
  const licenseNo = rawLicense.trim().toUpperCase().replace(/\s+/g, " ");
  if (
    !/^[A-Z0-9][A-Z0-9 ./-]{2,49}$/.test(licenseNo) ||
    driverLicenseKey(licenseNo).length < 3
  )
    return { error: "invalidLicenseNo" };
  const licenseExpiry = read("licenseExpiry");
  // Past expiry is a valid record: it must show an expired-license reminder.
  if (!isDay(licenseExpiry) || licenseExpiry < dob)
    return { error: "invalidLicenseExpiry" };
  const selectedActive = read("active");
  const active = selectedActive === undefined ? true : selectedActive;
  if (typeof active !== "boolean") return { error: "invalidDriverActive" };
  return { value: { name, dob, licenseNo, licenseExpiry, active } };
}

export const activeDrivers = (state) =>
  (Array.isArray(state?.drivers) ? state.drivers : []).filter(
    (driver) => driver.active !== false,
  );

export function driverForVehicle(vehicle, state) {
  return (
    (Array.isArray(state?.drivers) ? state.drivers : []).find(
      (driver) => driver.id === vehicle?.driverId,
    ) || null
  );
}
