import React, { useState } from "react";
import { Download } from "lucide-react";
import { reportFor, presetRange, effectiveDay } from "../shared/reports.js";
import { dayKey, positionLabel } from "../shared/model.js";
import { displayDate } from "../shared/dates.js";
import { vehicleClasses } from "../shared/catalogue.js";
import { averageNsd } from "../shared/nsd.js";
import { BrandMark } from "./branding.jsx";
import { DateField } from "./date-field.jsx";
export function Reports({ app, initialVehicleId, onExport }) {
  const { t, n, date, state } = app;
  const [exportError, setExportError] = useState("");
  const initial = presetRange("thisMonth");
  const [preset, setPreset] = useState("thisMonth");
  const [from, setFrom] = useState(initial.from),
    [to, setTo] = useState(initial.to);
  const [vehicleId, setVehicleId] = useState(initialVehicleId || ""),
    [emissionClass, setEmissionClass] = useState(""),
    [actor, setActor] = useState("");
  const result = reportFor(state, {
    from,
    to,
    vehicleId,
    emissionClass,
    actor,
  });
  const metrics = [
    "fitments",
    "inspections",
    "findings",
    "nsdChecks",
    "removals",
    "driverChanges",
    "driverChecks",
    "vehicleSales",
    "tyreKm",
  ];
  async function exportReport(details = false) {
    setExportError("");
    try {
      const headers = details
        ? [
            t("date"),
            t("activity"),
            t("vehicle"),
            t("serial"),
            t("position"),
            t("by"),
            t("notes"),
          ]
        : [t("vehicle"), t("vehicleClass"), ...metrics.map(t)];
      const rows = details
        ? result.events.map((e) => [
            displayDate(effectiveDay(e)),
            t(`move_${e.kind}`),
            e.vehicle,
            e.tyre || (e.nsdMeasurements || []).map((m) => m.tyre).join(" / "),
            positionLabel(e.slot),
            e.actor,
            [
              e.note,
              e.vendor ? `${t("remoldVendor")}: ${e.vendor}` : "",
              e.driverName ? `${t("driverName")}: ${e.driverName}` : "",
              e.allTyresChecked !== undefined
                ? t(e.allTyresChecked ? "allTyresChecked" : "partialCheck")
                : "",
              e.driverCheckCompleted ? t("driverCheckDone") : "",
              ...(e.findings || []).map(
                (f) =>
                  `${positionLabel(f.slot)}: ${t(`issue_${f.issue}`)} ${f.detail || ""}`,
              ),
              ...(e.nsdMeasurements || []).map(
                (m) => `${m.tyre}: ${averageNsd(m)}%`,
              ),
            ]
              .filter(Boolean)
              .join("; "),
          ])
        : result.rows.map((r) => [
            r.vehicle.registration,
            r.vehicle.emissionClass || t("notRecorded"),
            ...metrics.map((k) => r[k]),
          ]);
      await onExport(
        `Shepards-${details ? "report-details" : "vehicle-summary"}-${from}-${to}.csv`,
        [headers, ...rows],
      );
    } catch (e) {
      setExportError(e.code || "serverError");
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{t("reports")}</h1>
          <p>{t("reportsSub")}</p>
        </div>
        <div className="report-exports">
          <button
            className="secondary"
            disabled={!!result.error}
            onClick={() => exportReport(false)}
          >
            <Download size={17} />
            {t("exportSummary")}
          </button>
          <button
            className="secondary"
            disabled={!!result.error}
            onClick={() => exportReport(true)}
          >
            {t("exportDetails")}
          </button>
        </div>
      </div>
      {exportError && (
        <p className="form-error" role="alert">
          {t(exportError)}
        </p>
      )}
      <section className="card report-filters">
        <label className="field">
          <span>{t("datePreset")}</span>
          <select
            aria-label={t("datePreset")}
            value={preset}
            onChange={(e) => {
              setPreset(e.target.value);
              if (e.target.value !== "custom") {
                const range = presetRange(e.target.value);
                setFrom(range.from);
                setTo(range.to);
              }
            }}
          >
            {["thisMonth", "lastMonth", "lastYear", "custom"].map((k) => (
              <option value={k} key={k}>
                {t(k)}
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
            onChange={(v) => {
              setPreset("custom");
              setFrom(v);
            }}
          />
        </label>
        <label className="field">
          <span>{t("toDate")}</span>
          <DateField
            label={t("toDate")}
            value={to}
            max={dayKey()}
            onChange={(v) => {
              setPreset("custom");
              setTo(v);
            }}
          />
        </label>
        <label className="field">
          <span>{t("vehicle")}</span>
          <select
            aria-label={t("vehicle")}
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
          >
            <option value="">{t("allVehicles")}</option>
            {state.vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.registration}
                {v.status === "sold" ? ` · ${t("sold")}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t("vehicleClass")}</span>
          <select
            aria-label={t("vehicleClass")}
            value={emissionClass}
            onChange={(e) => setEmissionClass(e.target.value)}
          >
            <option value="">{t("allClasses")}</option>
            {vehicleClasses.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t("by")}</span>
          <select
            aria-label={t("by")}
            value={actor}
            onChange={(e) => setActor(e.target.value)}
          >
            <option value="">{t("allStaff")}</option>
            {[...new Set(state.events.map((e) => e.actor))].sort().map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
      </section>
      {result.error ? (
        <p className="form-error" role="alert">
          {t(result.error)}
        </p>
      ) : (
        <>
          <div className="report-metrics">
            {metrics.map((k) => (
              <div className="card" key={k}>
                <strong>{n(result.totals[k])}</strong>
                <span>{t(k)}</span>
              </div>
            ))}
          </div>
          <section className="card">
            <h2>{t("vehicleSummary")}</h2>
            <p className="small muted">
              {date(from)} – {date(to)} · {t("tyreKmHint")}
            </p>
            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>{t("vehicle")}</th>
                    <th>{t("vehicleClass")}</th>
                    {metrics.map((k) => (
                      <th key={k}>{t(k)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={r.vehicle.id}>
                      <th>
                        {r.vehicle.registration}
                        {r.vehicle.status === "sold" && (
                          <span className="report-sold-tag">{t("sold")}</span>
                        )}
                      </th>
                      <td>{r.vehicle.emissionClass || t("notRecorded")}</td>
                      {metrics.map((k) => (
                        <td key={k}>{n(r[k])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!result.rows.length && <p>{t("noResults")}</p>}
          </section>
          <section className="card report-history">
            <h2>{t("reportMovements")}</h2>
            <p className="small muted">
              {n(result.events.length)} {t("activity")}
            </p>
            {result.events.slice(0, 100).map((e) => (
              <div className="report-event" key={e.id}>
                <strong>
                  {t(`move_${e.kind}`)} · {e.vehicle}
                </strong>
                <span>
                  {date(effectiveDay(e))} · {e.actor}
                </span>
                {e.brand && <BrandMark brand={e.brand} />}
                {e.allTyresChecked !== undefined && (
                  <small>
                    {t(e.allTyresChecked ? "allTyresChecked" : "partialCheck")}
                    {e.driverCheckCompleted ? ` · ${t("driverCheckDone")}` : ""}
                  </small>
                )}
                {(e.nsdMeasurements || []).map((m, i) => (
                  <small key={i}>
                    {m.tyre} · {t("nsd")}: {averageNsd(m)}%
                  </small>
                ))}
                <small>
                  {[
                    e.tyre,
                    e.driverName,
                    e.vendor,
                    ...(e.findings || []).map(
                      (f) =>
                        `${positionLabel(f.slot)}: ${t(`issue_${f.issue}`)}`,
                    ),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </div>
            ))}
            {result.events.length > 100 && (
              <p className="small muted">{t("reportExportAll")}</p>
            )}
          </section>
        </>
      )}
    </>
  );
}
