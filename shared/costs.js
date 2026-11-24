export const MAX_AMOUNT_PAISE = 99999999999;

// Keep money as integer paise. Do not round an invalid three-decimal invoice.
export function parseInrPaise(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  const input = String(value).trim();
  if (
    !/^(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d{1,2})?$/.test(
      input,
    )
  )
    return null;
  const [whole, fraction = ""] = input.replaceAll(",", "").split(".");
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(paise) && paise >= 0 && paise <= MAX_AMOUNT_PAISE
    ? paise
    : null;
}

export function normalizeInvoice(payload = {}, { required = true } = {}) {
  const hasInvoice =
    payload.invoiceNo !== undefined &&
    payload.invoiceNo !== null &&
    payload.invoiceNo !== "";
  const hasAmount =
    payload.amount !== undefined &&
    payload.amount !== null &&
    payload.amount !== "";
  const hasPaise =
    payload.amountPaise !== undefined && payload.amountPaise !== null;
  if (!hasInvoice && !hasAmount && !hasPaise && !required) return {};
  if (!hasInvoice || (!hasAmount && !hasPaise))
    return { error: "invoiceRequired" };
  if (
    typeof payload.invoiceNo !== "string" ||
    !payload.invoiceNo.trim() ||
    payload.invoiceNo.trim().length > 100
  )
    return { error: "invalidInvoice" };
  const amountPaise = hasAmount
    ? parseInrPaise(payload.amount)
    : payload.amountPaise;
  if (
    !Number.isSafeInteger(amountPaise) ||
    amountPaise < 0 ||
    amountPaise > MAX_AMOUNT_PAISE
  )
    return { error: "invalidAmount" };
  if (hasAmount && hasPaise && payload.amountPaise !== amountPaise)
    return { error: "invalidAmount" };
  return { invoiceNo: payload.invoiceNo.trim(), amountPaise };
}

export function formatInr(amountPaise, language = "en") {
  return new Intl.NumberFormat(language === "hi" ? "hi-IN" : "en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountPaise / 100);
}
