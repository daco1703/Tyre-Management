import React from "react";

export function InvoiceFields({
  t,
  required = true,
  defaultInvoiceNo = "",
  defaultAmount = "",
}) {
  return (
    <fieldset className="invoice-fields">
      <legend>{t("invoiceDetails")}</legend>
      <label className="field">
        <span>{t("invoiceNo")}</span>
        <input
          name="invoiceNo"
          required={required}
          maxLength={100}
          defaultValue={defaultInvoiceNo}
          autoComplete="off"
        />
      </label>
      <label className="field">
        <span>{t("invoiceAmount")}</span>
        <input
          name="amount"
          type="number"
          min="0"
          max="999999999.99"
          step="0.01"
          inputMode="decimal"
          required={required}
          defaultValue={defaultAmount}
        />
      </label>
      <p className="small muted">{t("perTyreInvoiceHint")}</p>
    </fieldset>
  );
}
