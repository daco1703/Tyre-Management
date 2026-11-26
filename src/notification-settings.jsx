import React, { useEffect, useId, useState } from "react";
import { Bell, BellOff, CheckCircle2, Smartphone, Send } from "lucide-react";
import { displayDate } from "../shared/dates.js";
import "./notification-settings.css";

const categories = ["nsd", "inspection", "driverChange", "driverLicense"];
const initialStatus = {
  enabled: false,
  delivery: "off",
  reason: "notEnabled",
  categories,
  busy: false,
  scheduledCount: 0,
  stale: false,
  canTest: false,
};

function SettingsCard({ app, controller }) {
  const { t, session, state, offline, lang } = app;
  const [status, setStatus] = useState(() => ({
    ...initialStatus,
    ...controller.status(),
  }));
  const [selected, setSelected] = useState(
    () => status.categories || categories,
  );
  const [dirty, setDirty] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const titleId = useId();
  const categoryKey = JSON.stringify(status.categories || categories);
  useEffect(
    () =>
      controller.subscribe((next) => setStatus({ ...initialStatus, ...next })),
    [controller],
  );
  useEffect(() => {
    if (!dirty) setSelected(JSON.parse(categoryKey));
  }, [categoryKey, dirty]);
  const busy = working || status.busy;
  const cleanupPending = status.reason === "cleanupPending";
  const modeKey = cleanupPending
    ? "notificationModeCleanup"
    : status.enabled
      ? status.delivery === "remote"
        ? "notificationModeRemote"
        : status.delivery === "local"
          ? "notificationModeLocal"
          : "notificationModeOff"
      : "notificationModeOff";
  const reasonKey = `notificationReason_${status.reason || "notEnabled"}`;
  const reason =
    t(reasonKey) === reasonKey
      ? t("notificationReason_connectionFailed")
      : t(reasonKey);
  const formatDate = app.date || displayDate;
  const number = app.n || String;
  async function run(operation) {
    setWorking(true);
    setError("");
    try {
      const result = await operation();
      const next = result || controller.status();
      setStatus({ ...initialStatus, ...next });
      if (next.categories) setSelected(next.categories);
      setDirty(false);
    } catch {
      setError("notificationReason_connectionFailed");
    } finally {
      setWorking(false);
    }
  }
  function save() {
    return run(() =>
      controller.enable({
        state,
        user: session.user,
        ...(app.notificationServer !== undefined
          ? { server: app.notificationServer }
          : {}),
        lang: lang || "en",
        categories: selected,
        online: !offline,
        fresh: !offline,
      }),
    );
  }
  function toggle(category, checked) {
    setSelected((previous) =>
      categories.filter((key) =>
        key === category ? checked : previous.includes(key),
      ),
    );
    setDirty(true);
    setError("");
  }
  return (
    <section
      className="card notification-settings"
      aria-labelledby={titleId}
      data-testid="notification-settings"
    >
      <header className="notification-settings-heading">
        <Bell size={22} aria-hidden="true" />
        <div>
          <h2 id={titleId}>{t("notificationSettingsTitle")}</h2>
          <p>{t("notificationSettingsIntro")}</p>
        </div>
      </header>
      <div
        className={`notification-device-status ${cleanupPending ? "cleanup" : status.enabled ? status.delivery : "off"}`}
      >
        <span className="notification-delivery-label">
          {status.enabled ? (
            status.delivery === "local" ? (
              <Smartphone size={18} aria-hidden="true" />
            ) : (
              <CheckCircle2 size={18} aria-hidden="true" />
            )
          ) : (
            <BellOff size={18} aria-hidden="true" />
          )}
          {t(modeKey)}
        </span>
        <p role="status" aria-live="polite">
          {reason}
        </p>
        {status.enabled && status.delivery === "local" && (
          <p className="notification-delivery-detail">
            {t("notificationLocalDetail")}
          </p>
        )}
        {status.enabled && status.delivery === "remote" && (
          <p className="notification-delivery-detail">
            {t("notificationRemoteDetail")}
          </p>
        )}
        {status.enabled && status.delivery === "local" && (
          <p className="notification-record-summary">
            {t("notificationScheduledCount")}:{" "}
            <strong>{number(status.scheduledCount || 0)}</strong>
          </p>
        )}
        {status.lastSyncedAt && (
          <>
            {status.enabled &&
              status.delivery === "local" &&
              status.truncated && (
                <p className="notification-delivery-detail">
                  {t("notificationPlanTruncated")}
                </p>
              )}
            <p className="notification-record-summary">
              {t("notificationLastSynced")}:{" "}
              <time dateTime={status.lastSyncedAt}>
                {formatDate(status.lastSyncedAt, true)}
              </time>
            </p>
          </>
        )}
      </div>
      {(status.stale || offline) && (
        <p className="notification-notice">{t("notificationStale")}</p>
      )}
      {(status.permission === "denied" ||
        status.reason === "permissionDenied") && (
        <p className="notification-notice">{t("notificationPermissionHint")}</p>
      )}
      {status.reason === "installRequired" && (
        <div className="notification-install-help">
          <h3>{t("notificationInstallTitle")}</h3>
          <ol>
            <li>{t("notificationInstallSafari")}</li>
            <li>{t("notificationInstallShare")}</li>
            <li>{t("notificationInstallOpen")}</li>
          </ol>
        </div>
      )}
      <fieldset className="notification-category-fields" disabled={busy}>
        <legend>{t("notificationCategories")}</legend>
        <div className="notification-category-grid">
          {categories.map((category) => (
            <label
              key={category}
              className={`notification-category ${selected.includes(category) ? "selected" : ""}`}
            >
              <input
                type="checkbox"
                name={`category-${category}`}
                checked={selected.includes(category)}
                onChange={(event) => toggle(category, event.target.checked)}
              />
              <span>
                <strong>{t(`notificationCategory_${category}`)}</strong>
                <small>{t(`notificationCategoryHint_${category}`)}</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {!selected.length && (
        <p className="notification-selection-note">
          {t("notificationSelectCategory")}
        </p>
      )}
      {dirty && (
        <p className="notification-selection-note">
          {t("notificationUnsaved")}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {t(error)}
        </p>
      )}
      <div className="notification-settings-actions">
        <button
          type="button"
          className="primary"
          data-testid="enable-notifications"
          disabled={busy || offline || (status.enabled && !dirty)}
          onClick={save}
        >
          {t(
            busy
              ? "notificationWorking"
              : status.enabled
                ? "notificationSaveCategories"
                : "notificationEnable",
          )}
        </button>
        {(status.enabled || status.canDisable || cleanupPending) && (
          <button
            type="button"
            className="secondary"
            data-testid="disable-notifications"
            disabled={busy}
            onClick={() => run(() => controller.disable())}
          >
            {t("notificationDisable")}
          </button>
        )}
      </div>
      {status.canTest && (
        <div className="notification-device-test">
          <button
            type="button"
            className="secondary"
            data-testid="test-notifications"
            disabled={busy || offline}
            onClick={() => run(() => controller.test())}
          >
            <Send size={17} aria-hidden="true" />
            {t("notificationTest")}
          </button>
          <p>{t("notificationOwnDeviceTest")}</p>
        </div>
      )}
    </section>
  );
}

export function NotificationSettings({ app, controller }) {
  return app.session?.user && controller ? (
    <SettingsCard app={app} controller={controller} />
  ) : null;
}
