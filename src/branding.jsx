import React, { useEffect, useState } from "react";
import { manufacturerFor } from "../shared/catalogue.js";
export function BrandMark({ brand, compact = false }) {
  const make = manufacturerFor(brand);
  const url = make
    ? `https://www.google.com/s2/favicons?domain=${make.domain}&sz=128`
    : "";
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return (
    <span
      className={`manufacturer-mark ${compact ? "compact" : ""}`}
      title={brand}
    >
      {url && !failed ? (
        <img
          src={url}
          alt={brand}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="manufacturer-initials" aria-label={brand}>
          {String(brand || "?")
            .slice(0, 2)
            .toUpperCase()}
        </span>
      )}
      {!compact && <span>{brand}</span>}
    </span>
  );
}
export function BrandingPanel({ app }) {
  const { t, branding, saveBranding } = app;
  const [pending, setPending] = useState({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function choose(key, event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 1024 * 1024
    ) {
      setError("invalidBrandImage");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setPending((old) => ({ ...old, [key]: reader.result }));
      setError("");
    };
    reader.onerror = () => setError("invalidBrandImage");
    reader.readAsDataURL(file);
  }
  return (
    <section className="card settings-card">
      <h2>{t("companyBranding")}</h2>
      <p>{t("brandingHelp")}</p>
      {["logo", "banner"].map((key) => (
        <label className="field" key={key}>
          <span>{t(`company_${key}`)}</span>
          {(pending[key] || branding?.[key]) && (
            <img
              className={`branding-preview ${key}`}
              src={pending[key] || branding[key]}
              alt={t(`company_${key}`)}
            />
          )}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => choose(key, event)}
          />
        </label>
      ))}
      {error && (
        <p className="form-error" role="alert">
          {t(error)}
        </p>
      )}
      <button
        className="primary"
        disabled={busy || !Object.keys(pending).length}
        onClick={async () => {
          setBusy(true);
          try {
            await saveBranding(pending);
            setPending({});
          } catch (e) {
            setError(e.code || "serverError");
          } finally {
            setBusy(false);
          }
        }}
      >
        {t(busy ? "saving" : "saveBranding")}
      </button>
    </section>
  );
}
