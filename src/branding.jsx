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
