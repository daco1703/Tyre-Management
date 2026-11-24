import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Plus,
  Search,
  UserRound,
  X,
} from "lucide-react";
import { DateField } from "./date-field.jsx";
import { dayKey } from "../shared/model.js";
import { displayDate } from "../shared/dates.js";
import { licenseStatus } from "../shared/reminders.js";
import "./driver-management.css";

const isActive = (driver) => driver.active !== false && driver.active !== 0;
const statusKey = {
  expired: "licenseExpired",
  due: "licenseDue",
  valid: "licenseValid",
  unknown: "licenseUnknown",
};

function LicenseBadge({ driver, state, t, date = displayDate }) {
  const result = licenseStatus(driver, state, dayKey());
  const Icon = result.status === "valid" ? CheckCircle2 : AlertTriangle;
  return (
    <span className={`driver-license-badge driver-license-${result.status}`}>
      <Icon size={16} aria-hidden="true" />
      <span>
        {t(statusKey[result.status] || "licenseUnknown")}
        {result.expiryOn ? ` · ${date(result.expiryOn)}` : ""}
      </span>
    </span>
  );
}

function DriverFormDialog({ app, driver, onClose }) {
  const { t, action, offline } = app;
  const ref = useRef(null);
  const [original] = useState(() =>
    driver
      ? {
          name: driver.name,
          dob: driver.dob,
          licenseNo: driver.licenseNo,
          licenseExpiry: driver.licenseExpiry,
          active: isActive(driver),
        }
      : null,
  );
  const [dob, setDob] = useState(original?.dob || "");
  const [expiry, setExpiry] = useState(original?.licenseExpiry || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const titleId = useId();
  useEffect(() => {
    ref.current.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await action(driver ? "updateDriver" : "addDriver", {
        ...(driver
          ? {
              driverId: driver.id,
              active: form.get("active") === "on",
              expectedDriver: original,
            }
          : {}),
        name: form.get("name"),
        dob,
        licenseNo: form.get("licenseNo"),
        licenseExpiry: expiry,
      });
      onClose();
    } catch (failure) {
      setError(failure.code || "serverError");
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      className="dialog driver-form-dialog"
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="dialog-header">
        <h2 id={titleId}>{t(driver ? "editDriver" : "addDriver")}</h2>
        <button
          className="icon-button"
          type="button"
          disabled={busy}
          aria-label={t("close")}
          onClick={onClose}
        >
          <X size={21} />
        </button>
      </div>
      <div className="dialog-body">
        <form onSubmit={submit} data-testid="driver-form">
          <fieldset className="driver-form-fields" disabled={busy || offline}>
            <label className="field">
              <span>{t("driverName")}</span>
              <input
                name="name"
                required
                maxLength={100}
                autoComplete="name"
                defaultValue={original?.name || ""}
                autoFocus
              />
            </label>
            <label className="field">
              <span>{t("driverDob")}</span>
              <DateField
                name="dob"
                label={t("driverDob")}
                value={dob}
                onChange={setDob}
                max={dayKey()}
                required
                errorText={t("invalidDriverDob")}
              />
            </label>
            <label className="field">
              <span>{t("driverLicenseNo")}</span>
              <input
                name="licenseNo"
                required
                maxLength={50}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                defaultValue={original?.licenseNo || ""}
              />
            </label>
            <label className="field">
              <span>{t("driverLicenseExpiry")}</span>
              <DateField
                name="licenseExpiry"
                label={t("driverLicenseExpiry")}
                value={expiry}
                onChange={setExpiry}
                required
                errorText={t("invalidLicenseExpiry")}
              />
            </label>
            {driver && (
              <div className="driver-active-field">
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    name="active"
                    defaultChecked={original.active}
                  />
                  {t("driverActive")}
                </label>
                <p>{t("driverInactiveHint")}</p>
              </div>
            )}
          </fieldset>
          {error && (
            <p className="form-error" role="alert">
              {t(error)}
            </p>
          )}
          <div className="form-actions driver-form-actions">
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={onClose}
            >
              {t("cancel")}
            </button>
            <button className="primary" disabled={busy || offline}>
              {t(busy ? "saving" : "save")}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}

export function DriverManagement({ app }) {
  const { state, t, n, date, offline } = app;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState(null);
  const titleId = useId();
  const drivers = state.drivers || [];
  const today = dayKey();
  const filtered = drivers.filter((driver) => {
    const status = licenseStatus(driver, state, today).status;
    const matchFilter =
      filter === "all" ||
      (filter === "active"
        ? isActive(driver)
        : isActive(driver) && status === filter);
    return (
      matchFilter &&
      `${driver.name} ${driver.licenseNo || ""}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase())
    );
  });
  const current =
    editing && editing !== "new"
      ? drivers.find((driver) => driver.id === editing)
      : null;
  return (
    <section
      className="card driver-management management-section"
      aria-labelledby={titleId}
      data-testid="driver-management"
    >
      <div className="management-section-heading">
        <div>
          <h2 id={titleId}>
            <UserRound size={21} aria-hidden="true" />
            {t("driverDirectory")}
          </h2>
          <p>{t("driverDirectoryHint")}</p>
        </div>
        <button
          className="primary"
          type="button"
          disabled={offline}
          data-testid="add-driver"
          onClick={() => setEditing("new")}
        >
          <Plus size={18} aria-hidden="true" />
          {t("addDriver")}
        </button>
      </div>
      <div className="driver-search">
        <Search size={18} aria-hidden="true" />
        <input
          type="search"
          aria-label={t("searchDrivers")}
          placeholder={t("searchDrivers")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div
        className="driver-filter-tabs"
        role="group"
        aria-label={t("driverFilter")}
      >
        {[
          ["all", "allDrivers"],
          ["active", "activeDrivers"],
          ["due", "licenseDue"],
          ["expired", "licenseExpired"],
        ].map(([value, key]) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            className={filter === value ? "selected" : ""}
            onClick={() => setFilter(value)}
          >
            {t(key)}
          </button>
        ))}
      </div>
      {!filtered.length ? (
        <div className="driver-empty">
          <UserRound size={28} aria-hidden="true" />
          <strong>{t(drivers.length ? "noDriverMatches" : "noDrivers")}</strong>
          {!drivers.length && <p>{t("noDriversHint")}</p>}
        </div>
      ) : (
        <div className="driver-grid">
          {filtered.map((driver) => {
            const vehicles = (state.vehicles || []).filter(
              (vehicle) =>
                vehicle.status !== "sold" && vehicle.driverId === driver.id,
            );
            return (
              <article
                className="driver-record"
                key={driver.id}
                data-driver-id={driver.id}
              >
                <div className="driver-record-heading">
                  <h3>{driver.name}</h3>
                  {!isActive(driver) && (
                    <span className="driver-inactive">
                      {t("inactiveDriver")}
                    </span>
                  )}
                </div>
                <LicenseBadge driver={driver} state={state} t={t} date={date} />
                <dl className="driver-record-details">
                  <div>
                    <dt>{t("driverLicenseNo")}</dt>
                    <dd>{driver.licenseNo || "—"}</dd>
                  </div>
                  <div>
                    <dt>{t("driverDob")}</dt>
                    <dd>{date(driver.dob)}</dd>
                  </div>
                  <div>
                    <dt>
                      {t("assignedVehicles")}
                      {vehicles.length ? ` (${n(vehicles.length)})` : ""}
                    </dt>
                    <dd>
                      {vehicles.length
                        ? vehicles
                            .map((vehicle) => vehicle.registration)
                            .join(" · ")
                        : t("driverNotAssigned")}
                    </dd>
                  </div>
                </dl>
                <button
                  className="secondary driver-edit-button"
                  type="button"
                  disabled={offline}
                  onClick={() => setEditing(driver.id)}
                >
                  {t("editDriver")}
                </button>
              </article>
            );
          })}
        </div>
      )}
      {editing && (editing === "new" || current) && (
        <DriverFormDialog
          key={editing}
          app={app}
          driver={current}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

export function DriverPicker({
  drivers = [],
  value = "",
  onChange,
  t,
  legacyName = "",
  required = false,
  state = {},
}) {
  const id = useId();
  const rootRef = useRef(null),
    inputRef = useRef(null),
    listRef = useRef(null);
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  const [pending, setPending] = useState(false),
    [highlight, setHighlight] = useState(-1);
  const selected = drivers.find((driver) => driver.id === value);
  const selectedText = selected?.name || legacyName || "";
  const choices = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    const active = drivers.filter(
      (driver) =>
        isActive(driver) &&
        `${driver.name} ${driver.licenseNo || ""}`
          .toLocaleLowerCase()
          .includes(search),
    );
    const special = !search
      ? legacyName
        ? [{ id: "", name: legacyName, legacy: true }]
        : !required
          ? [{ id: "", name: t("noDriverSelected"), empty: true }]
          : []
      : [];
    return [...special, ...active];
  }, [drivers, query, legacyName, required, t]);
  useEffect(() => {
    inputRef.current?.setCustomValidity(
      pending && query.trim()
        ? t("chooseDriverFromList")
        : required && !value && !legacyName
          ? t("chooseDriver")
          : "",
    );
  }, [pending, query, required, value, legacyName, t]);
  useEffect(() => {
    const outside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  useEffect(() => {
    if (open)
      listRef.current
        ?.querySelector(`[data-option-index="${highlight}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);
  function choose(driver) {
    onChange(driver.id);
    setQuery("");
    setPending(false);
    setOpen(false);
    inputRef.current?.focus();
  }
  function showChoices() {
    setOpen(true);
    setHighlight(choices.findIndex((driver) => driver.id === value));
  }
  function keys(event) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setHighlight((current) =>
        choices.length
          ? current < 0
            ? event.key === "ArrowDown"
              ? 0
              : choices.length - 1
            : (current +
                (event.key === "ArrowDown" ? 1 : -1) +
                choices.length) %
              choices.length
          : -1,
      );
    } else if (event.key === "Enter" && open && choices[highlight]) {
      event.preventDefault();
      choose(choices[highlight]);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setPending(false);
      setQuery("");
    } else if (event.key === "Tab") setOpen(false);
  }
  return (
    <div
      className="field driver-picker"
      ref={rootRef}
      data-testid="driver-picker"
    >
      <label htmlFor={`${id}-input`}>{t("chooseDriver")}</label>
      <div className="driver-picker-control">
        <input
          id={`${id}-input`}
          ref={inputRef}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-activedescendant={
            open && choices[highlight] ? `${id}-option-${highlight}` : undefined
          }
          aria-required={required}
          aria-describedby={`${id}-hint`}
          autoComplete="off"
          value={open || pending ? query : selectedText}
          placeholder={selectedText || t("chooseDriver")}
          onFocus={showChoices}
          onChange={(event) => {
            setQuery(event.target.value);
            setPending(true);
            setHighlight(0);
            setOpen(true);
          }}
          onKeyDown={keys}
        />
        <button
          type="button"
          className="icon-button"
          aria-label={t("showDriverChoices")}
          aria-expanded={open}
          aria-controls={`${id}-list`}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            if (open) setOpen(false);
            else showChoices();
            inputRef.current?.focus();
          }}
        >
          <ChevronDown size={19} aria-hidden="true" />
        </button>
      </div>
      <input type="hidden" name="driverId" value={value} />
      <small id={`${id}-hint`}>
        {t(legacyName && !value ? "legacyDriverHint" : "driverSearchHint")}
      </small>
      {open && (
        <div
          className="driver-picker-list"
          id={`${id}-list`}
          role="listbox"
          aria-label={t("chooseDriver")}
          ref={listRef}
        >
          {!choices.length ? (
            <p className="driver-picker-empty">
              {t(
                (drivers || []).some(isActive)
                  ? "noDriverMatches"
                  : "driverPickerEmpty",
              )}
            </p>
          ) : (
            choices.map((driver, index) => (
              <button
                type="button"
                role="option"
                tabIndex={-1}
                id={`${id}-option-${index}`}
                data-option-index={index}
                key={driver.id || "unassigned"}
                aria-selected={driver.id === value}
                className={highlight === index ? "highlighted" : ""}
                onPointerDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => choose(driver)}
              >
                <strong>
                  {driver.legacy
                    ? `${t("keepLegacyDriver")} · ${driver.name}`
                    : driver.name}
                </strong>
                {!driver.empty && !driver.legacy && (
                  <>
                    <small>{driver.licenseNo}</small>
                    <LicenseBadge driver={driver} state={state} t={t} />
                  </>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
