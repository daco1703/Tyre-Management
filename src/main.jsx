import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import { App as NativeApp } from "@capacitor/app";
import {
  CircleDot,
  LayoutDashboard,
  Truck,
  Package,
  BookOpen,
  Settings,
  Plus,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowRight,
  Search,
  X,
  ChevronRight,
  RefreshCw,
  Download,
  LogOut,
  Users,
  Globe,
  Check,
  WifiOff,
  ShieldCheck,
  Gauge,
  CalendarDays,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Wrench,
  Trash2,
  Link,
  BarChart3,
  ClipboardCheck,
  UserRound,
  Ruler,
  Upload,
} from "lucide-react";
import { DateField } from "./date-field.jsx";
import { Reports } from "./reports.jsx";
import { BrandMark } from "./branding.jsx";
import { displayDate, parseDisplayDate } from "../shared/dates.js";
import {
  manufacturers,
  manufacturerFor,
  vehicleClasses,
  constructions,
  inspectionIssues,
} from "../shared/catalogue.js";
import { lastInspection, vehicleEvents } from "../shared/reports.js";
import { defaultFleetName, defaultUsername } from "../shared/defaults.js";
import { en, hi } from "./i18n";
import { averageNsd } from "../shared/nsd.js";
import { previewTyreImport } from "../shared/tyre-import.js";
import { previewVehicleImport } from "../shared/vehicle-import";
import {
  readVehicleWorkbook,
  makeVehicleTemplate,
  makeTyreTemplate,
} from "./vehicle-workbook";
import {
  activeVehicles,
  numberedSlots,
  positionLabel,
  dayKey,
  tally,
  dailyTally,
  tyreKm,
  scrapReasons,
} from "../shared/model";
import "./style.css";
import "./secondary-layout.css";
import "./layout.css";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/noto-sans-devanagari/devanagari-400.css";
import "@fontsource/noto-sans-devanagari/devanagari-500.css";
import "@fontsource/noto-sans-devanagari/devanagari-600.css";
import "@fontsource/noto-sans-devanagari/devanagari-700.css";

const native = Capacitor.isNativePlatform();
const read = (key, fallback = null) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const store = (key, value) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};
let server = native
  ? read("ts-server", "https://tyre-management.onrender.com")
  : "";
