import React, { useEffect, useId, useState } from "react";
import { Bell } from "lucide-react";
import { reminderSettings } from "../shared/reminders.js";
import "./driver-management.css";

const fields = [
  ["nsd", "reminderNsd", "reminderNsdHint"],
  ["inspection", "reminderInspection", "reminderInspectionHint"],
  ["driverLicense", "reminderDriverLicense", "reminderDriverLicenseHint"],
  ["driverChange", "reminderDriverChange", "reminderDriverChangeHint"],
];
const limits = { days: 3650, weeks: 520, months: 120 };

function ReminderSettingsForm({ app }) {
  const { state, t, action, offline } = app;
  const saved = reminderSettings(state),
    savedKey = JSON.stringify(saved);
  const [draft, setDraft] = useState(saved);
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const titleId = useId();
  useEffect(() => {
    if (!dirty) setDraft(JSON.parse(savedKey));
  }, [savedKey, dirty]);
  function update(key, property, value) {
    setDraft((previous) => ({
      ...previous,
      [key]: { ...previous[key], [property]: value },
    }));
    setDirty(true);
    setError("");
  }
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const settings = Object.fromEntries(
        fields.map(([key]) => [
          key,
          {
            value: draft[key].value === "" ? null : Number(draft[key].value),
            unit: draft[key].unit,
          },
        ]),
      );
      await action("updateReminderSettings", { settings });
      setDirty(false);
    } catch (failure) {
      setError(failure.code || "serverError");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="card reminder-settings management-section"
      aria-labelledby={titleId}
      data-testid="reminder-settings"
    >
      <div className="management-section-heading">
        <div>
          <h2 id={titleId}>
            <Bell size={21} aria-hidden="true" />
            {t("reminderSettingsTitle")}
          </h2>
          <p>{t("reminderSettingsHint")}</p>
        </div>
      </div>
      <form onSubmit={submit}>
        <fieldset
          className="reminder-settings-fields"
          disabled={busy || offline}
        >
          {fields.map(([key, label, hint]) => (
            <div className="reminder-setting-row" key={key}>
              <div className="reminder-setting-description">
                <h3>{t(label)}</h3>
                <p>{t(hint)}</p>
              </div>
              <div className="reminder-interval-fields">
                <label className="field">
                  <span>{t("reminderValue")}</span>
                  <input
                    name={`${key}Value`}
                    aria-label={`${t(label)} · ${t("reminderValue")}`}
                    type="number"
                    inputMode="numeric"
                    required
                    min={key === "driverChange" ? 0 : 1}
                    max={limits[draft[key].unit]}
                    step={1}
                    value={draft[key].value}
                    onChange={(event) =>
                      update(key, "value", event.target.value)
                    }
                  />
                </label>
                <label className="field">
                  <span>{t("reminderUnit")}</span>
                  <select
                    name={`${key}Unit`}
                    aria-label={`${t(label)} · ${t("reminderUnit")}`}
                    value={draft[key].unit}
                    onChange={(event) =>
                      update(key, "unit", event.target.value)
                    }
                  >
                    {[
                      ["days", "reminderDays"],
                      ["weeks", "reminderWeeks"],
                      ["months", "reminderMonths"],
                    ].map(([unit, name]) => (
                      <option key={unit} value={unit}>
                        {t(name)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          ))}
        </fieldset>
        <p className="reminder-settings-note">{t("reminderCalendarHint")}</p>
        {error && (
          <p className="form-error" role="alert">
            {t(error)}
          </p>
        )}
        <div className="reminder-settings-actions">
          <span role="status">{dirty ? t("reminderUnsaved") : ""}</span>
          <button
            className="secondary"
            type="button"
            disabled={!dirty || busy}
            onClick={() => {
              setDraft(reminderSettings(state));
              setDirty(false);
              setError("");
            }}
          >
            {t("reminderReset")}
          </button>
          <button className="primary" disabled={!dirty || busy || offline}>
            {t(busy ? "saving" : "saveReminderSettings")}
          </button>
        </div>
      </form>
    </section>
  );
}

export function ReminderSettings({ app }) {
  return app.session?.user?.role === "owner" ? (
    <ReminderSettingsForm app={app} />
  ) : null;
}
