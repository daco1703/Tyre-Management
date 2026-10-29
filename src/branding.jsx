import React, { useEffect, useState } from "react";
import { manufacturerFor } from "../shared/catalogue.js";
export function BrandMark({ brand, compact = false }) {
  const make = manufacturerFor(brand);
  const url = make?.logo || "";
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
