import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeInvoice,
  parseInrPaise,
  MAX_AMOUNT_PAISE,
} from "../shared/costs.js";
import {
  previewTyreImport,
  validateTyreBatch,
  TYRE_HEADERS,
} from "../shared/tyre-import.js";

test("invoice money keeps exact integer paise and validates Indian/Western grouping", () => {
  for (const [value, expected] of [
    ["0", 0],
    ["0.01", 1],
    ["12.30", 1230],
    [1234.56, 123456],
    ["1,23,456.78", 12345678],
    ["123,456.78", 12345678],
    ["999999999.99", MAX_AMOUNT_PAISE],
  ])
    assert.equal(parseInrPaise(value), expected, String(value));
  for (const value of [
    "",
    " ",
    null,
    undefined,
    false,
    {},
    -1,
    Infinity,
    NaN,
    "1.001",
    "1e3",
    "1,2,3",
    "₹50",
    "1,23.00",
    "1000000000.00",
  ])
    assert.equal(parseInrPaise(value), null, String(value));
});

test("both invoice fields are required, explicit zero is valid, and conflicting representations are rejected", () => {
  assert.deepEqual(normalizeInvoice({}), { error: "invoiceRequired" });
  assert.deepEqual(normalizeInvoice({ invoiceNo: "A" }), {
    error: "invoiceRequired",
  });
  assert.deepEqual(normalizeInvoice({ invoiceNo: " 000012 ", amount: "0" }), {
    invoiceNo: "000012",
    amountPaise: 0,
  });
  assert.deepEqual(normalizeInvoice({ invoiceNo: "A", amountPaise: 12345 }), {
    invoiceNo: "A",
    amountPaise: 12345,
  });
  assert.deepEqual(
    normalizeInvoice({ invoiceNo: "A", amount: "12.34", amountPaise: 100 }),
    { error: "invalidAmount" },
  );
  assert.deepEqual(normalizeInvoice({ invoiceNo: 123, amount: "1" }), {
    error: "invalidInvoice",
  });
  assert.deepEqual(
    normalizeInvoice({ invoiceNo: "A".repeat(101), amount: "1" }),
    { error: "invalidInvoice" },
  );
  assert.deepEqual(normalizeInvoice({ invoiceNo: "A", amountPaise: 1.5 }), {
    error: "invalidAmount",
  });
  assert.deepEqual(normalizeInvoice({}, { required: false }), {});
});

test("invoice-aware Excel preview retains zeros, supports Hindi columns, and blocks retired serial reuse", () => {
  const existing = [{ serial: "RENAMED", serialAliases: ["OLD-001"] }];
  const result = previewTyreImport(
    [
      ["टायर नंबर", "निर्माता", "बिल नंबर", "राशि"],
      ["00001", "MRF", "000001", "1,250.50"],
      ["OLD-001", "MRF", "A2", 500],
      ["NEW-003", "CEAT", "", 500],
      ["NEW-004", "Apollo", "A4", "1.001"],
    ],
    existing,
  );
  assert.equal(result.rows[0].value.serial, "00001");
  assert.deepEqual(result.rows[0].errors, []);
  assert.equal(result.rows[0].value.invoiceNo, "000001");
  assert.equal(result.rows[0].value.amountPaise, 125050);
  assert.deepEqual(result.rows[1].errors, ["duplicateTyre"]);
  assert.deepEqual(result.rows[2].errors, ["invoiceRequired"]);
  assert.deepEqual(result.rows[3].errors, ["invalidAmount"]);
  assert.equal(
    validateTyreBatch(
      result.rows.slice(0, 1).map((row) => row.value),
      existing,
    ).tyres.length,
    1,
  );
  assert.equal(
    validateTyreBatch(
      result.rows.map((row) => row.value),
      existing,
    ).error,
    "duplicateTyre",
  );
  assert.equal(TYRE_HEADERS.length, 7);
});

test("old stock remains unchanged while new import rows without invoices are skipped", () => {
  const existing = [{ id: "existing", serial: "HISTORICAL", brand: "MRF" }];
  const before = structuredClone(existing);
  const result = previewTyreImport(
    [
      ["Tyre ID", "Manufacturer"],
      ["NEW", "MRF"],
    ],
    existing,
  );
  assert.deepEqual(result.rows[0].errors, ["invoiceRequired"]);
  assert.deepEqual(existing, before);
});
