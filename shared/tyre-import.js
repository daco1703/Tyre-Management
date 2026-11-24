import { constructions } from "./catalogue.js";
import { normalizeInvoice } from "./costs.js";
export const MAX_TYRE_IMPORT_ROWS = 200;
export const TYRE_HEADERS = [
  "Tyre ID",
  "Manufacturer",
  "Condition (New/Used/Remold)",
  "Tyre Type (Radial/Horse)",
  "Previous km",
  "Invoice No",
  "Amount (INR)",
];
const key = (v) =>
  String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]/gu, "");
const blank = (v) =>
  v === undefined || v === null || (typeof v === "string" && !v.trim());
const aliases = {
  serial: [
    "Tyre ID",
    "Tyre Number",
    "Serial",
    "Serial Number",
    "टायर नंबर",
    "टायर आईडी",
  ],
  brand: ["Manufacturer", "Brand", "Tyre Brand", "निर्माता", "ब्रांड"],
  type: ["Condition (New/Used/Remold)", "Condition", "स्थिति"],
  construction: [
    "Tyre Type (Radial/Horse)",
    "Tyre Type",
    "Construction",
    "टायर का प्रकार",
  ],
  distance: ["Previous km", "Previous KM Driven", "Distance", "कुल किमी"],
  invoiceNo: [
    "Invoice No",
    "Invoice Number",
    "Invoice",
    "बिल नंबर",
    "इनवॉइस नंबर",
  ],
  amount: ["Amount (INR)", "Amount", "Cost", "Amount ₹", "राशि", "राशि रुपये"],
};
export const reservedTyreSerials = (existing) =>
  new Set(
    existing.flatMap((tyre) =>
      [tyre.serial, ...(tyre.serialAliases || [])]
        .filter((value) => typeof value === "string")
        .map((value) => value.trim().toUpperCase()),
    ),
  );
export function normalizeTyre(record) {
  const errors = [];
  const serial =
    typeof record.serial === "string" ? record.serial.trim().toUpperCase() : "";
  const brand = typeof record.brand === "string" ? record.brand.trim() : "";
  if (!serial || serial.length > 70) errors.push("importTyreIdInvalid");
  if (!brand || brand.length > 80) errors.push("importTyreBrandInvalid");
  const types = {
    new: "new",
    used: "used",
    remold: "remold",
    remould: "remold",
    retread: "remold",
    नया: "new",
    पुराना: "used",
    रीमोल्ड: "remold",
  };
  const type = blank(record.type)
    ? "new"
    : types[String(record.type).trim().toLowerCase()];
  if (!type) errors.push("invalidType");
  const construction = blank(record.construction)
    ? "radial"
    : String(record.construction).trim().toLowerCase();
  if (!constructions.includes(construction)) errors.push("invalidConstruction");
  let distance = blank(record.distance) ? 0 : record.distance;
  if (typeof distance === "string") {
    const v = distance.trim();
    distance = /^(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})$/.test(v)
      ? Number(v.replaceAll(",", ""))
      : NaN;
  }
  if (
    typeof distance !== "number" ||
    !Number.isSafeInteger(distance) ||
    distance < 0 ||
    distance > 99999999
  )
    errors.push("invalidKm");
  const invoice = normalizeInvoice(record);
  if (invoice.error) errors.push(invoice.error);
  return {
    value: {
      serial,
      brand,
      type,
      construction,
      distance,
      ...(invoice.error
        ? {
            invoiceNo:
              typeof record.invoiceNo === "string"
                ? record.invoiceNo.trim()
                : "",
          }
        : invoice),
    },
    errors,
  };
}
export function previewTyreImport(matrix, existing = []) {
  if (!Array.isArray(matrix)) return { error: "importUnreadable", rows: [] };
  const h = matrix.findIndex(
    (r) => Array.isArray(r) && r.some((v) => !blank(v)),
  );
  if (h < 0) return { error: "importEmpty", rows: [] };
  const header = matrix[h].map(key),
    columns = {};
  for (const [field, names] of Object.entries(aliases)) {
    const matches = header
      .map((v, i) => (names.map(key).includes(v) ? i : -1))
      .filter((i) => i >= 0);
    if (matches.length > 1) return { error: "importDuplicateHeader", rows: [] };
    if (matches.length) columns[field] = matches[0];
  }
  if (columns.serial === undefined || columns.brand === undefined)
    return { error: "importTyreMissingHeader", rows: [] };
  const data = matrix
    .slice(h + 1)
    .map((row, i) => ({ row, number: h + i + 2 }))
    .filter(({ row }) => Array.isArray(row) && row.some((v) => !blank(v)));
  if (!data.length) return { error: "importEmpty", rows: [] };
  if (data.length > MAX_TYRE_IMPORT_ROWS)
    return { error: "importTooMany", rows: [] };
  const seen = reservedTyreSerials(existing);
  return {
    rows: data.map(({ row, number }) => {
      const record = Object.fromEntries(
        Object.entries(columns).map(([f, i]) => [f, row[i]]),
      );
      const { value, errors } = normalizeTyre(record);
      if (!errors.length && seen.has(value.serial))
        errors.push("duplicateTyre");
      if (!errors.length) seen.add(value.serial);
      return { number, value, errors };
    }),
  };
}
export function validateTyreBatch(records, existing = []) {
  if (
    !Array.isArray(records) ||
    !records.length ||
    records.length > MAX_TYRE_IMPORT_ROWS
  )
    return { error: "importInvalidBatch" };
  const seen = reservedTyreSerials(existing),
    tyres = [];
  for (const record of records) {
    if (!record || typeof record !== "object" || Array.isArray(record))
      return { error: "importInvalidBatch" };
    const { value, errors } = normalizeTyre(record);
    if (errors.length) return { error: "importInvalidBatch" };
    if (seen.has(value.serial)) return { error: "duplicateTyre" };
    seen.add(value.serial);
    tyres.push(value);
  }
  return { tyres };
}
