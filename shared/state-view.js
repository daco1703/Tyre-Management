// Financial records remain in the server's full state. Staff receive a separate
// projection; this function must never be used before saving or backing up data.
function financialKey(key) {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return (
    /amount|cost|price|expense|payment|financial|monetary|currency|paise|rupee|revenue|profit/.test(
      normalized,
    ) ||
    /^(?:paid|balance|subtotal|discount|tax|gst|rate|invoicevalue|invoicetotal)$/.test(
      normalized,
    )
  );
}

function withoutFinancialFields(value) {
  if (Array.isArray(value)) return value.map(withoutFinancialFields);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !financialKey(key))
      .map(([key, child]) => [key, withoutFinancialFields(child)]),
  );
}

export function stateForUser(state, user) {
  return user?.role === "owner" ? state : withoutFinancialFields(state);
}
