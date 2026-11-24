import React, { useEffect, useId, useRef, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { presetRange } from "../shared/reports.js";
import { dayKey } from "../shared/model.js";
import { isDay, displayDate } from "../shared/dates.js";
import { manufacturers } from "../shared/catalogue.js";
import { formatInr } from "../shared/costs.js";
import { BrandMark } from "./branding.jsx";
import { DateField } from "./date-field.jsx";

function periodLabel(period, language) {
  if (period.length === 10) return displayDate(period);
  return new Intl.DateTimeFormat(language === "hi" ? "hi-IN" : "en-IN", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  }).format(new Date(`${period}-01T12:00:00Z`));
}

function SpendingChart({ series, app }) {
  const { t, lang } = app;
  const id = useId();
  const [tableOpen, setTableOpen] = useState(false);
  const chartRef = useRef(null);
  const [availableWidth, setAvailableWidth] = useState(280);
  const visible = series.slice(-60);
  const width = Math.max(
    availableWidth,
    visible.length * (visible[0]?.period.length === 10 ? 82 : 64) + 106,
  );
  const height = 280;
  const left = 86;
  const bottom = 225;
  const plotHeight = 190;
  const slot = (width - left - 20) / Math.max(visible.length, 1);
  const barWidth = Math.min(40, slot * 0.6);
  const max = Math.max(...visible.map((row) => row.totalPaise), 1);
  const step = Math.max(1, Math.ceil(max / 4));
  const ceiling = step * 4;
  const scale = (amount) => (amount / ceiling) * plotHeight;
  const compactMoney = new Intl.NumberFormat(
    lang === "hi" ? "hi-IN" : "en-IN",
    {
      style: "currency",
      currency: "INR",
      notation: "compact",
      maximumFractionDigits: 1,
    },
  );
  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;
    const measure = () => setAvailableWidth(Math.max(280, element.clientWidth));
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [series]);
  return (
    <section className="card cost-chart-card" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>{t("costChartTitle")}</h2>
      <p className="cost-report-caption">{t("costChartDescription")}</p>
      <div className="cost-chart-legend">
        <span>
          <i className="cost-purchase-key" />
          {t("costPurchase")}
        </span>
        <span>
          <i className="cost-remold-key" />
          {t("costRemold")}
        </span>
      </div>
      {visible.some((row) => row.totalPaise > 0) ? (
        <div
          className="cost-chart-scroll"
          ref={chartRef}
          tabIndex={0}
          role="region"
          aria-label={t("costChartTitle")}
        >
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-labelledby={`${id}-title`}
            aria-describedby={`${id}-description`}
          >
            <title id={`${id}-title`}>{t("costChartTitle")}</title>
            <desc id={`${id}-description`}>
              {t("costChartDescription")} {t("costRecordedOnly")}
            </desc>
            {[0, 1, 2, 3, 4].map((tick) => {
              const amount = tick * step;
              const y = bottom - scale(amount);
              return (
                <g key={tick}>
                  <line
                    className="cost-chart-grid"
                    x1={left}
                    x2={width - 20}
                    y1={y}
                    y2={y}
                  />
                  <text
                    className="cost-chart-axis"
                    x={left - 10}
                    y={y + 4}
                    textAnchor="end"
                  >
                    {compactMoney.format(amount / 100)}
                  </text>
                </g>
              );
            })}
            {visible.map((row, index) => {
              const x = left + slot * (index + 0.5) - barWidth / 2;
              const purchaseHeight = scale(row.purchasePaise);
              const remoldHeight = scale(row.remoldPaise);
              return (
                <g key={row.period}>
                  <title>
                    {periodLabel(row.period, lang)}: {t("costPurchase")}{" "}
                    {formatInr(row.purchasePaise, lang)}; {t("costRemold")}{" "}
                    {formatInr(row.remoldPaise, lang)}; {t("costTotal")}{" "}
                    {formatInr(row.totalPaise, lang)}
                  </title>
                  <rect
                    className="cost-chart-purchase"
                    x={x}
                    y={bottom - purchaseHeight}
                    width={barWidth}
                    height={purchaseHeight}
                  />
                  <rect
                    className="cost-chart-remold"
                    x={x}
                    y={bottom - purchaseHeight - remoldHeight}
                    width={barWidth}
                    height={remoldHeight}
                  />
                  <text
                    className="cost-chart-axis"
                    x={x + barWidth / 2}
                    y={bottom + 24}
                    textAnchor="middle"
                  >
                    {periodLabel(row.period, lang)}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      ) : (
        <p className="cost-empty-state">
          {t(series.length ? "costZeroTotal" : "costNoData")}
        </p>
      )}
      {width > availableWidth + 1 && (
        <p className="cost-report-caption">{t("costChartPanHint")}</p>
      )}
      {series.length > 60 && (
        <p className="cost-report-caption">{t("costChartLimit")}</p>
      )}
      <details
        className="cost-chart-data"
        onToggle={(event) => setTableOpen(event.currentTarget.open)}
      >
        <summary>{t("costChartData")}</summary>
        {tableOpen && (
          <div
            className="cost-table-scroll"
            tabIndex={0}
            role="region"
            aria-label={t("costChartData")}
          >
            <table className="cost-table">
              <caption>{t("costChartTitle")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("costPeriod")}</th>
                  <th scope="col">{t("costPurchaseTotal")}</th>
                  <th scope="col">{t("costRemoldTotal")}</th>
                  <th scope="col">{t("costTotal")}</th>
                </tr>
              </thead>
              <tbody>
                {series.map((row) => (
                  <tr key={row.period}>
                    <th scope="row">{periodLabel(row.period, lang)}</th>
                    <td className="cost-money">
                      {formatInr(row.purchasePaise, lang)}
                    </td>
                    <td className="cost-money">
                      {formatInr(row.remoldPaise, lang)}
                    </td>
                    <td className="cost-money">
                      {formatInr(row.totalPaise, lang)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>
    </section>
  );
}

export function CostReport({ app, onExport, request }) {
  const { t, n, state, lang, session } = app;
  const isOwner = session?.user?.role === "owner";
  const initial = presetRange("thisMonth");
  const [preset, setPreset] = useState("thisMonth");
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [kind, setKind] = useState("");
  const [brand, setBrand] = useState("");
  const [groupBy, setGroupBy] = useState("month");
  const [response, setResponse] = useState(null);
  const [failure, setFailure] = useState(null);
  const [retry, setRetry] = useState(0);
  const [exportError, setExportError] = useState("");
  const [shown, setShown] = useState(100);
  const valid = isDay(from) && isDay(to) && from <= to;
  const query = valid
    ? new URLSearchParams({ from, to, kind, brand, groupBy }).toString()
    : "";
  const result = response?.query === query ? response.data : null;
  const error = failure?.query === query ? failure.code : "";
  const loading = valid && !result && !error;
  const brands = [
    ...new Set(
      [
        ...manufacturers.map((make) => make.name),
        ...(state.tyres || []).map((tyre) => tyre.brand),
        ...(state.costs || []).map((cost) => cost.brand),
        ...(brand ? [brand] : []),
      ].filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b));

  useEffect(() => {
    if (!isOwner || !valid) return;
    let active = true;
    setResponse(null);
    setFailure(null);
    setExportError("");
    setShown(100);
    Promise.resolve()
      .then(() => request(`/reports/costs?${query}`))
      .then((data) => {
        if (
          !Array.isArray(data?.rows) ||
          !Array.isArray(data?.series) ||
          !data?.totals
        )
          throw { code: "invalidServerResponse" };
        if (data.error) throw { code: data.error };
        if (active) setResponse({ query, data });
      })
      .catch((error) => {
        if (active) setFailure({ query, code: error.code || "serverError" });
      });
    // Requests retain the API's normal timeout. Ignore results after a filter
    // change/unmount so a slow old request cannot replace the current report.
    return () => {
      active = false;
    };
  }, [query, valid, isOwner, request, state.revision, retry]);

  async function exportCosts() {
    if (!result || loading || error) return;
    setExportError("");
    try {
      await onExport(`Shepards-tyre-costs-${from}-${to}.csv`, [
        [
          t("date"),
          t("serial"),
          t("brand"),
          t("costKind"),
          t("costCondition"),
          t("costInvoice"),
          t("costAmountINR"),
          t("by"),
        ],
        ...result.rows.map((row) => [
          displayDate(row.date),
          row.tyreSerial,
          row.brand,
          t(row.kind === "purchase" ? "costPurchase" : "costRemold"),
          t(row.condition) || row.condition,
          row.invoiceNo,
          (row.amountPaise / 100).toFixed(2),
          row.actor,
        ]),
      ]);
    } catch (error) {
      setExportError(error.code || "serverError");
    }
  }

  if (!isOwner) return null;
  return (
    <div className="cost-report">
      <div className="page-heading">
        <div>
          <h1>{t("costReportTitle")}</h1>
          <p>{t("costReportSub")}</p>
        </div>
        <button
          className="secondary"
          onClick={exportCosts}
          disabled={!result?.rows.length || loading || !!error}
        >
          <Download size={17} />
          {t("costExport")}
        </button>
      </div>
      <p className="cost-scope-note">{t("costScopeHint")}</p>
      <section
        className="card cost-report-filters"
        aria-label={t("costFilters")}
      >
        <label className="field">
          <span>{t("datePreset")}</span>
          <select
            aria-label={t("datePreset")}
            value={preset}
            onChange={(event) => {
              const value = event.target.value;
              setPreset(value);
              if (value !== "custom") {
                const range = presetRange(value);
                setFrom(range.from);
                setTo(range.to);
              }
            }}
          >
            {["thisMonth", "lastMonth", "lastYear", "custom"].map((key) => (
              <option key={key} value={key}>
                {t(key)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t("fromDate")}</span>
          <DateField
            label={t("fromDate")}
            value={from}
            max={dayKey()}
            onChange={(value) => {
              setPreset("custom");
              setFrom(value);
            }}
          />
        </label>
        <label className="field">
          <span>{t("toDate")}</span>
          <DateField
            label={t("toDate")}
            value={to}
            max={dayKey()}
            onChange={(value) => {
              setPreset("custom");
              setTo(value);
            }}
          />
        </label>
        <label className="field">
          <span>{t("brand")}</span>
          <select
            aria-label={t("brand")}
            value={brand}
            onChange={(event) => setBrand(event.target.value)}
          >
            <option value="">{t("costAllBrands")}</option>
            {brands.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t("costKind")}</span>
          <select
            aria-label={t("costKind")}
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          >
            <option value="">{t("costAllKinds")}</option>
            <option value="purchase">{t("costPurchase")}</option>
            <option value="remold">{t("costRemold")}</option>
          </select>
        </label>
        <label className="field">
          <span>{t("costGroupBy")}</span>
          <select
            aria-label={t("costGroupBy")}
            value={groupBy}
            onChange={(event) => setGroupBy(event.target.value)}
          >
            <option value="month">{t("costByMonth")}</option>
            <option value="day">{t("costByDay")}</option>
          </select>
        </label>
      </section>
      {!valid && (
        <p className="form-error" role="alert">
          {t("invalidDateRange")}
        </p>
      )}
      {loading && (
        <p className="cost-loading" role="status">
          <RefreshCw size={18} className="spin" />
          {t("costLoading")}
        </p>
      )}
      {error && (
        <div className="cost-load-error">
          <p className="form-error" role="alert">
            {t(error)}
          </p>
          <button
            className="secondary"
            onClick={() => setRetry((value) => value + 1)}
          >
            {t("costRetry")}
          </button>
        </div>
      )}
      {exportError && (
        <p className="form-error" role="alert">
          {t(exportError)}
        </p>
      )}
      {valid && result && !error && (
        <>
          <div className="cost-totals">
            {[
              [
                "costPurchaseTotal",
                "purchasePaise",
                result.totals.purchaseCount,
              ],
              ["costRemoldTotal", "remoldPaise", result.totals.remoldCount],
              ["costTotal", "totalPaise", result.rows.length],
            ].map(([label, key, count]) => (
              <div className="card cost-total" key={key}>
                <span>{t(label)}</span>
                <strong>{formatInr(result.totals[key], lang)}</strong>
                <small>
                  {n(count)} {t("costEntries")}
                </small>
              </div>
            ))}
          </div>
          <p className="cost-report-caption">{t("costSummaryIncludes")}</p>
          {!!result.unpricedCount && (
            <aside className="cost-unpriced">
              <strong>
                {n(result.unpricedCount)} · {t("costMissing")}
              </strong>
              <p>{t("costMissingHint")}</p>
            </aside>
          )}
          <SpendingChart key={query} series={result.series} app={app} />
          <section className="card cost-ledger">
            <div className="card-title-row">
              <h2>{t("costLedger")}</h2>
              <span className="small muted">
                {n(result.rows.length)} {t("costEntries")}
              </span>
            </div>
            <p className="cost-report-caption">
              {displayDate(from)} – {displayDate(to)} · {t("costRecordedOnly")}
            </p>
            {result.rows.length ? (
              <>
                <div
                  className="cost-table-scroll"
                  tabIndex={0}
                  role="region"
                  aria-label={t("costLedger")}
                >
                  <table className="cost-table">
                    <caption>{t("costLedger")}</caption>
                    <thead>
                      <tr>
                        {[
                          "date",
                          "serial",
                          "brand",
                          "costKind",
                          "costCondition",
                          "costInvoice",
                          "costAmountINR",
                          "by",
                        ].map((key) => (
                          <th key={key} scope="col">
                            {t(key)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.slice(0, shown).map((row) => (
                        <tr key={row.id}>
                          <td>{displayDate(row.date)}</td>
                          <th scope="row" className="cost-serial">
                            {row.tyreSerial}
                          </th>
                          <td>
                            <BrandMark brand={row.brand} />
                          </td>
                          <td>
                            <span className={`cost-kind cost-kind-${row.kind}`}>
                              {t(
                                row.kind === "purchase"
                                  ? "costPurchase"
                                  : "costRemold",
                              )}
                            </span>
                          </td>
                          <td>{t(row.condition)}</td>
                          <td className="cost-invoice">{row.invoiceNo}</td>
                          <td className="cost-money">
                            {formatInr(row.amountPaise, lang)}
                          </td>
                          <td className="cost-actor">{row.actor}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {shown < result.rows.length && (
                  <div className="cost-more">
                    <p>
                      {t("costShowing")}: {n(shown)} / {n(result.rows.length)}
                    </p>
                    <button
                      className="secondary"
                      onClick={() => setShown((value) => value + 100)}
                    >
                      {t("costShowMore")}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <p className="cost-empty-state">{t("costNoData")}</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
