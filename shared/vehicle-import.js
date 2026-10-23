import { vehicleClasses } from "./catalogue.js";
export const MAX_IMPORT_ROWS = 200;
export const VEHICLE_HEADERS = [
  "Vehicle Registration",
  "Vehicle Name / Driver",
  "Odometer (km)",
  "Has Spare",
  "Vehicle Type (BS3/BS4/BS6)",
  "Driver Name",
];
const headerKey = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]/gu, "");
const aliases = {
  registration: [
    "Vehicle Registration",
    "Registration",
    "Registration Number",
    "Vehicle Number",
    "Vehicle No",
    "Vehicle Reg No",
    "Vehicle Registration Number",
    "Number Plate",
    "वाहन नंबर",
    "वाहन संख्या",
    "पंजीकरण नंबर",
  ],
  name: [
    "Vehicle Name / Driver",
    "Vehicle Name",
    "Driver",
    "Name",
    "वाहन का नाम",
    "ड्राइवर",
    "वाहन का नाम / ड्राइवर",
  ],
  emissionClass: [
    "Vehicle Type (BS3/BS4/BS6)",
    "Vehicle Type",
    "Emission Class",
    "BS",
    "BS Class",
    "वाहन का प्रकार",
  ],
  driverName: ["Driver Name", "Current Driver", "ड्राइवर का नाम"],
  odometer: [
    "Odometer (km)",
    "Odometer",
    "Odometer Reading",
    "Current KM",
    "KM",
    "ओडोमीटर (किमी)",
    "ओडोमीटर",
  ],
  hasSpare: [
    "Has Spare",
    "Spare",
    "Spare Tyre",
    "Has Spare Tyre",
    "स्पेयर",
    "स्पेयर है",
  ],
};
const blank = (value) =>
  value === null ||
  value === undefined ||
  (typeof value === "string" && !value.trim());
const registrationKey = (value) => value.toUpperCase().replace(/[\s-]+/g, "");
export function normalizeVehicle(record) {
  const errors = [];
  const registration =
    typeof record.registration === "string"
      ? record.registration.trim().toUpperCase().replace(/\s+/g, "")
      : "";
  if (
    !registration ||
    registration.length > 30 ||
    !/^[A-Z0-9-]+$/.test(registration) ||
    !/[A-Z0-9]/.test(registration)
  )
    errors.push("importRegistrationInvalid");
  let name = "";
  if (!blank(record.name)) {
    if (typeof record.name !== "string" || record.name.trim().length > 100)
      errors.push("importNameInvalid");
    else name = record.name.trim();
  }
  let odometer = record.odometer;
  if (blank(odometer)) odometer = 0;
  else if (typeof odometer === "string") {
    const value = odometer.trim();
    const plain = /^\d+$/.test(value);
    const grouped = /^(?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})$/.test(
      value,
    );
    odometer = plain || grouped ? Number(value.replaceAll(",", "")) : NaN;
  }
  if (
    typeof odometer !== "number" ||
    !Number.isSafeInteger(odometer) ||
    odometer < 0 ||
    odometer > 99999999
  )
    errors.push("invalidKm");
  let hasSpare = record.hasSpare;
  if (blank(hasSpare)) hasSpare = false;
  else if (typeof hasSpare !== "boolean") {
    const value =
      typeof hasSpare === "number" || typeof hasSpare === "string"
        ? String(hasSpare).trim().toLowerCase()
        : "";
    if (["yes", "y", "true", "1", "हाँ", "हां", "हा"].includes(value))
      hasSpare = true;
    else if (["no", "n", "false", "0", "नहीं", "नही"].includes(value))
      hasSpare = false;
    else errors.push("importSpareInvalid");
  }
  const emissionClass = blank(record.emissionClass)
    ? null
    : String(record.emissionClass).replace(/\s+/g, "").toUpperCase();
  if (emissionClass && !vehicleClasses.includes(emissionClass))
    errors.push("invalidVehicleClass");
  const driverName = blank(record.driverName)
    ? ""
    : typeof record.driverName === "string"
      ? record.driverName.trim()
      : null;
  if (driverName === null || driverName.length > 100)
    errors.push("importNameInvalid");
  const value = { registration, name, odometer, hasSpare };
  // Preserve compatibility with older four-column imports; new columns are optional.
  if (!blank(record.emissionClass)) value.emissionClass = emissionClass;
  if (!blank(record.driverName)) value.driverName = driverName;
  return { value, errors };
}
export function previewVehicleImport(matrix, existing = []) {
  if (!Array.isArray(matrix)) return { error: "importUnreadable", rows: [] };
  const headerIndex = matrix.findIndex(
    (row) => Array.isArray(row) && row.some((value) => !blank(value)),
  );
  if (headerIndex < 0) return { error: "importEmpty", rows: [] };
  const header = matrix[headerIndex].map(headerKey);
  const columns = {};
  for (const [field, names] of Object.entries(aliases)) {
    const keys = names.map(headerKey);
    const matches = header
      .map((key, index) => (keys.includes(key) ? index : -1))
      .filter((index) => index >= 0);
    if (matches.length > 1) return { error: "importDuplicateHeader", rows: [] };
    if (matches.length) columns[field] = matches[0];
  }
  if (columns.registration === undefined)
    return { error: "importMissingHeader", rows: [] };
  const data = matrix
    .slice(headerIndex + 1)
    .map((row, index) => ({ row, number: headerIndex + index + 2 }))
    .filter(
      ({ row }) => Array.isArray(row) && row.some((value) => !blank(value)),
    );
  if (!data.length) return { error: "importEmpty", rows: [] };
  if (data.length > MAX_IMPORT_ROWS)
    return { error: "importTooMany", rows: [] };
  const seen = new Set(existing.map((v) => registrationKey(v.registration)));
  const rows = data.map(({ row, number }) => {
    const record = Object.fromEntries(
      Object.entries(columns).map(([field, index]) => [field, row[index]]),
    );
    const { value, errors } = normalizeVehicle(record);
    if (!errors.length && seen.has(registrationKey(value.registration)))
      errors.push("duplicateVehicle");
    if (!errors.length) seen.add(registrationKey(value.registration));
    return {
      number,
      value,
      errors,
      displayRegistration:
        value.registration || String(record.registration ?? ""),
    };
  });
  return { rows };
}
export function validateVehicleBatch(records, existing = []) {
  if (
    !Array.isArray(records) ||
    records.length === 0 ||
    records.length > MAX_IMPORT_ROWS
  )
    return { error: "importInvalidBatch" };
  const seen = new Set(existing.map((v) => registrationKey(v.registration)));
  const vehicles = [];
  for (const record of records) {
    if (!record || typeof record !== "object" || Array.isArray(record))
      return { error: "importInvalidBatch" };
    const { value, errors } = normalizeVehicle(record);
    if (errors.length) return { error: "importInvalidBatch" };
    if (seen.has(registrationKey(value.registration)))
      return { error: "duplicateVehicle" };
    seen.add(registrationKey(value.registration));
    vehicles.push(value);
  }
  return { vehicles };
}