async function request(url, body, options = {}) {
  try {
    const token = native ? read("ts-token", "") : "";
    const res = await fetch(`${server}/api${url}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: native ? "omit" : "same-origin",
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: options.signal || AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (!res.ok)
      throw Object.assign(new Error(data.error || "serverError"), {
        code: data.error || "serverError",
        status: res.status,
      });
    return data;
  } catch (e) {
    if (e.code) throw e;
    throw Object.assign(new Error("notConnected"), { code: "notConnected" });
  }
}
const Context = React.createContext();
const useApp = () => React.useContext(Context);
function App() {
  const initVersion = useRef(0);
  const stateRef = useRef(null);
  const [lang, setLang] = useState(read("ts-lang", "en"));
  const [session, setSession] = useState(null),
    [state, setState] = useState(null);
  const branding = {
    logo: "/branding/shepards-logo.png",
    banner: "/branding/shepards-banner.png",
  };
  const [boot, setBoot] = useState(null),
    [bootError, setBootError] = useState("");
  const [page, setPage] = useState("dashboard"),
    [vehicleId, setVehicleId] = useState(null);
  const [modal, setModal] = useState(null),
    [toast, setToast] = useState(null);
  const [offline, setOffline] = useState(!navigator.onLine),
    [needsServer, setNeedsServer] = useState(native && !server);
  const dict = lang === "hi" ? hi : en;
  const t = (key) => dict[key] || en[key] || key;
  const n = (value) =>
    value === null || value === undefined
      ? "—"
      : Number(value).toLocaleString(lang === "hi" ? "hi-IN" : "en-IN");
  const date = displayDate;
  useEffect(() => {
    document.documentElement.lang = lang;
    store("ts-lang", lang);
  }, [lang]);
  useEffect(() => {
    if (!native) return;
    const listener = NativeApp.addListener("backButton", () => {
      if (modal) {
        document
          .querySelector("dialog[open]")
          ?.dispatchEvent(
            new Event("cancel", { cancelable: true, bubbles: true }),
          );
      } else if (vehicleId) {
        setVehicleId(null);
        setPage("vehicles");
      } else if (page !== "dashboard") setPage("dashboard");
      else NativeApp.exitApp();
    });
    return () => {
      listener.then((handle) => handle.remove());
    };
  }, [modal, vehicleId, page]);
  useEffect(() => {
    if (toast) {
      const id = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(id);
    }
  }, [toast]);
  function resetSession() {
    ++initVersion.current;
    store("ts-session", null);
    store("ts-state", null);
    store("ts-token", null);
    setSession(null);
    setState(null);
    stateRef.current = null;
    setModal(null);
    setPage("dashboard");
    setVehicleId(null);
  }
  function configureServer() {
    resetSession();
    setOffline(false);
    setBootError("");
    setNeedsServer(true);
  }
  function receiveState(data) {
    if (!stateRef.current || data.revision >= stateRef.current.revision) {
      stateRef.current = data;
      setState(data);
    }
  }
  async function initialize() {
    const version = ++initVersion.current;
    if (native && !server) return;
    setBootError("");
    try {
      const config = await request("/bootstrap");
      if (version !== initVersion.current) return;
      setBoot(config);
      setOffline(false);
      try {
        const s = await request("/me");
        const data = await request("/state");
        if (version !== initVersion.current) return;
        setSession(s);
        receiveState(data);
      } catch (e) {
        if (version !== initVersion.current) return;
        if (e.status === 401) resetSession();
        else throw e;
      }
    } catch (e) {
      if (version !== initVersion.current) return;
      setBootError(e.code);
      if (e.code === "notConnected") setOffline(true);
    }
  }
  useEffect(() => {
    if (!needsServer) initialize();
  }, [needsServer]);
  async function refresh() {
    const version = initVersion.current;
    try {
      const data = await request("/state");
      if (version !== initVersion.current) return null;
      receiveState(data);
      setOffline(false);
      setBootError("");
      return data;
    } catch (e) {
      if (version !== initVersion.current) return null;
      if (e.status === 401) {
        resetSession();
        setOffline(false);
        setToast({ text: t("unauthorized"), error: true });
      } else setOffline(true);
      return null;
    }
  }
  useEffect(() => {
    const online = () => {
      if (session) refresh();
      else initialize();
    };
    const off = () => {
      setOffline(true);
      setModal(null);
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", off);
    document.addEventListener("visibilitychange", online);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", off);
      document.removeEventListener("visibilitychange", online);
    };
  }, [session]);
  useEffect(() => {
    if (!session || offline) return;
    const controller = new AbortController();
    const version = initVersion.current;
    async function watch() {
      while (!controller.signal.aborted && version === initVersion.current) {
        try {
          const data = await request(
            `/updates?revision=${stateRef.current?.revision ?? 0}`,
            undefined,
            {
              signal: AbortSignal.any([
                controller.signal,
                AbortSignal.timeout(15000),
              ]),
            },
          );
          if (controller.signal.aborted || version !== initVersion.current)
            return;
          receiveState(data);
        } catch (e) {
          if (controller.signal.aborted || version !== initVersion.current)
            return;
          if (e.status === 401) {
            resetSession();
            setToast({ text: t("unauthorized"), error: true });
          } else {
            setOffline(true);
            setModal(null);
          }
          return;
        }
      }
    }
    watch();
    return () => controller.abort();
  }, [session, offline]);
  async function action(kind, payload) {
    if (offline) throw { code: "offlineHint" };
    try {
      const data = await request("/actions", {
        kind,
        payload,
        revision: stateRef.current.revision,
      });
      receiveState(data);
      setToast({ text: t("saved") });
      return data;
    } catch (e) {
      if (e.status === 409) await refresh();
      if (e.code === "notConnected") {
        setOffline(true);
        e.code = "connectionLost";
        await refresh();
      }
      if (e.status === 401) resetSession();
      throw e;
    }
  }
  function beginSharedAuth() {
    // A startup /me response must never overwrite a newer login attempt.
    return ++initVersion.current;
  }
  async function authenticated(data, version) {
    if (version !== initVersion.current) return;
    if (data.token) store("ts-token", data.token);
    let current;
    try {
      current = await request("/state");
    } catch (error) {
      if (version !== initVersion.current) return;
      store("ts-token", null);
      throw error;
    }
    if (version !== initVersion.current) return;
    const s = { user: data.user, fleetName: data.fleetName };
    setSession(s);
    receiveState(current);
    setOffline(false);
    setBootError("");
  }
  function navigate(target, id = null) {
    setPage(target);
    setVehicleId(id);
    window.scrollTo(0, 0);
  }
  async function logout() {
    try {
      await request("/logout", {});
      resetSession();
    } catch (e) {
      setToast({ text: t(e.code), error: true });
    }
  }
  const value = {
    lang,
    setLang,
    t,
    n,
    date,
    session,
    state,
    offline,
    refresh,
    action,
    navigate,
    setModal,
    setToast,
    logout,
    branding,
  };
  return (
    <Context.Provider value={value}>
      {offline || bootError ? (
        <div className="connection-page">
          <Brand />
          <LanguageSwitch />
          <WifiOff size={48} />
          <h1>
            {t(
              offline || bootError === "notConnected"
                ? "offlineHint"
                : bootError,
            )}
          </h1>
          <Button onClick={() => (session ? refresh() : initialize())}>
            {t("retry")}
          </Button>
          {native && (
            <button className="text-button" onClick={configureServer}>
              {t("changeServer")}
            </button>
          )}
        </div>
      ) : needsServer ? (
        <ServerConnect onConnect={() => setNeedsServer(false)} />
      ) : !boot || (session && !state) ? (
        <div className="connection-page">
          <Brand />
          <RefreshCw className="spin" />
          <p>{t("reconnecting")}</p>
        </div>
      ) : !session ? (
        <Auth
          boot={boot}
          onAuth={authenticated}
          onBeginAuth={beginSharedAuth}
          changeServer={configureServer}
        />
      ) : (
        <div className="app-shell">
          <aside className="sidebar" aria-label={t("app")} tabIndex={0}>
            <Brand />
            <Navigation page={page} navigate={navigate} />
            <div className="sidebar-bottom">
              <div className="support-mark">
                <ShieldCheck size={20} />
                <div>
                  <strong>{t("app")}</strong>
                  <span>{t("tagline")}</span>
                </div>
              </div>
              <button className="profile" onClick={() => navigate("settings")}>
                <span className="avatar">
                  {session.user.username.slice(0, 2).toUpperCase()}
                </span>
                <span>
                  <strong>{session.user.username}</strong>
                  <small>{t(session.user.role)}</small>
                </span>
                <Settings size={18} />
              </button>
            </div>
          </aside>
          <div className="main-shell">
            <header className="topbar">
              <div className="desktop-crumb">
                {session.fleetName}
                <ChevronRight size={14} />
                <strong>{t(page)}</strong>
              </div>
              <div className="mobile-brand">
                <Brand compact />
              </div>
              <div className="top-actions">
                <span className={`sync-status ${offline ? "offline" : ""}`}>
                  {offline ? (
                    <WifiOff size={14} />
                  ) : (
                    <span className="live-dot" />
                  )}
                  <span>{t(offline ? "offline" : "sync")}</span>
                </span>
                <LanguageSwitch />
                <button
                  className="icon-button mobile-settings"
                  aria-label={t("settings")}
                  onClick={() => navigate("settings")}
                >
                  <Settings size={21} />
                </button>
              </div>
            </header>
            <main>
              {page === "dashboard" ? (
                <Dashboard />
              ) : page === "vehicles" ? (
                vehicleId ? (
                  <VehicleDetail id={vehicleId} />
                ) : (
                  <Vehicles />
                )
              ) : page === "inventory" ? (
                <Inventory />
              ) : page === "logbook" ? (
                <Logbook />
              ) : page === "reports" ? (
                <Reports
                  key={vehicleId || "all"}
                  app={value}
                  initialVehicleId={vehicleId}
                  onExport={async (name, rows) => {
                    await downloadCsv(name, rows);
                    setToast({ text: t("exportDone") });
                  }}
                />
              ) : (
                <SettingsPage onChangeServer={configureServer} />
              )}
            </main>
            <footer className="page-footer">
              <CircleDot size={14} />
              {t("tagline")}
              <span>Shepards Tyre Management · v1.8.1</span>
            </footer>
          </div>
          <nav className="bottom-nav">
            <Navigation page={page} navigate={navigate} mobile />
          </nav>
        </div>
      )}
      {modal && !offline && !bootError && (
        <ModalContent modal={modal} onClose={() => setModal(null)} />
      )}
      {toast && (
        <div role="status" className={`toast ${toast.error ? "error" : ""}`}>
          {toast.error ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
          <span>{toast.text}</span>
          <button
            className="icon-button"
            aria-label={t("close")}
            onClick={() => setToast(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </Context.Provider>
  );
}
function Brand({ compact }) {
  return (
    <div className={`brand ${compact ? "compact" : ""}`}>
      <img
        className="company-logo"
        src="/branding/shepards-logo.png"
        alt="Shepards logo"
      />
      <div className="company-wordmark">
        <img src="/branding/shepards-banner.png" alt="Shepards" />
        <small>TYRE MANAGEMENT</small>
      </div>
    </div>
  );
}
function LanguageSwitch() {
  const { lang, setLang, t } = useApp();
  return (
    <button
      className="language-switch"
      aria-label={t("language")}
      onClick={() => setLang(lang === "en" ? "hi" : "en")}
    >
      <Globe size={16} />
      {lang === "en" ? "हिन्दी" : "English"}
    </button>
  );
}
const navItems = [
  { id: "dashboard", Icon: LayoutDashboard },
  { id: "vehicles", Icon: Truck },
  { id: "inventory", Icon: CircleDot },
  { id: "logbook", Icon: BookOpen },
  { id: "reports", Icon: BarChart3 },
  { id: "settings", Icon: Settings },
];
function Navigation({ page, navigate, mobile }) {
  const { t } = useApp();
  return (
    <nav
      className={mobile ? "mobile-nav-items" : "nav-items"}
      aria-label={t("navigation")}
    >
      {navItems
        .filter((item) => !mobile || item.id !== "settings")
        .map(({ id, Icon }) => (
          <button
            key={id}
            className={page === id ? "selected" : ""}
            onClick={() => navigate(id)}
          >
            <Icon size={20} />
            <span>{t(id)}</span>
            {!mobile && page === id && <span className="nav-indicator" />}
          </button>
        ))}
    </nav>
  );
}
function Button({ children, icon: Icon, secondary, className = "", ...props }) {
  return (
    <button
      className={`${secondary ? "secondary" : "primary"} ${className}`}
      {...props}
    >
      {Icon && <Icon size={17} />}
      <span>{children}</span>
    </button>
  );
}
function PageHeading({ title, sub, children, back }) {
  const { navigate, t } = useApp();
  return (
    <div className="page-heading">
      <div>
        {back && (
          <button
            className="text-button back-button"
            onClick={() => navigate("vehicles")}
          >
            ← {t("vehicles")}
          </button>
        )}
        <h1>{title}</h1>
        <p>{sub}</p>
      </div>
      <div className="heading-actions">{children}</div>
    </div>
  );
}
function Badge({ type, children }) {
  const { t } = useApp();
  return <span className={`badge badge-${type}`}>{children || t(type)}</span>;
}
function Empty({ icon: Icon = CircleDot, title, sub, children }) {
  const { t } = useApp();
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon size={30} />
      </span>
      <h3>{t(title)}</h3>
      {sub && <p>{t(sub)}</p>}
      {children}
    </div>
  );
}
function Field({ label, hint, children }) {
  const { t } = useApp();
  return (
    <label className="field">
      <span>{t(label)}</span>
      {children}
      {hint && <small>{t(hint)}</small>}
    </label>
  );
}
function PasswordField({
  label = "password",
  name = "password",
  autoComplete = "current-password",
  hint,
  minLength,
}) {
  const { t } = useApp();
  const [visible, setVisible] = useState(false);
  return (
    <Field label={label} hint={hint}>
      <div className="password-input">
        <input
          required
          name={name}
          minLength={minLength}
          maxLength={128}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
        />
        <button
          type="button"
          aria-label={t(visible ? "hidePassword" : "showPassword")}
          onClick={() => setVisible(!visible)}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
    </Field>
  );
}
function ForgotLogin() {
  const { t } = useApp();
  const [show, setShow] = useState(false);
  return (
    <div className="login-help">
      <button
        type="button"
        className="text-button"
        onClick={() => setShow(!show)}
      >
        {t("forgotLogin")}
      </button>
      {show && <p role="status">{t("contactAdmin")}</p>}
    </div>
  );
}
function ServerConnect({ onConnect }) {
  const { t } = useApp();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    const input = new FormData(e.currentTarget).get("server").trim();
    let url;
    try {
      url = new URL(input);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash ||
        url.hostname === "localhost"
      )
        throw Error();
    } catch {
      setError("httpsRequired");
      return;
    }
    setBusy(true);
    const old = server;
    server = url.origin;
    try {
      await request("/bootstrap");
      store("ts-server", server);
      onConnect();
    } catch {
      server = old;
      setError("notConnected");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page connect-page">
      <section className="auth-card">
        <div className="auth-top">
          <Brand />
          <LanguageSwitch />
        </div>
        <span className="empty-icon">
          <Link size={30} />
        </span>
        <h1>{t("serverAddress")}</h1>
        <p>{t("nativeIntro")}</p>
        <form onSubmit={submit}>
          <Field label="serverAddress" hint="serverHint">
            <input
              name="server"
              type="url"
              placeholder="https://tyres.example.com"
              required
              defaultValue={server}
            />
          </Field>
          {error && (
            <div role="alert" className="form-error">
              {t(error)}
            </div>
          )}
          <Button disabled={busy} icon={ArrowRight}>
            {t(busy ? "loading" : "connect")}
          </Button>
        </form>
      </section>
    </div>
  );
}
function Auth({ boot, onAuth, onBeginAuth, changeServer }) {
  const { t, branding } = useApp();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setError("");
    const p = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    try {
      const version = onBeginAuth();
      const data = await request("/login", p);
      await onAuth(data, version);
    } catch (e) {
      setError(e.code === "notConnected" ? "offlineHint" : e.code);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <section className="auth-story">
        <Brand />
        <div className="story-main">
          <span className="eyebrow">YOUR FLEET. IN SYNC.</span>
          <h1>{t("welcome")}</h1>
          <p>{t("welcomeSub")}</p>
          <div className="story-illustration">
            <div className="tyre-art">
              <CircleDot />
            </div>
            <span className="floating-stock">
              <Package size={20} />
              {t("garage")}
              <CheckCircle2 size={18} />
            </span>
            <span className="floating-truck">
              <Truck size={20} />
              {t("ready")}
            </span>
          </div>
          <div className="feature-list">
            {["feature1", "feature2", "feature3"].map((k) => (
              <div key={k}>
                <CheckCircle2 size={18} />
                {t(k)}
              </div>
            ))}
          </div>
        </div>
        <small>Shepards Tyre Management · {t("tagline")}</small>
      </section>
      <section className="auth-form-side">
        <div className="auth-top">
          <div className="mobile-brand">
            <Brand compact />
          </div>
          <LanguageSwitch />
        </div>
        <div className="auth-card">
          {branding.banner && (
            <img
              className="company-banner-login"
              src={branding.banner}
              alt="Shepards company banner"
            />
          )}
          <span className="eyebrow">SHEPARDS TYRE MANAGEMENT</span>
          <h1>{t("loginTitle")}</h1>
          <p>{t("loginSub")}</p>
          <form onSubmit={submit}>
            <Field label="username" hint="usernameHint">
              <input
                name="username"
                defaultValue={defaultUsername}
                required
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck="false"
                autoComplete="username"
                pattern="[a-zA-Z0-9_.\-]{3,40}"
                maxLength={40}
              />
            </Field>
            <PasswordField />
            <ForgotLogin />
            {error && (
              <div role="alert" className="form-error">
                <AlertCircle size={18} />
                {t(error)}
              </div>
            )}
            <Button icon={ArrowRight} disabled={busy}>
              {t(busy ? "loading" : "submitLogin")}
            </Button>
          </form>
          <div className="auth-foot">
            <ShieldCheck size={15} />
            <span>{t("privacy")}</span>
          </div>
          {native && (
            <button className="text-button" onClick={changeServer}>
              {t("changeServer")}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
function Dashboard() {
  const { t, n, state, session, date, navigate, setModal, offline } = useApp();
  const [day, setDay] = useState(dayKey());
  const counts = tally(state),
    daily = day ? dailyTally(state, day) : {};
  const fleet = activeVehicles(state);
  const emptySlots = fleet.reduce(
    (sum, v) =>
      sum +
      18 -
      state.tyres.filter(
        (t) =>
          t.vehicleId === v.id && t.status === "installed" && t.slot !== "SP",
      ).length,
    0,
  );
  return (
    <>
      <PageHeading title={t("fleetOverview")} sub={t("dashboardSub")}>
        {session.user.role === "owner" && (
          <Button
            secondary
            icon={Plus}
            onClick={() => setModal({ type: "addVehicle" })}
            disabled={offline}
          >
            {t("addVehicle")}
          </Button>
        )}
        <Button
          icon={Plus}
          onClick={() => setModal({ type: "addTyre" })}
          disabled={offline}
        >
          {t("addTyre")}
        </Button>
      </PageHeading>
      <MaintenanceReminders />
      <section className="stats-grid">
        {[
          {
            key: "total",
            value: counts.total,
            Icon: CircleDot,
            style: "green",
          },
          {
            key: "installed",
            value: counts.installed,
            Icon: Truck,
            style: "blue",
          },
          { key: "stock", value: counts.stock, Icon: Package, style: "amber" },
          {
            key: "fleet",
            value: fleet.length,
            Icon: Gauge,
            style: "purple",
          },
        ].map(({ key, value, Icon, style }) => (
          <button
            className="stat-card"
            key={key}
            onClick={() => navigate(key === "fleet" ? "vehicles" : "inventory")}
          >
            <div>
              <span className="stat-label">{t(key)}</span>
              <strong>{n(value)}</strong>
              <span className="stat-foot">
                {key === "fleet"
                  ? `18 + ${t("spare")}`
                  : t(
                      key === "stock"
                        ? "stockAvailable"
                        : key === "installed"
                          ? "installedHint"
                          : "tagline",
                    )}
              </span>
            </div>
            <span className={`stat-icon ${style}`}>
              <Icon size={23} />
            </span>
          </button>
        ))}
      </section>
      <div className="dashboard-columns">
        <section className="daily-card">
          <div className="card-title-row">
            <div>
              <span className="eyebrow light">{t("logbook")}</span>
              <h2>{t("dailyTally")}</h2>
            </div>
            <CalendarDays size={27} />
          </div>
          <p>{t("dailySub")}</p>
          <div className="date-control">
            <DateField
              label={t("date")}
              value={day}
              max={dayKey()}
              onChange={setDay}
              required
              errorText={t("invalidDate")}
            />
            <span>{day === dayKey() ? t("today") : date(day)}</span>
          </div>
          <div className="daily-numbers">
            {[
              ["tallyTotal", "total"],
              ["tallyInstalled", "installed"],
              ["tallyStock", "stock"],
            ].map(([label, key]) => (
              <div key={key}>
                <strong>{n(daily[key])}</strong>
                <span>{t(label)}</span>
              </div>
            ))}
          </div>
          <div className="daily-foot">
            <span>
              <i />
              {n(state.events.filter((e) => e.date === day).length)}{" "}
              {t("dailyMovements")}
            </span>
            <span>
              {t("remolding")}: {n(daily.remolding ?? 0)}
            </span>
            <span>
              {t("tallyScrapped")}: {n(daily.scrapped ?? 0)}
            </span>
            <span>
              {t("sold")}: {n(daily.sold ?? 0)}
            </span>
          </div>
        </section>
        <section className="card stock-mix">
          <div className="card-title-row">
            <div>
              <h2>{t("stockMix")}</h2>
              <p>{t("stockSub")}</p>
            </div>
            <Package size={22} />
          </div>
          <div className="stock-total">
            <strong>{n(counts.stock)}</strong>
            <span>{t("stockTotal")}</span>
          </div>
          <div className="stock-bar">
            {["new", "used", "remold"].map((type) => (
              <div
                key={type}
                className={`bar-${type}`}
                style={{
                  width: `${counts.stock ? (counts[type] / counts.stock) * 100 : 0}%`,
                }}
              />
            ))}
          </div>
          <div className="stock-legend">
            {["new", "used", "remold"].map((type) => (
              <div key={type}>
                <span>
                  <i className={`dot-${type}`} />
                  {t(type)}
                </span>
                <strong>{n(counts[type])}</strong>
              </div>
            ))}
          </div>
          <p className="small muted">{t("aboutTally")}</p>
        </section>
      </div>
      {!state.tyres.length && !fleet.length && (
        <section className="start-guide">
          <div>
            <span className="empty-icon">
              <Wrench size={24} />
            </span>
            <div>
              <h3>{t("guide")}</h3>
              <p>{t("guideSub")}</p>
            </div>
          </div>
          <div className="guide-steps">
            {["step1", "step2", "step3"].map((k, i) => (
              <span key={k}>
                <b>{i + 1}</b>
                {t(k)}
              </span>
            ))}
          </div>
        </section>
      )}
      <div className="dashboard-columns lower">
        <section className="card activity-card">
          <div className="card-title-row">
            <h2>{t("recentActivity")}</h2>
            <button className="text-button" onClick={() => navigate("logbook")}>
              {t("viewAll")}
              <ArrowUpRight size={16} />
            </button>
          </div>
          {!state.events.length ? (
            <Empty title="noActivity" sub="noActivitySub" icon={BookOpen} />
          ) : (
            <div className="activity-list">
              {state.events
                .slice(-5)
                .reverse()
                .map((e) => (
                  <Activity key={e.id} event={e} />
                ))}
            </div>
          )}
        </section>
        <section className="card fleet-card">
          <div className="card-title-row">
            <h2>{t("fleetStatus")}</h2>
            <button
              className="text-button"
              onClick={() => navigate("vehicles")}
            >
              {t("viewAll")}
              <ArrowUpRight size={16} />
            </button>
          </div>
          {!fleet.length ? (
            <Empty title="noVehicles" icon={Truck} />
          ) : (
            <>
              <div className={`fleet-alert ${!emptySlots ? "complete" : ""}`}>
                {emptySlots ? (
                  <AlertCircle size={20} />
                ) : (
                  <CheckCircle2 size={20} />
                )}
                <div>
                  <strong>{n(emptySlots)}</strong>
                  <span>{t("positionsOpen")}</span>
                </div>
              </div>
              {fleet.slice(0, 3).map((v) => {
                const fitted = state.tyres.filter(
                  (t) => t.vehicleId === v.id && t.slot !== "SP",
                ).length;
                return (
                  <button
                    className="fleet-row"
                    key={v.id}
                    onClick={() => navigate("vehicles", v.id)}
                  >
                    <span className="vehicle-icon">
                      <Truck size={20} />
                    </span>
                    <span>
                      <strong>{v.registration}</strong>
                      <small>
                        {n(fitted)} / 18 {t("roadTyres")}
                      </small>
                    </span>
                    <div className="mini-progress">
                      <i style={{ width: `${(fitted / 18) * 100}%` }} />
                    </div>
                    <ChevronRight size={17} />
                  </button>
                );
              })}
            </>
          )}
        </section>
      </div>
    </>
  );
}
function Activity({ event: e }) {
  const { t, date, n, state } = useApp();
  const Icon =
    e.kind === "fit"
      ? ArrowUpRight
      : e.kind === "remove"
        ? ArrowDownLeft
        : e.kind === "addVehicle"
          ? Truck
          : e.kind === "updateOdometer"
            ? Gauge
            : e.kind === "scrap"
              ? Trash2
              : e.kind === "remold"
                ? RefreshCw
                : Plus;
  return (
    <div className="activity-row">
      <span className={`activity-icon activity-${e.kind}`}>
        <Icon size={18} />
      </span>
      <div>
        <strong>{t(`move_${e.kind}`)}</strong>
        <span>
          {[e.tyre, e.vehicle, positionLabel(e.slot)]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <small>
          {e.actor} · {date(e.timestamp, true)}
        </small>
        {e.destination && (
          <p className="activity-note">
            {t("destination")}:{" "}
            {t(e.destination === "stock" ? "garage" : e.destination)}
          </p>
        )}
        {e.runningKm !== undefined && (
          <p className="activity-note">
            {t("runningKm")}: {n(e.runningKm)} {t("km")} · {t("currentKm")}:{" "}
            {n(e.totalKm)} {t("km")}
          </p>
        )}
        {e.odometer !== undefined && (
          <p className="activity-note">
            {t("odometer")}: {n(e.odometer)}
          </p>
        )}
        {e.scrapReason && (
          <p className="activity-note">
            {t("scrapReason")}: {t(`reason_${e.scrapReason}`)}
            {e.scrapDetail ? ` · ${e.scrapDetail}` : ""}
          </p>
        )}
        {e.tyre && stateBrand(e, state) && (
          <BrandMark brand={stateBrand(e, state)} />
        )}
        {e.kind === "changeDriver" && (
          <p className="activity-note">
            {e.fromDriverName || t("notRecorded")} → {e.driverName} ·{" "}
            {t("driverReminder")}
          </p>
        )}
        {e.inspectedOn && (
          <p className="activity-note">
            {t("inspectedOn")}: {date(e.inspectedOn)} ·{" "}
            {t(e.allTyresChecked ? "allTyresChecked" : "partialCheck")}
            {e.driverCheckCompleted ? ` · ${t("driverCheckDone")}` : ""}
          </p>
        )}
        {(e.findings || []).map((f, i) => (
          <p className="activity-note" key={`f${i}`}>
            {positionLabel(f.slot)} · {f.tyre || "—"} · {t(`issue_${f.issue}`)}
            {f.detail ? ` · ${f.detail}` : ""}
          </p>
        ))}
        {e.measuredOn && (
          <p className="activity-note">
            {t("measuredOn")}: {date(e.measuredOn)}
          </p>
        )}
        {(e.nsdMeasurements || []).map((m, i) => (
          <p className="activity-note" key={`n${i}`}>
            {m.tyre} · {t("nsd")}: {averageNsd(m)}%
          </p>
        ))}
        {e.vendor && (
          <p className="activity-note">
            {t("remoldVendor")}: {e.vendor}
          </p>
        )}
        {e.tyreCount !== undefined && (
          <p className="activity-note">
            {n(e.tyreCount)} {t("tyresIncluded")}
          </p>
        )}
        {e.note && <p className="activity-note">{e.note}</p>}
      </div>
    </div>
  );
}
function Vehicles() {
  const { t, n, date, state, navigate, setModal, offline, session } = useApp();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("active");
  const scope = state.vehicles.filter((v) =>
    status === "sold" ? v.status === "sold" : v.status !== "sold",
  );
  const vehicles = scope.filter((v) =>
    `${v.registration} ${v.name} ${v.driverName || ""} ${v.emissionClass || ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <>
      <PageHeading title={t("vehicles")} sub={t("noVehiclesSub")}>
        {session.user.role === "owner" && (
          <>
            {" "}
            <Button
              secondary
              icon={Upload}
              disabled={offline}
              onClick={() => setModal({ type: "importVehicles" })}
            >
              {t("importVehicles")}
            </Button>
            <Button
              icon={Plus}
              disabled={offline}
              onClick={() => setModal({ type: "addVehicle" })}
            >
              {t("addVehicle")}
            </Button>
          </>
        )}
      </PageHeading>
      <div
        className="vehicle-tabs tabs"
        role="group"
        aria-label={t("vehicleStatus")}
      >
        {["active", "sold"].map((k) => (
          <button
            key={k}
            className={status === k ? "selected" : ""}
            onClick={() => setStatus(k)}
          >
            {t(k === "active" ? "activeVehicles" : "soldVehicles")}
            <span>
              {n(
                state.vehicles.filter((v) =>
                  k === "sold" ? v.status === "sold" : v.status !== "sold",
                ).length,
              )}
            </span>
          </button>
        ))}
      </div>
      <div className="toolbar">
        <SearchInput
          placeholder="searchVehicles"
          value={query}
          onChange={setQuery}
        />
        <span className="muted small">
          {n(scope.length)}{" "}
          {t(status === "sold" ? "soldVehicles" : "activeVehicles")}
        </span>
      </div>
      {!vehicles.length ? (
        <section className="card">
          <Empty
            icon={Truck}
            title={query || status === "sold" ? "noResults" : "noVehicles"}
            sub={query || status === "sold" ? "noResultsSub" : "noVehiclesSub"}
          />
        </section>
      ) : (
        <div className="vehicle-grid">
          {vehicles.map((v) => {
            const tyres = state.tyres.filter((t) => t.vehicleId === v.id);
            const road = tyres.filter((t) => t.slot !== "SP").length;
            return (
              <button
                className="card vehicle-card"
                key={v.id}
                onClick={() => navigate("vehicles", v.id)}
              >
                <div className="card-title-row">
                  <span className="vehicle-icon large">
                    <Truck size={28} />
                  </span>
                  <ChevronRight size={21} />
                </div>
                <h2>{v.registration}</h2>
                <p>
                  {[v.name, v.driverName, v.emissionClass]
                    .filter(Boolean)
                    .join(" · ") || t("vehicle")}
                </p>
                <p className="small muted">
                  {t("lastInspected")}:{" "}
                  {v.lastInspectedOn
                    ? date(v.lastInspectedOn)
                    : t("notInspected")}
                </p>
                {v.pendingTyreCheck && (
                  <span className="reminder-pill">
                    {t("driverCheckPending")}
                  </span>
                )}
                {v.status === "sold" ? (
                  <p className="vehicle-sale-stamp">
                    {t("vehicleSold")}: {date(v.soldAt)} · {v.soldBy}
                  </p>
                ) : (
                  <>
                    <div className="vehicle-progress">
                      <span>{t("roadTyres")}</span>
                      <strong>{n(road)} / 18</strong>
                      <div>
                        <i style={{ width: `${(road / 18) * 100}%` }} />
                      </div>
                    </div>
                  </>
                )}
                <div className="vehicle-meta">
                  <span>
                    <Gauge size={16} />
                    {n(v.odometer)} {t("km")}
                  </span>
                  <span>
                    {t("spare")}:{" "}
                    {v.hasSpare
                      ? `${v.status === "sold" ? (state.tyres.some((t) => t.soldWithVehicleId === v.id && t.soldSlot === "SP") ? 1 : 0) : tyres.some((t) => t.slot === "SP") ? 1 : 0}/1`
                      : "—"}
                  </span>
                </div>
                {v.status !== "sold" && (
                  <span
                    className={`vehicle-readiness ${road === 18 ? "complete" : ""}`}
                  >
                    {road === 18 ? (
                      <CheckCircle2 size={14} />
                    ) : (
                      <AlertCircle size={14} />
                    )}{" "}
                    {road === 18
                      ? t("full")
                      : `${n(18 - road)} ${t("positionsOpen")}`}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
function VehicleDetail({ id }) {
  const { t, n, date, state, setModal, offline, navigate, session } = useApp();
  const v = state.vehicles.find((v) => v.id === id);
  if (!v) return null;
  const sold = v.status === "sold";
  const tyres = sold
    ? state.tyres
        .filter((t) => t.soldWithVehicleId === v.id)
        .map((t) => ({ ...t, slot: t.soldSlot }))
    : state.tyres.filter((t) => t.vehicleId === id);
  const count = tyres.filter((t) => t.slot !== "SP").length;
  const inspection = lastInspection(state, v);
  const history = vehicleEvents(state, v);
  const dueNsd = tyres.filter(
    (t) => !sold && t.nextNsdCheckOn && t.nextNsdCheckOn <= dayKey(),
  );
  const mapTileWidth = Math.max(
    112,
    ...tyres.map((tyre) => String(tyre.serial).length * 7.3 + 20),
  );
  function wheel(slot) {
    const tyre = tyres.find((t) => t.slot === slot);
    return (
      <button
        key={slot}
        aria-label={`${positionLabel(slot)} · ${tyre?.serial || t("empty")}`}
        className={`wheel ${tyre ? `wheel-${tyre.type}` : "wheel-empty"}`}
        onClick={() =>
          setModal(
            tyre
              ? { type: "tyre", id: tyre.id }
              : { type: "fit", vehicleId: id, slot },
          )
        }
        disabled={!tyre && (offline || sold)}
      >
        <span className="tread-line" />
        {tyre ? (
          <BrandMark brand={tyre.brand} compact />
        ) : (
          <CircleDot size={22} />
        )}
        <strong>{positionLabel(slot)}</strong>
        <small className="tyre-serial">{tyre?.serial || "+"}</small>
      </button>
    );
  }
  return (
    <>
      <PageHeading
        title={v.registration}
        sub={
          [v.name, v.emissionClass, v.driverName].filter(Boolean).join(" · ") ||
          t("slotHint")
        }
        back
      >
        {!sold && (
          <>
            <Button
              secondary
              icon={UserRound}
              disabled={offline || sold}
              onClick={() => setModal({ type: "changeDriver", vehicleId: id })}
            >
              {t("changeDriver")}
            </Button>
            <Button
              icon={ClipboardCheck}
              disabled={offline || sold}
              onClick={() =>
                setModal({ type: "inspectVehicle", vehicleId: id })
              }
            >
              {t("inspectVehicle")}
            </Button>
          </>
        )}
        <Button
          secondary
          icon={BarChart3}
          onClick={() => navigate("reports", id)}
        >
          {t("vehicleReport")}
        </Button>
        {!sold && (
          <>
            <Button
              secondary
              icon={Gauge}
              disabled={offline || sold}
              onClick={() =>
                setModal({ type: "updateOdometer", vehicleId: id })
              }
            >
              {t("updateOdometer")}
            </Button>
            {session.user.role === "owner" && (
              <Button
                secondary
                className="vehicle-sale-button"
                disabled={offline}
                onClick={() => setModal({ type: "sellVehicle", vehicleId: id })}
              >
                {t("vehicleSold")}
              </Button>
            )}
          </>
        )}
      </PageHeading>
      {sold && (
        <section className="sale-record">
          <strong>{t("vehicleSold")}</strong>
          <p>
            {date(v.soldAt, true)} · {v.soldBy}
          </p>
          <p>{t("soldVehicleReadOnly")}</p>
          {v.saleNote && <p>{v.saleNote}</p>}
        </section>
      )}
      {v.pendingTyreCheck && (
        <div className="maintenance-notice">
          <AlertCircle size={20} />
          <div>
            <strong>{t("driverReminder")}</strong>
            <p>{t("advisoryOnly")}</p>
          </div>
          <Button
            secondary
            onClick={() => setModal({ type: "inspectVehicle", vehicleId: id })}
          >
            {t("checkTyres")}
          </Button>
        </div>
      )}
      {!!dueNsd.length && (
        <p className="maintenance-notice">
          {t("nsdDue")}: {dueNsd.map((t) => t.serial).join(", ")} ·{" "}
          {t("advisoryOnly")}
        </p>
      )}
      <div className="vehicle-detail-columns">
        <section className="card wheel-map">
          <div className="card-title-row">
            <div>
              <h2>{t("road")}</h2>
              <p>{t("slotHint")}</p>
            </div>
            <Badge type={count === 18 ? "new" : "used"}>
              {sold ? t("sold") : `${n(count)} / 18`}
            </Badge>
          </div>
          <p className="map-scroll-hint">{t("mapPanHint")}</p>
          <div
            className="tyre-map-scroll"
            tabIndex={0}
            role="region"
            aria-label={t("road")}
          >
            <div
              className="truck-map"
              style={{ "--wheel-width": `${mapTileWidth}px` }}
            >
              <div className="truck-cab">
                <Truck size={28} />
                <span>{t("front")}</span>
              </div>
              <div className="wheel-sides">
                <span>{t("left")}</span>
                <span>{t("right")}</span>
              </div>
              <section
                className="tyre-section horse-section"
                aria-label={t("horseUnit")}
              >
                <h3>
                  {t("horseUnit")}
                  <span>{t("positions")} 1–6</span>
                </h3>
                <div className="axle-row front-axle">
                  {wheel("FL")}
                  <span className="axle-label" aria-hidden="true" />
                  {wheel("FR")}
                </div>
                <div className="axle-row">
                  <div>
                    {wheel("2LO")}
                    {wheel("2LI")}
                  </div>
                  <span className="axle-label" aria-hidden="true" />
                  <div>
                    {wheel("2RI")}
                    {wheel("2RO")}
                  </div>
                </div>
              </section>
              <section
                className="tyre-section trolley-section"
                aria-label={t("trolleyUnit")}
              >
                <h3>
                  {t("trolleyUnit")}
                  <span>{t("positions")} 7–18</span>
                </h3>
                {[3, 4, 5].map((a) => (
                  <div className="axle-row" key={a}>
                    <div>
                      {wheel(`${a}LO`)}
                      {wheel(`${a}LI`)}
                    </div>
                    <span className="axle-label" aria-hidden="true" />
                    <div>
                      {wheel(`${a}RI`)}
                      {wheel(`${a}RO`)}
                    </div>
                  </div>
                ))}
              </section>
              <div className="spare-position">
                <span>{t("spare")}</span>
                {v.hasSpare ? wheel("SP") : <small>{t("noSpare")}</small>}
              </div>
            </div>
          </div>
          <div className="map-legend">
            {["new", "used", "remold", "empty"].map((type) => (
              <span key={type}>
                <i className={`dot-${type}`} />
                {t(type)}
              </span>
            ))}
          </div>
        </section>
        <div className="vehicle-side">
          <section className="card vehicle-inspection-summary">
            <h2>{t("inspectionSummary")}</h2>
            <p>
              {t("lastInspected")}:{" "}
              <strong>
                {inspection ? date(inspection.inspectedOn) : t("notInspected")}
              </strong>
            </p>
            <p>
              {t("driverName")}: {v.driverName || t("notRecorded")}
            </p>
            <p>
              {t("vehicleClass")}: {v.emissionClass || t("notRecorded")}
            </p>
            <div className="inspection-counters">
              <span>
                {t("fitments")}:{" "}
                <strong>
                  {n(history.filter((e) => e.kind === "fit").length)}
                </strong>
              </span>
              <span>
                {t("inspections")}:{" "}
                <strong>
                  {n(history.filter((e) => e.kind === "inspectVehicle").length)}
                </strong>
              </span>
            </div>
            {inspection && (
              <>
                <p>
                  {t(
                    inspection.allTyresChecked
                      ? "allTyresChecked"
                      : "partialCheck",
                  )}{" "}
                  · {inspection.actor}
                </p>
                {inspection.findings.length ? (
                  inspection.findings.map((f, i) => (
                    <p key={i}>
                      {positionLabel(f.slot)} · {t(`issue_${f.issue}`)}{" "}
                      {f.detail}
                    </p>
                  ))
                ) : (
                  <p className="small muted">{t("noIssuesRecorded")}</p>
                )}
              </>
            )}
          </section>
          <section className="card vehicle-summary">
            <span className="stat-icon green">
              <Gauge size={24} />
            </span>
            <h2>
              {n(v.odometer)} <small>{t("km")}</small>
            </h2>
            <p>{t("odometer")}</p>
            <hr />
            <div>
              <span>{t("roadTyres")}</span>
              <strong>{n(count)} / 18</strong>
            </div>
            <div>
              <span>{t("spare")}</span>
              <strong>
                {v.hasSpare
                  ? `${tyres.some((t) => t.slot === "SP") ? 1 : 0} / 1`
                  : "—"}
              </strong>
            </div>
            <p className="small muted">{t("distanceHint")}</p>
          </section>
          <section className="card">
            <h2>{t("tyreHistory")}</h2>
            {state.events
              .filter((e) => e.vehicle === v.registration)
              .slice(-8)
              .reverse()
              .map((e) => (
                <Activity key={e.id} event={e} />
              ))}
          </section>
        </div>
      </div>
    </>
  );
}
function SearchInput({ placeholder, value, onChange }) {
  const { t } = useApp();
  return (
    <label className="search-input">
      <Search size={18} />
      <input
        aria-label={t(placeholder)}
        placeholder={t(placeholder)}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          className="icon-button"
          aria-label={t("close")}
          onClick={() => onChange("")}
        >
          <X size={15} />
        </button>
      )}
    </label>
  );
}
function Inventory() {
  const { t, n, state, setModal, offline } = useApp();
  const [status, setStatus] = useState("all"),
    [type, setType] = useState("all"),
    [query, setQuery] = useState("");
  const tyres = state.tyres.filter(
    (tyre) =>
      (status === "all"
        ? !["sold", "scrapped"].includes(tyre.status)
        : tyre.status === status) &&
      (type === "all" || tyre.type === type) &&
      `${tyre.serial} ${tyre.brand} ${tyre.construction || ""} ${state.vehicles.find((v) => v.id === tyre.vehicleId)?.registration || ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <>
      <PageHeading title={t("inventory")} sub={t("aboutTally")}>
        <Button
          secondary
          icon={Upload}
          disabled={offline}
          onClick={() => setModal({ type: "importTyres" })}
        >
          {t("importTyres")}
        </Button>
        <Button
          icon={Plus}
          disabled={offline}
          onClick={() => setModal({ type: "addTyre" })}
        >
          {t("addTyre")}
        </Button>
      </PageHeading>
      <section className="card inventory-card">
        <div className="tabs">
          {[
            ["all", "total"],
            ["stock", "garage"],
            ["installed", "onRoad"],
            ["remolding", "remolding"],
            ["scrapped", "scrapped"],
            ["sold", "sold"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={status === key ? "selected" : ""}
              onClick={() => setStatus(key)}
            >
              {t(label)}
              <span>
                {n(
                  state.tyres.filter((t) =>
                    key === "all"
                      ? !["sold", "scrapped"].includes(t.status)
                      : t.status === key,
                  ).length,
                )}
              </span>
            </button>
          ))}
        </div>
        <div className="inventory-toolbar">
          <SearchInput placeholder="search" value={query} onChange={setQuery} />
          <div className="filter-chips">
            {["all", "new", "used", "remold"].map((key) => (
              <button
                key={key}
                className={type === key ? "selected" : ""}
                onClick={() => setType(key)}
              >
                {t(key)}
              </button>
            ))}
          </div>
        </div>
        {!tyres.length ? (
          <Empty
            title={state.tyres.length ? "noResults" : "noTyres"}
            sub={state.tyres.length ? "noResultsSub" : "noTyresSub"}
          />
        ) : (
          <div className="tyre-list">
            {tyres.map((tyre) => {
              const v = state.vehicles.find((v) => v.id === tyre.vehicleId);
              return (
                <button
                  className="tyre-row"
                  key={tyre.id}
                  onClick={() => setModal({ type: "tyre", id: tyre.id })}
                >
                  <span className="tyre-card-top">
                    <strong className="tyre-card-id">{tyre.serial}</strong>
                    <ChevronRight size={18} />
                  </span>
                  <span className="tyre-card-brand">
                    <BrandMark brand={tyre.brand} />
                  </span>
                  <span className="tyre-card-tags">
                    <TyreTags tyre={tyre} />
                  </span>
                  <span className="tyre-card-footer">
                    <span className="tyre-card-assignment">
                      {v
                        ? `${v.registration} · ${t("position")} ${positionLabel(tyre.slot)}`
                        : tyre.soldVehicle
                          ? `${t("withVehicle")}: ${tyre.soldVehicle}`
                          : t("currentKm")}
                    </span>
                    <span className="tyre-card-distance">
                      {n(tyreKm(tyre, state))} <small>{t("km")}</small>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
async function download(name, content, type) {
  return downloadBlob(name, new Blob([content], { type }));
}
async function downloadBlob(name, blob) {
  if (native) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import("@capacitor/filesystem"),
      import("@capacitor/share"),
    ]);
    const encoded = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    const file = await Filesystem.writeFile({
      path: name,
      data: encoded,
      directory: Directory.Cache,
    });
    await Share.share({ title: name, url: file.uri });
    return;
  }
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function Logbook() {
  const { t, state, n, date, setToast } = useApp();
  const [query, setQuery] = useState(""),
    [day, setDay] = useState("");
  const events = state.events
    .filter(
      (e) =>
        day !== null &&
        (!day || e.date === day) &&
        `${e.tyre || ""} ${e.vehicle || ""} ${e.actor} ${e.note} ${e.vendor || ""} ${e.driverName || ""} ${(e.findings || []).map((f) => `${f.tyre || ""} ${t(`issue_${f.issue}`)} ${f.detail || ""}`).join(" ")} ${(e.nsdMeasurements || []).map((m) => m.tyre).join(" ")} ${e.scrapReason ? t(`reason_${e.scrapReason}`) : ""} ${e.scrapDetail || ""} ${t("move_" + e.kind)}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .reverse();
  async function exportCsv() {
    const cell = (v) =>
      `"${String(v ?? "")
        .replace(/^[=+@\-\t\r]/, "'$&")
        .replaceAll('"', '""')}"`;
    const rows = [
      [
        "Date (IST)",
        "Date/time (IST)",
        "Movement",
        "Tyre",
        "Vehicle",
        "Position",
        "Odometer",
        "Fitted odometer",
        "Km since fitting",
        "Total tyre km",
        "Destination",
        "Scrap reason",
        "Other reason",
        "Staff",
        "Remold vendor",
        "Note",
        "Inspected on",
        "Driver",
        "All tyres checked",
        "Inspection findings",
        "Average NSD (%)",
      ],
      ...events.map((e) => [
        date(e.date),
        date(e.timestamp, true),
        t("move_" + e.kind),
        e.tyre,
        e.vehicle,
        positionLabel(e.slot),
        e.odometer,
        e.fittedOdometer,
        e.runningKm,
        e.totalKm,
        e.destination
          ? t(e.destination === "stock" ? "garage" : e.destination)
          : "",
        e.scrapReason ? t(`reason_${e.scrapReason}`) : "",
        e.scrapDetail,
        e.actor,
        e.vendor,
        e.note,
        e.inspectedOn ? date(e.inspectedOn) : "",
        e.driverName,
        e.allTyresChecked === undefined
          ? ""
          : t(e.allTyresChecked ? "yes" : "no"),
        (e.findings || [])
          .map(
            (f) =>
              `${positionLabel(f.slot)}: ${t(`issue_${f.issue}`)} ${f.detail}`,
          )
          .join("; "),
        (e.nsdMeasurements || [])
          .map((m) => `${m.tyre}: ${averageNsd(m)}%`)
          .join("; "),
      ]),
    ];
    await download(
      `Shepards Tyre Management-log-${day || dayKey()}.csv`,
      "\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n"),
      "text/csv;charset=utf-8",
    );
    setToast({ text: t("exportDone") });
  }
  return (
    <>
      <PageHeading title={t("dailyLog")} sub={t("logSub")}>
        <Button
          secondary
          icon={Download}
          onClick={() =>
            exportCsv().catch(() =>
              setToast({ text: t("serverError"), error: true }),
            )
          }
          disabled={!events.length}
        >
          {t("exportCsv")}
        </Button>
      </PageHeading>
      <section className="card">
        <div className="log-toolbar">
          <SearchInput
            placeholder="searchLog"
            value={query}
            onChange={setQuery}
          />
          <div className="log-date">
            <CalendarDays size={17} />
            <DateField
              label={t("date")}
              value={day}
              max={dayKey()}
              onChange={setDay}
              errorText={t("invalidDate")}
            />
            {day ? (
              <button
                className="icon-button"
                aria-label={t("clearDate")}
                onClick={() => setDay("")}
              >
                <X size={16} />
              </button>
            ) : (
              <span>{t("allDates")}</span>
            )}
          </div>
        </div>
        <div className="log-summary">
          <span>
            {n(events.length)} {t("activity")}
          </span>
          <span>{day ? date(day) : t("allDates")}</span>
        </div>
        {!events.length ? (
          <Empty icon={BookOpen} title="emptyLog" />
        ) : (
          <div className="log-list">
            {events.map((e) => (
              <Activity key={e.id} event={e} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
function SettingsPage({ onChangeServer }) {
  const {
    t,
    session,
    state,
    setModal,
    setToast,
    lang,
    setLang,
    logout,
    offline,
  } = useApp();
  const [team, setTeam] = useState([]),
    [error, setError] = useState("");
  async function load() {
    try {
      setTeam(await request("/team"));
      setError("");
    } catch (e) {
      setError(e.code);
    }
  }
  useEffect(() => {
    if (session.user.role === "owner") load();
  }, []);
  return (
    <>
      <PageHeading title={t("settings")} sub={t("teamSub")} />
      <div className="settings-grid">
        <section className="card settings-card">
          <h2>
            <Users size={20} />
            {t("team")}
          </h2>
          <div className="business-info">
            <span className="avatar">
              {session.fleetName.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <strong>{session.fleetName}</strong>
              <small>
                {`${session.user.username} · ${t(session.user.role)}`}
              </small>
            </div>
          </div>
          {session.user.role === "owner" && (
            <>
              {error && <p className="form-error">{t(error)}</p>}
              <div className="team-list">
                {team.map((u) => (
                  <div key={u.id} className="team-row">
                    <div>
                      <strong>{u.username}</strong>
                      <small>
                        {t(u.role)} · {t(u.active ? "active" : "inactive")}
                      </small>
                    </div>
                    {u.role === "staff" && !!u.active && (
                      <button
                        className="text-button danger"
                        disabled={offline}
                        onClick={() =>
                          setModal({
                            type: "confirm",
                            title: "deactivate",
                            text: "deactivateConfirm",
                            run: async () => {
                              await request("/team/deactivate", { id: u.id });
                              await load();
                            },
                            success: "deleted",
                          })
                        }
                      >
                        {t("deactivate")}
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <Button
                icon={Plus}
                disabled={offline}
                onClick={() => setModal({ type: "addStaff", onSaved: load })}
              >
                {t("addStaff")}
              </Button>
              <p className="small muted">{t("staffHint")}</p>
            </>
          )}
        </section>
        <div>
          <section className="card settings-card">
            <h2>
              <Settings size={20} />
              {t("account")}
            </h2>
            <div className="setting-line">
              <span>{t("language")}</span>
              <div className="segmented">
                <button
                  className={lang === "en" ? "selected" : ""}
                  onClick={() => setLang("en")}
                >
                  English
                </button>
                <button
                  className={lang === "hi" ? "selected" : ""}
                  onClick={() => setLang("hi")}
                >
                  हिन्दी
                </button>
              </div>
            </div>
            <button
              className="setting-button"
              disabled={offline}
              onClick={() => setModal({ type: "password" })}
            >
              {t("changePassword")}
              <ChevronRight size={17} />
            </button>
            {native && (
              <button className="setting-button" onClick={onChangeServer}>
                {t("changeServer")}
                <ChevronRight size={17} />
              </button>
            )}
            <button
              className="setting-button danger"
              onClick={logout}
              disabled={offline}
            >
              <span>
                <LogOut size={17} />
                {t("signOut")}
              </span>
              <ChevronRight size={17} />
            </button>
          </section>
          <section className="card settings-card">
            <h2>
              <Download size={20} />
              {t("backup")}
            </h2>
            <p>{t("exportHint")}</p>
            <Button
              secondary
              icon={Download}
              onClick={async () => {
                try {
                  await download(
                    `Shepards Tyre Management-records-${dayKey()}.json`,
                    JSON.stringify(
                      {
                        fleetName: session.fleetName,
                        exportedAt: new Date().toISOString(),
                        ...state,
                      },
                      null,
                      2,
                    ),
                    "application/json",
                  );
                  setToast({ text: t("exportDone") });
                } catch {
                  setToast({ text: t("serverError"), error: true });
                }
              }}
            >
              {t("exportBackup")}
            </Button>
            <p className="small muted">{t("privacy")}</p>
          </section>
          {!native && (
            <section className="card settings-card">
              <h2>
                <CircleDot size={20} />
                {t("downloadApp")}
              </h2>
              <p>{t("installHint")}</p>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
function Dialog({
  title,
  children,
  onClose,
  busy = false,
  wide = false,
  footer,
}) {
  const { t } = useApp();
  const ref = useRef(null);
  useEffect(() => {
    ref.current.showModal();
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = old;
    };
  }, []);
  return (
    <dialog
      className={`dialog ${wide ? "wide" : ""} ${footer ? "with-footer" : ""}`}
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <div className="dialog-header">
        <h2>{title}</h2>
        <button
          className="icon-button"
          disabled={busy}
          aria-label={t("close")}
          onClick={onClose}
        >
          <X size={21} />
        </button>
      </div>
      <div className="dialog-body">{children}</div>
      {footer && <div className="dialog-footer">{footer}</div>}
    </dialog>
  );
}
function ModalContent({ modal, onClose }) {
  if (modal.type === "importVehicles")
    return <WorkbookImport type="vehicle" onClose={onClose} />;
  if (modal.type === "importTyres")
    return <WorkbookImport type="tyre" onClose={onClose} />;
  if (modal.type === "sellVehicle")
    return <VehicleSaleForm modal={modal} onClose={onClose} />;
  if (modal.type === "inspectVehicle")
    return <InspectionForm modal={modal} onClose={onClose} />;
  if (modal.type === "tyre")
    return <TyreDetails id={modal.id} onClose={onClose} />;
  if (modal.type === "confirm")
    return <ConfirmModal {...modal} onClose={onClose} />;
  return <RecordForm modal={modal} onClose={onClose} />;
}
function WorkbookImport({ type, onClose }) {
  const isTyre = type === "tyre";
  const { t, n, state, action, setToast, offline } = useApp();
  const [sheets, setSheets] = useState([]);
  const [selected, setSelected] = useState(0);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState(false);
  const preview = sheets.length
    ? isTyre
      ? previewTyreImport(sheets[selected].data, state.tyres)
      : previewVehicleImport(sheets[selected].data, state.vehicles)
    : { rows: [] };
  const ready = preview.rows.filter((row) => !row.errors.length);
  async function choose(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setWorking(true);
    setError("");
    setSheets([]);
    setFileName("");
    try {
      const result = await readVehicleWorkbook(file);
      setSheets(result);
      setSelected(0);
      setFileName(file.name);
    } catch (e) {
      setError(e.code || "importUnreadable");
    } finally {
      setWorking(false);
    }
  }
  async function template() {
    setWorking(true);
    setError("");
    try {
      await downloadBlob(
        `Shepards-Tyre-Management-${type}-template.xlsx`,
        await (isTyre ? makeTyreTemplate() : makeVehicleTemplate()),
      );
    } catch {
      setError("importTemplateFailed");
    } finally {
      setWorking(false);
    }
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      await action(isTyre ? "importTyres" : "importVehicles", {
        [isTyre ? "tyres" : "vehicles"]: ready.map((row) => row.value),
      });
      setToast({
        text: t(isTyre ? "importTyreSuccess" : "importSuccess").replace(
          "{count}",
          n(ready.length),
        ),
      });
      onClose();
    } catch (e) {
      setError(e.code || "serverError");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={t(isTyre ? "importTyres" : "importVehicles")}
      onClose={onClose}
      busy={busy || working}
      footer={
        <>
          <Button secondary disabled={busy || working} onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            icon={Upload}
            disabled={busy || working || offline || !ready.length}
            onClick={save}
          >
            {t(
              busy ? "saving" : isTyre ? "importTyreConfirm" : "importConfirm",
            ).replace("{count}", n(ready.length))}
          </Button>
        </>
      }
      wide
    >
      <p>{t(isTyre ? "importTyreHelp" : "importHelp")}</p>
      <div className="import-controls">
        <Button
          secondary
          icon={Download}
          disabled={busy || working}
          onClick={template}
        >
          {t("importTemplate")}
        </Button>
        <label className={`import-file ${busy || working ? "disabled" : ""}`}>
          <Upload size={17} />
          <span>{t(working ? "loading" : "importChoose")}</span>
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            aria-label={t("importChoose")}
            disabled={busy || working}
            onChange={choose}
          />
        </label>
      </div>
      <p className="small muted">
        {t(isTyre ? "importTyreDefaults" : "importDefaults")}
      </p>
      {fileName && <p className="import-filename">{fileName}</p>}
      {sheets.length > 1 && (
        <Field label="importWorksheet">
          <select
            aria-label={t("importWorksheet")}
            value={selected}
            disabled={busy || working}
            onChange={(e) => {
              setSelected(Number(e.target.value));
              setError("");
            }}
          >
            {sheets.map((sheet, index) => (
              <option key={index} value={index}>
                {sheet.sheet}
              </option>
            ))}
          </select>
        </Field>
      )}
      {(error || preview.error) && (
        <div role="alert" className="form-error">
          {t(error || preview.error)}
        </div>
      )}
      {!!preview.rows.length && (
        <>
          <div className="import-summary">
            <strong>
              {n(ready.length)} {t("importReady")}
            </strong>
            <span>
              {n(preview.rows.length - ready.length)} {t("importSkipped")}
            </span>
          </div>
          <p className="small muted">
            {t(isTyre ? "importTyrePreviewHint" : "importPreviewHint")}
          </p>
          <p className="small muted import-swipe">{t("importSwipe")}</p>
          <div className="import-table-wrap">
            <table className="import-table">
              <thead>
                <tr>
                  {(isTyre
                    ? [
                        "importRow",
                        "serial",
                        "brand",
                        "condition",
                        "construction",
                        "previousKm",
                        "importStatus",
                      ]
                    : [
                        "importRow",
                        "registration",
                        "vehicleName",
                        "odometer",
                        "spare",
                        "vehicleClass",
                        "driverName",
                        "importStatus",
                      ]
                  ).map((key) => (
                    <th key={key}>{t(key)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr
                    key={row.number}
                    className={row.errors.length ? "import-row-error" : ""}
                  >
                    <td>{n(row.number)}</td>
                    {isTyre ? (
                      <>
                        <td>{row.value.serial || "—"}</td>
                        <td>
                          <BrandMark brand={row.value.brand} />
                        </td>
                        <td>{row.value.type ? t(row.value.type) : "—"}</td>
                        <td>
                          {row.value.construction
                            ? t(`construction_${row.value.construction}`)
                            : "—"}
                        </td>
                        <td>{n(row.value.distance)}</td>
                      </>
                    ) : (
                      <>
                        <td>{row.displayRegistration || "—"}</td>
                        <td>{row.value.name || "—"}</td>
                        <td>
                          {Number.isSafeInteger(row.value.odometer)
                            ? n(row.value.odometer)
                            : "—"}
                        </td>
                        <td>
                          {typeof row.value.hasSpare === "boolean"
                            ? t(row.value.hasSpare ? "yes" : "no")
                            : "—"}
                        </td>
                        <td>{row.value.emissionClass || "—"}</td>
                        <td>{row.value.driverName || "—"}</td>
                      </>
                    )}
                    <td>
                      {row.errors.length
                        ? row.errors.map((code) => t(code)).join(" ")
                        : t("importReady")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Dialog>
  );
}
function ConfirmModal({ title, text, run, success = "saved", onClose }) {
  const { t, setToast } = useApp();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function confirm() {
    setBusy(true);
    try {
      await run();
      setToast({ text: t(success) });
      onClose();
    } catch (e) {
      setError(e.code);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={t(title)} onClose={onClose} busy={busy}>
      <p>{t(text)}</p>
      {error && (
        <p className="form-error" role="alert">
          {t(error)}
        </p>
      )}
      <div className="form-actions">
        <Button secondary disabled={busy} onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button disabled={busy} onClick={confirm}>
          {t(busy ? "saving" : title)}
        </Button>
      </div>
    </Dialog>
  );
}
function TyreTags({ tyre }) {
  const { t } = useApp();
  return (
    <>
      <Badge type={tyre.status}>
        {t(
          tyre.status === "stock"
            ? "garage"
            : tyre.status === "installed"
              ? "onRoad"
              : tyre.status,
        )}
      </Badge>
      <Badge type={tyre.type} />
      <span className="construction-tag">
        {tyre.construction
          ? t(`construction_${tyre.construction}`)
          : t("notRecorded")}
      </span>
    </>
  );
}
function TyreDetails({ id, onClose }) {
  const { t, n, date, state, setModal, action, offline } = useApp();
  const tyre = state.tyres.find((t) => t.id === id);
  if (!tyre) return null;
  const vehicle = state.vehicles.find((v) => v.id === tyre.vehicleId);
  return (
    <Dialog title={tyre.serial} onClose={onClose}>
      <section className="tyre-detail-summary">
        <div className="tyre-detail-brand">
          <BrandMark brand={tyre.brand} />
        </div>
        <div className="tyre-detail-tags">
          <TyreTags tyre={tyre} />
        </div>
      </section>
      <div className="detail-stats tyre-summary-stats">
        <div>
          <span>{t("currentKm")}</span>
          <strong
            className={
              String(n(tyreKm(tyre, state))).length > 8 ? "long-value" : ""
            }
          >
            {n(tyreKm(tyre, state))} <small>{t("km")}</small>
          </strong>
        </div>
        <div>
          <span>{t("remoldCount")}</span>
          <strong>{n(tyre.remolds)}</strong>
        </div>
      </div>
      <dl className="detail-list">
        <div>
          <dt>{t("createdAt")}</dt>
          <dd>{date(tyre.createdAt)}</dd>
        </div>
        {vehicle && (
          <>
            <div>
              <dt>{t("vehicle")}</dt>
              <dd>
                {vehicle.registration} · {positionLabel(tyre.slot)}
              </dd>
            </div>
            <div>
              <dt>{t("odometer")}</dt>
              <dd>
                {n(vehicle.odometer)} {t("km")}
              </dd>
            </div>
          </>
        )}
      </dl>
      {tyre.remoldVendor && (
        <p className="form-info">
          {t("remoldVendor")}: {tyre.remoldVendor}
        </p>
      )}
      <section className="nsd-summary">
        <h3>{t("nsd")}</h3>
        <strong>
          {averageNsd(tyre.nsd) !== null
            ? `${averageNsd(tyre.nsd)}%`
            : t("notRecorded")}
        </strong>
        {!tyre.lastNsdOn && averageNsd(tyre.nsd) === 100 && (
          <p>{t("nsdAutoBaseline")}</p>
        )}
        {tyre.lastNsdOn && (
          <p>
            {t("measuredOn")}: {date(tyre.lastNsdOn)} · {t("nextNsd")}:{" "}
            {date(tyre.nextNsdCheckOn)}
          </p>
        )}
        {tyre.nextNsdCheckOn && tyre.nextNsdCheckOn <= dayKey() && (
          <p className="reminder-pill">
            {t("nsdDue")} · {t("advisoryOnly")}
          </p>
        )}
        {tyre.status === "installed" && (
          <Button
            secondary
            icon={Ruler}
            disabled={offline}
            onClick={() => setModal({ type: "measureNsd", tyreId: tyre.id })}
          >
            {t("measureNsd")}
          </Button>
        )}
      </section>
      <p className="small muted">{t("distanceHint")}</p>
      {tyre.scrapReason && (
        <p className="form-info">
          {t("scrapReason")}: {t(`reason_${tyre.scrapReason}`)}
          {tyre.scrapDetail ? ` · ${tyre.scrapDetail}` : ""}
        </p>
      )}
      {tyre.status !== "sold" && tyre.status !== "scrapped" && (
        <div className="tyre-actions">
          {tyre.status === "installed" ? (
            <Button
              icon={ArrowDownLeft}
              disabled={offline}
              onClick={() =>
                setModal({ type: "remove", tyreId: id, vehicleId: vehicle.id })
              }
            >
              {t("remove")}
            </Button>
          ) : (
            <>
              {tyre.status === "stock" && (
                <>
                  <Button
                    icon={ArrowUpRight}
                    disabled={offline || !activeVehicles(state).length}
                    onClick={() => setModal({ type: "fit", tyreId: id })}
                  >
                    {t("fit")}
                  </Button>
                  <Button
                    secondary
                    icon={Wrench}
                    disabled={offline}
                    onClick={() => setModal({ type: "sendRemold", tyreId: id })}
                  >
                    {t("sendRemold")}
                  </Button>
                </>
              )}
              <Button
                secondary
                icon={RefreshCw}
                disabled={offline}
                onClick={() => setModal({ type: "remold", tyreId: id })}
              >
                {t("remoldAction")}
              </Button>
              <button
                className="text-button danger"
                disabled={offline}
                onClick={() => setModal({ type: "scrap", tyreId: id })}
              >
                <Trash2 size={16} />
                {t("scrapAction")}
              </button>
            </>
          )}
        </div>
      )}
      {tyre.status === "sold" && (
        <p className="sale-record">
          {t("sold")}: {date(tyre.soldAt, true)} · {tyre.soldBy}
          {tyre.saleNote ? ` · ${tyre.saleNote}` : ""}
          {tyre.soldVehicle && (
            <span className="sold-with-vehicle">
              {t("withVehicle")}: {tyre.soldVehicle} · {t("position")}{" "}
              {positionLabel(tyre.soldSlot)}
            </span>
          )}
        </p>
      )}
      {["stock", "scrapped"].includes(tyre.status) && (
        <Button
          secondary
          disabled={offline}
          onClick={() => setModal({ type: "sell", tyreId: tyre.id })}
        >
          {t("sell")}
        </Button>
      )}
      <h3 className="history-heading">{t("tyreHistory")}</h3>
      {state.events
        .filter(
          (e) =>
            e.tyre === tyre.serial ||
            (e.nsdMeasurements || []).some((m) => m.tyreId === tyre.id) ||
            (e.findings || []).some((f) => f.tyreId === tyre.id) ||
            (e.inspectedTyres || []).some((t) => t.tyreId === tyre.id),
        )
        .slice()
        .reverse()
        .map((e) => (
          <Activity key={e.id} event={e} />
        ))}
    </Dialog>
  );
}
function RecordForm({ modal: m, onClose }) {
  const { t, n, state, action, setToast, offline } = useApp();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [selectedBrand, setSelectedBrand] = useState("MRF");
  const previousVendor =
    state.tyres.find((t) => t.id === m.tyreId)?.remoldVendor || "";
  const [vendor, setVendor] = useState(
    ["Sharvayu", "Guardex MRF"].includes(previousVendor)
      ? previousVendor
      : previousVendor
        ? "other"
        : "",
  );
  const [destination, setDestination] = useState("stock");
  const [scrapReason, setScrapReason] = useState("");
  const [removalOdo, setRemovalOdo] = useState(null);
  const [vehicleId, setVehicleId] = useState(m.vehicleId || ""),
    [slot, setSlot] = useState(m.slot || "");
  const vehicle = state.vehicles.find((v) => v.id === vehicleId),
    tyre = state.tyres.find((t) => t.id === m.tyreId);
  const available = [
    ...numberedSlots,
    ...(vehicle?.hasSpare ? ["SP"] : []),
  ].filter(
    (s) =>
      !state.tyres.some(
        (t) =>
          t.vehicleId === vehicleId && t.slot === s && t.status === "installed",
      ),
  );
  const title =
    m.type === "remove"
      ? "remove"
      : m.type === "password"
        ? "changePassword"
        : m.type === "scrap"
          ? "scrapAction"
          : m.type === "remold"
            ? "remoldAction"
            : m.type;
  async function submit(e) {
    e.preventDefault();
    if (offline) return setError("offlineHint");
    setBusy(true);
    setError("");
    const p = Object.fromEntries(new FormData(e.currentTarget));
    try {
      if (m.type === "addVehicle") p.hasSpare = p.hasSpare === "on";
      if (m.type === "addTyre") {
        if (p.brand === "other") p.brand = p.customBrand;
      }
      if (m.type === "measureNsd") {
        p.measuredOn = parseDisplayDate(p.measuredOn);
        p.nsd = { averagePercent: p.nsdAverage };
      }
      if (m.type === "password") {
        if (p.password !== p.confirm) throw { code: "passwordsDiffer" };
        await request("/password", p);
        setToast({
          text: t("passwordChanged"),
        });
      } else if (m.type === "addStaff") {
        if (p.password !== p.confirm) throw { code: "passwordsDiffer" };
        await request("/team/create", {
          username: p.username,
          password: p.password,
        });
        await m.onSaved?.();
        setToast({ text: t("staffCreated") });
      } else
        await action(m.type, {
          ...p,
          ...(m.tyreId ? { tyreId: m.tyreId } : {}),
          ...(vehicleId ? { vehicleId } : {}),
        });
      if (m.type === "changeDriver") setToast({ text: t("driverReminder") });
      onClose();
    } catch (e) {
      setError(e.code || "serverError");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={t(title)} onClose={onClose} busy={busy}>
      <form onSubmit={submit}>
        {m.type === "scrap" && tyre && (
          <div className="selected-record">
            <CircleDot size={20} />
            <strong>{tyre.serial}</strong>
            <Badge type={tyre.type} />
          </div>
        )}
        {m.type === "addStaff" && (
          <>
            <p className="form-info">{t("staffHint")}</p>
            <Field label="username" hint="usernameHint">
              <input
                name="username"
                required
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck="false"
                pattern="[a-zA-Z0-9_.\-]{3,40}"
                maxLength={40}
              />
            </Field>
            <PasswordField
              minLength={10}
              hint="passwordHint"
              autoComplete="new-password"
            />
            <PasswordField
              label="confirmPassword"
              name="confirm"
              minLength={10}
              autoComplete="new-password"
            />
          </>
        )}
        {m.type === "addTyre" && (
          <>
            <Field label="serial">
              <input
                name="serial"
                required
                maxLength={70}
                autoCapitalize="characters"
                placeholder="TYR-001"
              />
            </Field>
            <Field label="brand">
              <select
                name="brand"
                required
                value={selectedBrand}
                onChange={(e) => setSelectedBrand(e.target.value)}
              >
                {manufacturers.map((m) => (
                  <option key={m.name}>{m.name}</option>
                ))}
                <option value="other">{t("otherManufacturer")}</option>
              </select>
            </Field>
            {selectedBrand === "other" ? (
              <Field label="customBrand">
                <input name="customBrand" required maxLength={80} />
              </Field>
            ) : (
              <BrandMark brand={selectedBrand} />
            )}
            <Field label="construction">
              <select name="construction" required defaultValue="radial">
                {constructions.map((c) => (
                  <option key={c} value={c}>
                    {t(`construction_${c}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="condition">
              <select name="type" defaultValue="new">
                {["new", "used", "remold"].map((type) => (
                  <option key={type} value={type}>
                    {t(type)}
                  </option>
                ))}
              </select>
            </Field>
            <KmInput label="previousKm" name="distance" value={0} />
            <p className="form-info">{t("nsdStockBaseline")}</p>
          </>
        )}
        {m.type === "addVehicle" && (
          <>
            <Field label="registration">
              <input
                name="registration"
                required
                maxLength={30}
                autoCapitalize="characters"
                placeholder="RJ 14 GC 1234"
              />
            </Field>
            <Field label="vehicleName">
              <input name="name" maxLength={100} />
            </Field>
            <Field label="driverName">
              <input name="driverName" maxLength={100} />
            </Field>
            <Field label="vehicleClass">
              <select name="emissionClass" defaultValue="" required>
                <option value="" disabled>
                  {t("chooseVehicleClass")}
                </option>
                {vehicleClasses.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <KmInput name="odometer" value={0} />
            <label className="checkbox-field">
              <input type="checkbox" name="hasSpare" />
              {t("hasSpare")}
            </label>
            <p className="form-info">
              <Truck size={18} />
              18 {t("roadTyres")}
            </p>
          </>
        )}
        {m.type === "changeDriver" && (
          <>
            <p className="form-info">
              {t("driverReminder")} · {t("advisoryOnly")}
            </p>
            <p>
              {vehicle?.registration} · {t("currentDriver")}:{" "}
              {vehicle?.driverName || t("notRecorded")}
            </p>
            <Field label="driverName">
              <input
                name="driverName"
                required
                maxLength={100}
                autoComplete="off"
              />
            </Field>
          </>
        )}
        {m.type === "sell" && (
          <p className="form-info">
            {tyre?.serial} · {t("sellHint")}
          </p>
        )}
        {m.type === "measureNsd" && (
          <>
            <p className="selected-record">
              {tyre?.serial} <BrandMark brand={tyre?.brand} />
            </p>
            <Field label="measuredOn">
              <DateField
                name="measuredOn"
                value={dayKey()}
                max={dayKey()}
                required
                errorText={t("invalidDate")}
              />
            </Field>
            <NsdInputs t={t} />
            <p className="form-info">{t("nsdReminderHint")}</p>
          </>
        )}
        {m.type === "fit" && (
          <>
            <p className="form-info">{t("fitHint")}</p>
            {tyre ? (
              <div className="selected-record">
                <CircleDot size={20} />
                <strong>{tyre.serial}</strong>
                <Badge type={tyre.type} />
              </div>
            ) : (
              <Field label="chooseTyre">
                <select name="tyreId" required defaultValue="">
                  <option value="" disabled>
                    {t("chooseTyre")}
                  </option>
                  {state.tyres
                    .filter((t) => t.status === "stock")
                    .map((tire) => (
                      <option key={tire.id} value={tire.id}>
                        {tire.serial} · {tire.brand} · {t(tire.type)}
                      </option>
                    ))}
                </select>
              </Field>
            )}
            <Field label="vehicle">
              <select
                name="vehicleId"
                required
                value={vehicleId}
                onChange={(e) => {
                  setVehicleId(e.target.value);
                  setSlot("");
                }}
              >
                <option value="" disabled>
                  {t("chooseVehicle")}
                </option>
                {activeVehicles(state).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.registration}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="position">
              <select
                name="slot"
                required
                value={available.includes(slot) ? slot : ""}
                onChange={(e) => setSlot(e.target.value)}
              >
                <option value="" disabled>
                  {t("choosePosition")}
                </option>
                {available.map((s) => (
                  <option key={s} value={s}>
                    {s === "SP" ? `${s} · ${t("spare")}` : positionLabel(s)}
                  </option>
                ))}
              </select>
            </Field>
            {vehicle && (
              <KmInput
                name="odometer"
                key={vehicle.id}
                value={vehicle.odometer}
                min={vehicle.odometer}
              />
            )}
          </>
        )}
        {["remove", "updateOdometer"].includes(m.type) && (
          <>
            <p className="form-info">
              {t(m.type === "remove" ? "removeHint" : "odoHint")}
            </p>
            <div className="selected-record">
              <Truck size={20} />
              <strong>{vehicle?.registration}</strong>
              {tyre && (
                <span>
                  {tyre.serial} · {positionLabel(tyre.slot)}
                </span>
              )}
            </div>
            <KmInput
              name="odometer"
              value={vehicle?.odometer}
              min={vehicle?.odometer}
              onChange={(e) => setRemovalOdo(e.target.value)}
            />
          </>
        )}
        {m.type === "remove" && (
          <>
            <Field label="destination">
              <select
                name="destination"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
              >
                <option value="stock">{t("returnStock")}</option>
                <option value="remolding">{t("sendRemold")}</option>
                <option value="scrapped">{t("scrapAction")}</option>
              </select>
            </Field>
            <p className="form-info">
              {t("runningKm")}:{" "}
              {n(
                tyre?.slot === "SP"
                  ? 0
                  : Math.max(
                      0,
                      Number(removalOdo ?? vehicle?.odometer) -
                        (tyre?.fittedAt ?? 0),
                    ),
              )}{" "}
              {t("km")} · {t("currentKm")}:{" "}
              {n(
                (tyre?.distance ?? 0) +
                  (tyre?.slot === "SP"
                    ? 0
                    : Math.max(
                        0,
                        Number(removalOdo ?? vehicle?.odometer) -
                          (tyre?.fittedAt ?? 0),
                      )),
              )}{" "}
              {t("km")}
            </p>
          </>
        )}
        {(m.type === "scrap" ||
          (m.type === "remove" && destination === "scrapped")) && (
          <>
            <p className="form-info">{t("confirmScrap")}</p>
            <Field label="scrapReason">
              <select
                name="scrapReason"
                required
                value={scrapReason}
                onChange={(e) => setScrapReason(e.target.value)}
              >
                <option value="" disabled>
                  {t("chooseReason")}
                </option>
                {scrapReasons.map((reason) => (
                  <option key={reason} value={reason}>
                    {t(`reason_${reason}`)}
                  </option>
                ))}
              </select>
            </Field>
            {scrapReason === "other" && (
              <Field label="scrapDetail">
                <textarea
                  name="scrapDetail"
                  rows={2}
                  maxLength={300}
                  required
                />
              </Field>
            )}
          </>
        )}
        {(["sendRemold", "remold"].includes(m.type) ||
          (m.type === "remove" && destination === "remolding")) && (
          <>
            {m.type !== "remove" && (
              <p className="selected-record">
                {tyre?.serial} <BrandMark brand={tyre?.brand} />
              </p>
            )}
            <Field label="remoldVendor">
              <select
                name="vendor"
                value={vendor}
                required
                onChange={(e) => setVendor(e.target.value)}
              >
                <option value="" disabled>
                  {t("chooseVendor")}
                </option>
                <option>Sharvayu</option>
                <option>Guardex MRF</option>
                <option value="other">{t("otherVendor")}</option>
              </select>
            </Field>
            {vendor === "other" && (
              <Field label="customVendor">
                <input
                  name="customVendor"
                  required
                  maxLength={100}
                  defaultValue={
                    previousVendor &&
                    !["Sharvayu", "Guardex MRF"].includes(previousVendor)
                      ? previousVendor
                      : ""
                  }
                />
              </Field>
            )}
          </>
        )}
        {m.type === "password" ? (
          <>
            <PasswordField label="currentPassword" name="currentPassword" />
            <PasswordField
              label="newPassword"
              name="password"
              hint="passwordHint"
              minLength={10}
              autoComplete="new-password"
            />
            <PasswordField
              label="confirmPassword"
              name="confirm"
              autoComplete="new-password"
            />
          </>
        ) : (
          m.type !== "addStaff" && (
            <Field label="notes">
              <textarea name="note" rows={3} maxLength={500} />
            </Field>
          )
        )}
        {error && (
          <div role="alert" className="form-error">
            <AlertCircle size={17} />
            {t(error)}
          </div>
        )}
        <div className="form-actions">
          <Button secondary type="button" disabled={busy} onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button icon={Check} disabled={busy || offline}>
            {t(busy ? "saving" : "save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
function stateBrand(event, state) {
  return event.brand || state.tyres.find((t) => t.serial === event.tyre)?.brand;
}
async function downloadCsv(name, rows) {
  const cell = (value) =>
    `"${String(value ?? "")
      .replace(/^[=+@\-\t\r]/, "'$&")
      .replaceAll('"', '""')}"`;
  await download(
    name,
    "\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n"),
    "text/csv;charset=utf-8",
  );
}
function NsdInputs({ t }) {
  return (
    <Field label="nsdAverage">
      <input
        name="nsdAverage"
        type="number"
        min={0}
        max={100}
        step="0.01"
        required
        inputMode="decimal"
        placeholder="0–100"
      />
      <small>{t("nsdPercentHint")}</small>
    </Field>
  );
}
function MaintenanceReminders() {
  const { t, state, navigate, setModal } = useApp();
  const drivers = activeVehicles(state).filter((v) => v.pendingTyreCheck);
  const due = state.tyres.filter(
    (t) =>
      t.status === "installed" &&
      t.nextNsdCheckOn &&
      t.nextNsdCheckOn <= dayKey(),
  );
  if (!drivers.length && !due.length) return null;
  return (
    <section className="card maintenance-reminders">
      <h2>{t("maintenanceReminders")}</h2>
      <p className="small muted">{t("advisoryOnly")}</p>
      <div>
        {drivers.map((v) => (
          <button
            className="secondary"
            key={v.id}
            onClick={() => navigate("vehicles", v.id)}
          >
            {v.registration} · {t("driverCheckPending")}
          </button>
        ))}
        {due.slice(0, 10).map((tyre) => (
          <button
            className="secondary"
            key={tyre.id}
            onClick={() => setModal({ type: "measureNsd", tyreId: tyre.id })}
          >
            {tyre.serial} · {t("nsdDue")}
          </button>
        ))}
      </div>
      {due.length > 10 && (
        <p>
          {due.length} {t("nsdDue")}
        </p>
      )}
    </section>
  );
}
function InspectionForm({ modal, onClose }) {
  const { t, n, state, action, offline } = useApp();
  const vehicle = state.vehicles.find((v) => v.id === modal.vehicleId);
  const [tyres] = useState(() =>
    state.tyres
      .filter(
        (t) => t.vehicleId === modal.vehicleId && t.status === "installed",
      )
      .map((t) => ({
        id: t.id,
        slot: t.slot,
        serial: t.serial,
        brand: t.brand,
      })),
  );
  const [driverChangeId] = useState(vehicle?.driverChangeId || null);
  const [inspectedOn, setInspectedOn] = useState(dayKey()),
    [checked, setChecked] = useState(false);
  const [findings, setFindings] = useState([]),
    [readings, setReadings] = useState({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (!vehicle) return null;
  function edit(index, key, value) {
    setFindings((old) =>
      old.map((f, i) => (i === index ? { ...f, [key]: value } : f)),
    );
  }
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const nsdMeasurements = tyres
        .filter((t) =>
          Object.values(readings[t.id] || {}).some((v) => v !== ""),
        )
        .map((t) => ({ tyreId: t.id, slot: t.slot, ...readings[t.id] }));
      await action("inspectVehicle", {
        vehicleId: vehicle.id,
        inspectedOn,
        allTyresChecked: checked,
        driverChangeId,
        fitmentSnapshot: tyres.map((t) => ({ tyreId: t.id, slot: t.slot })),
        findings: findings.map((f) => ({
          ...f,
          tyreId: tyres.find((t) => t.slot === f.slot)?.id || null,
        })),
        nsdMeasurements,
        note: form.get("note"),
      });
      onClose();
    } catch (e) {
      setError(e.code || "serverError");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={`${t("inspectVehicle")} · ${vehicle.registration}`}
      onClose={onClose}
      busy={busy}
      wide
    >
      <form onSubmit={submit}>
        <Field label="inspectedOn">
          <DateField
            name="inspectedOn"
            value={inspectedOn}
            onChange={setInspectedOn}
            max={dayKey()}
            required
            errorText={t("invalidDate")}
          />
        </Field>
        <label className="checkbox-field">
          <input
            type="checkbox"
            name="allTyresChecked"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
          {t("allTyresChecked")}
        </label>
        <p className="small muted">{t("inspectionHint")}</p>
        <h3>{t("findings")}</h3>
        {findings.map((f, index) => (
          <div className="inspection-finding" key={index}>
            <Field label="position">
              <select
                aria-label={`${t("position")} ${index + 1}`}
                required
                value={f.slot}
                onChange={(e) => edit(index, "slot", e.target.value)}
              >
                <option value="" disabled>
                  {t("choosePosition")}
                </option>
                {[...numberedSlots, ...(vehicle.hasSpare ? ["SP"] : [])].map(
                  (slot) => (
                    <option key={slot} value={slot}>
                      {positionLabel(slot)}
                    </option>
                  ),
                )}
              </select>
            </Field>
            <Field label="issue">
              <select
                aria-label={`${t("issue")} ${index + 1}`}
                required
                value={f.issue}
                onChange={(e) => edit(index, "issue", e.target.value)}
              >
                <option value="" disabled>
                  {t("chooseIssue")}
                </option>
                {inspectionIssues.map((issue) => (
                  <option key={issue} value={issue}>
                    {t(`issue_${issue}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="issueDetail">
              <input
                aria-label={`${t("issueDetail")} ${index + 1}`}
                value={f.detail}
                required={f.issue === "other"}
                maxLength={300}
                onChange={(e) => edit(index, "detail", e.target.value)}
              />
            </Field>
            <button
              type="button"
              className="text-button danger"
              onClick={() =>
                setFindings((old) => old.filter((_, i) => i !== index))
              }
            >
              {t("removeFinding")}
            </button>
          </div>
        ))}
        <Button
          secondary
          type="button"
          icon={Plus}
          disabled={findings.length >= 57}
          onClick={() =>
            setFindings((old) => [...old, { slot: "", issue: "", detail: "" }])
          }
        >
          {t("addFinding")}
        </Button>
        <h3 className="history-heading">{t("nsd")}</h3>
        <p className="small muted">
          {t("nsdPercentHint")} {t("nsdReminderHint")}
        </p>
        {!tyres.length ? (
          <p className="form-info">{t("noTyresForNsd")}</p>
        ) : (
          <div className="inspection-nsd-table">
            {tyres.map((tyre) => (
              <div className="inspection-nsd-row" key={tyre.id}>
                <div>
                  <strong>
                    {positionLabel(tyre.slot)} · {tyre.serial}
                  </strong>
                  <BrandMark brand={tyre.brand} />
                </div>
                <label className="field">
                  <span>{t("nsdAverage")}</span>
                  <input
                    aria-label={`${tyre.serial} ${t("nsdAverage")}`}
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    inputMode="decimal"
                    placeholder="—"
                    value={readings[tyre.id]?.averagePercent ?? ""}
                    onChange={(e) =>
                      setReadings((old) => ({
                        ...old,
                        [tyre.id]: { averagePercent: e.target.value },
                      }))
                    }
                  />
                </label>
              </div>
            ))}
          </div>
        )}
        <Field label="notes">
          <textarea name="note" rows={3} maxLength={500} />
        </Field>
        {error && (
          <p className="form-error" role="alert">
            {t(error)}
          </p>
        )}
        <div className="form-actions">
          <Button secondary type="button" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button disabled={busy || offline}>
            {t(busy ? "saving" : "save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function KmInput({ name, value, min = 0, label = "odometer", onChange }) {
  return (
    <Field label={label}>
      <input
        name={name}
        type="number"
        inputMode="numeric"
        required
        min={min}
        max={99999999}
        step={1}
        defaultValue={value}
        onChange={onChange}
      />
    </Field>
  );
}

createRoot(document.getElementById("root")).render(<App />);
if ("serviceWorker" in navigator && import.meta.env.PROD && !native)
  navigator.serviceWorker.register("/sw.js").catch(() => {});

function VehicleSaleForm({ modal, onClose }) {
  const { t, n, state, session, action, offline, navigate } = useApp();
  const vehicle = state.vehicles.find((v) => v.id === modal.vehicleId);
  const [snapshot] = useState(() =>
    state.tyres
      .filter(
        (t) => t.status === "installed" && t.vehicleId === modal.vehicleId,
      )
      .map((t) => ({
        tyreId: t.id,
        slot: t.slot,
        tyre: t.serial,
        brand: t.brand,
      })),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (!vehicle || vehicle.status === "sold" || session.user.role !== "owner")
    return null;
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = Object.fromEntries(new FormData(e.currentTarget));
      await action("sellVehicle", {
        ...data,
        vehicleId: vehicle.id,
        fitmentSnapshot: snapshot.map((t) => ({
          tyreId: t.tyreId,
          slot: t.slot,
        })),
      });
      onClose();
      navigate("vehicles");
    } catch (e) {
      setError(e.code || "serverError");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={`${t("vehicleSold")} · ${vehicle.registration}`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button secondary type="button" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button
            type="submit"
            form="vehicle-sale-form"
            disabled={busy || offline}
          >
            {t(busy ? "saving" : "confirmSale")}
          </Button>
        </>
      }
    >
      <form id="vehicle-sale-form" onSubmit={submit}>
        <p className="sale-review-info">{t("vehicleSaleHelp")}</p>
        <p className="sale-tyre-count">
          <strong>{n(snapshot.length)}</strong> {t("tyresIncluded")}
        </p>
        <ul className="sale-tyre-list">
          {snapshot.map((tyre) => (
            <li key={tyre.tyreId}>
              <span>
                {positionLabel(tyre.slot)} · {tyre.tyre}
              </span>
              <BrandMark brand={tyre.brand} />
            </li>
          ))}
        </ul>
        <KmInput
          name="odometer"
          value={vehicle.odometer}
          min={vehicle.odometer}
        />
        <Field label="notes">
          <textarea
            name="note"
            rows={3}
            maxLength={500}
            placeholder={t("saleNotePlaceholder")}
          />
        </Field>
        <label className="checkbox-field">
          <input type="checkbox" name="confirmSale" required />
          {t("confirmVehicleSale")}
        </label>
        {error && (
          <p className="form-error" role="alert">
            {t(error)}
          </p>
        )}
      </form>
    </Dialog>
  );
}
