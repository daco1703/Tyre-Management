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
  Copy,
  Eye,
  EyeOff,
  Wrench,
  Trash2,
  Link,
  Menu,
} from "lucide-react";
import { en, hi } from "./i18n";
import { loadOffline, startOffline, offlineAction } from "./offline";
import { slots, dayKey, tally, dailyTally, tyreKm } from "../shared/model";
import "./style.css";
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
let server = native ? read("ts-server", "") : "";
async function request(url, body) {
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
      signal: AbortSignal.timeout(15000),
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
  const [localMode, setLocalMode] = useState(read("ts-mode") === "local");
  const [showOfflineSetup, setShowOfflineSetup] = useState(false);
  const initVersion = useRef(0);
  const localRef = useRef(localMode);
  localRef.current = localMode;
  const [lang, setLang] = useState(read("ts-lang", "en"));
  const [session, setSession] = useState(null),
    [state, setState] = useState(null);
  const [boot, setBoot] = useState(null),
    [bootError, setBootError] = useState("");
  const [page, setPage] = useState("dashboard"),
    [vehicleId, setVehicleId] = useState(null);
  const [modal, setModal] = useState(null),
    [toast, setToast] = useState(null);
  const [offline, setOffline] = useState(!navigator.onLine),
    [needsServer, setNeedsServer] = useState(native && !server && !localMode);
  const dict = lang === "hi" ? hi : en;
  const t = (key) => dict[key] || en[key] || key;
  const n = (value) =>
    Number(value).toLocaleString(lang === "hi" ? "hi-IN" : "en-IN");
  const date = (value, time = false) =>
    new Intl.DateTimeFormat(lang === "hi" ? "hi-IN" : "en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      ...(time ? { hour: "2-digit", minute: "2-digit" } : {}),
      timeZone: "Asia/Kolkata",
    }).format(
      new Date(value.length === 10 ? value + "T12:00:00+05:30" : value),
    );
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
    store("ts-session", null);
    store("ts-state", null);
    store("ts-token", null);
    setSession(null);
    setState(null);
    setModal(null);
    setPage("dashboard");
    setVehicleId(null);
  }
  async function initialize() {
    const version = ++initVersion.current;
    if (localMode) {
      try {
        const profile = await loadOffline();
        if (version !== initVersion.current) return;
        if (profile) activateLocal(profile);
        else setShowOfflineSetup(true);
      } catch (e) {
        if (version === initVersion.current) setBootError(e.code);
      }
      return;
    }
    if (native && !server) return;
    setBootError("");
    try {
      const config = await request("/bootstrap");
      if (version !== initVersion.current) return;
      setBoot(config);
      try {
        const s = await request("/me");
        const data = await request("/state");
        if (version !== initVersion.current) return;
        setSession(s);
        store("ts-session", s);
        setState(data);
        store("ts-state", data);
        setOffline(false);
      } catch (e) {
        if (version !== initVersion.current) return;
        if (e.status === 401) resetSession();
        else throw e;
      }
    } catch (e) {
      if (version !== initVersion.current) return;
      const cached = read("ts-session"),
        data = read("ts-state");
      if (cached && data) {
        setSession(cached);
        setState(data);
        setOffline(true);
        setBoot({ setupRequired: false });
      } else setBootError(e.code);
    }
  }
  useEffect(() => {
    initialize();
  }, [needsServer, localMode]);
  function activateLocal(profile) {
    setSession({
      fleetName: profile.fleetName,
      user: { id: "local", username: t("thisPhone"), role: "owner" },
    });
    setState(profile.state);
    setOffline(false);
    setBoot({ setupRequired: false });
    setBootError("");
    setNeedsServer(false);
    setShowOfflineSetup(false);
  }
  async function beginLocal(fleetName) {
    const profile = await startOffline(fleetName);
    try {
      localStorage.setItem("ts-mode", JSON.stringify("local"));
    } catch {
      throw { code: "localStorageFailed" };
    }
    ++initVersion.current;
    localRef.current = true;
    setLocalMode(true);
    activateLocal(profile);
    setPage("dashboard");
    setVehicleId(null);
  }
  function leaveLocal() {
    ++initVersion.current;
    store("ts-mode", "server");
    localRef.current = false;
    setLocalMode(false);
    resetSession();
    setBoot(null);
    setBootError("");
    setNeedsServer(native && !server);
  }
  async function refresh() {
    if (localRef.current) {
      try {
        const profile = await loadOffline();
        if (localRef.current && profile) setState(profile.state);
        return profile?.state;
      } catch {
        return null;
      }
    }
    try {
      const data = await request("/state");
      if (localRef.current) return null;
      setState(data);
      store("ts-state", data);
      setOffline(false);
      return data;
    } catch (e) {
      if (localRef.current) return null;
      if (e.status === 401) {
        resetSession();
        setToast({ text: t("unauthorized"), error: true });
      } else setOffline(true);
      return null;
    }
  }
  useEffect(() => {
    if (!session || localMode) return;
    const id = setInterval(refresh, 10000);
    const online = () => refresh();
    const off = () => setOffline(true);
    window.addEventListener("online", online);
    window.addEventListener("offline", off);
    document.addEventListener("visibilitychange", online);
    return () => {
      clearInterval(id);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", off);
      document.removeEventListener("visibilitychange", online);
    };
  }, [session, localMode]);
  async function action(kind, payload) {
    if (localMode) {
      try {
        const data = await offlineAction(kind, payload, state.revision);
        setState(data);
        setToast({ text: t("saved") });
        return data;
      } catch (e) {
        if (e.code === "staleData") await refresh();
        throw e;
      }
    }
    if (offline) throw { code: "offlineHint" };
    try {
      const data = await request("/actions", {
        kind,
        payload,
        revision: state.revision,
      });
      setState(data);
      store("ts-state", data);
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
  async function authenticated(data) {
    if (data.token) store("ts-token", data.token);
    const s = { user: data.user, fleetName: data.fleetName };
    store("ts-session", s);
    setSession(s);
    const current = await request("/state");
    setState(current);
    store("ts-state", current);
    setOffline(false);
    if (data.invite) setModal({ type: "invite", invite: data.invite });
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
    localMode,
    openOffline: () => setShowOfflineSetup(true),
    leaveLocal,
  };
  return (
    <Context.Provider value={value}>
      {showOfflineSetup ? (
        <OfflineSetup
          onStart={beginLocal}
          onCancel={() => setShowOfflineSetup(false)}
        />
      ) : needsServer ? (
        <ServerConnect
          onConnect={() => {
            setNeedsServer(false);
          }}
        />
      ) : bootError ? (
        <div className="connection-page">
          <Brand />
          <WifiOff size={48} />
          <h1>{t(localMode ? "localStorageFailed" : "notConnected")}</h1>
          <button onClick={initialize}>{t("retry")}</button>
          <Button secondary onClick={() => setShowOfflineSetup(true)}>
            {t("useOffline")}
          </Button>
          {native && (
            <button className="secondary" onClick={() => setNeedsServer(true)}>
              {t("changeServer")}
            </button>
          )}
        </div>
      ) : !boot || (session && !state) ? (
        <div className="connection-page">
          <Brand />
          <RefreshCw className="spin" />
          <p>{t("reconnecting")}</p>
          {!localMode && (
            <Button secondary onClick={() => setShowOfflineSetup(true)}>
              {t("useOffline")}
            </Button>
          )}
        </div>
      ) : !session ? (
        <Auth
          boot={boot}
          onAuth={authenticated}
          changeServer={() => setNeedsServer(true)}
        />
      ) : (
        <div className="app-shell">
          <aside className="sidebar">
            <Brand />
            <div className="workspace-label">
              <span className="tiny-label">FLEET WORKSPACE</span>
              <strong>{session.fleetName}</strong>
              <span className="workspace-dot">
                <i />
                {t(localMode ? "localMode" : "sync")}
              </span>
            </div>
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
                  <small>
                    {t(localMode ? "localAccount" : session.user.role)}
                  </small>
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
                  <span>
                    {t(localMode ? "localMode" : offline ? "offline" : "sync")}
                  </span>
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
            {localMode && (
              <div className="local-banner">
                <CircleDot size={16} />
                <span>{t("localMode")}</span>
              </div>
            )}
            {offline && (
              <div className="offline-banner">
                <WifiOff size={16} />
                <span>{t("offlineHint")}</span>
                <button className="text-button" onClick={refresh}>
                  {t("retry")}
                </button>
              </div>
            )}
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
              ) : (
                <SettingsPage
                  onChangeServer={() => {
                    resetSession();
                    setNeedsServer(true);
                  }}
                />
              )}
            </main>
            <footer className="page-footer">
              <CircleDot size={14} />
              {t("tagline")}
              <span>TyreSaathi · v1.1</span>
            </footer>
          </div>
          <nav className="bottom-nav">
            <Navigation page={page} navigate={navigate} mobile />
          </nav>
        </div>
      )}
      {modal && <ModalContent modal={modal} onClose={() => setModal(null)} />}
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
      <span className="brand-icon">
        <CircleDot size={25} />
      </span>
      <div>
        Tyre<span>Saathi</span>
        {!compact && <small>FLEET TYRE LOGBOOK</small>}
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
  { id: "settings", Icon: Settings },
];
function Navigation({ page, navigate, mobile }) {
  const { t } = useApp();
  return (
    <nav className={mobile ? "mobile-nav-items" : "nav-items"}>
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
function OfflineSetup({ onStart, onCancel }) {
  const { t } = useApp();
  const [name, setName] = useState(t("offlineDefaultName"));
  const [existing, setExisting] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    loadOffline()
      .then((profile) => {
        if (active && profile) {
          setName(profile.fleetName);
          setExisting(true);
        }
      })
      .catch(() => {
        if (active) setError("localStorageFailed");
      });
    return () => {
      active = false;
    };
  }, []);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onStart(name);
    } catch (e) {
      setError(e.code || "localStorageFailed");
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
          <CircleDot size={30} />
        </span>
        <h1>{t("offlineSetup")}</h1>
        <p>{t("offlineSetupSub")}</p>
        <form onSubmit={submit}>
          <Field
            label="fleetName"
            hint={existing ? "localExisting" : undefined}
          >
            <input
              name="fleetName"
              required
              maxLength={80}
              value={name}
              readOnly={existing}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          {error && (
            <div className="form-error" role="alert">
              {t(error)}
            </div>
          )}
          <Button disabled={busy} icon={ArrowRight}>
            {t(busy ? "loading" : "offlineStart")}
          </Button>
          <Button secondary type="button" disabled={busy} onClick={onCancel}>
            {t("cancel")}
          </Button>
        </form>
        <p className="offline-disclosure">{t("localHint")}</p>
        <p className="small muted">{t("localTeamHint")}</p>
      </section>
    </div>
  );
}
function ServerConnect({ onConnect }) {
  const { t, openOffline } = useApp();
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
        <div className="offline-choice">
          <Button secondary icon={CircleDot} onClick={openOffline}>
            {t("useOffline")}
          </Button>
        </div>
      </section>
    </div>
  );
}
function Auth({ boot, onAuth, changeServer }) {
  const { t, openOffline } = useApp();
  const [mode, setMode] = useState(boot.setupRequired ? "create" : "login");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setError("");
    const p = Object.fromEntries(new FormData(e.currentTarget));
    if (mode !== "login" && p.password !== p.confirm)
      return setError("passwordsDiffer");
    setBusy(true);
    try {
      const data = await request(mode === "login" ? "/login" : "/register", p);
      await onAuth(data);
    } catch (e) {
      setError(e.code);
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
        <small>TyreSaathi · {t("tagline")}</small>
      </section>
      <section className="auth-form-side">
        <div className="auth-top">
          <div className="mobile-brand">
            <Brand compact />
          </div>
          <LanguageSwitch />
        </div>
        <div className="auth-card">
          <span className="eyebrow">TYRESAATHI LOGBOOK</span>
          <h1>
            {t(
              mode === "create"
                ? "setupTitle"
                : mode === "join"
                  ? "joinTitle"
                  : "loginTitle",
            )}
          </h1>
          <p>
            {t(
              mode === "create"
                ? "setupSub"
                : mode === "join"
                  ? "joinSub"
                  : "loginSub",
            )}
          </p>
          {!boot.setupRequired && (
            <div className="segmented">
              <button
                className={mode === "login" ? "selected" : ""}
                onClick={() => {
                  setMode("login");
                  setError("");
                }}
              >
                {t("signIn")}
              </button>
              <button
                className={mode === "join" ? "selected" : ""}
                onClick={() => {
                  setMode("join");
                  setError("");
                }}
              >
                {t("join")}
              </button>
            </div>
          )}
          <form onSubmit={submit} key={mode}>
            {mode === "create" && (
              <>
                <Field label="fleetName">
                  <input
                    name="fleetName"
                    required
                    maxLength={80}
                    autoComplete="organization"
                    placeholder="Sharma Transport"
                  />
                </Field>
                {boot.setupKeyRequired && (
                  <Field label="setupKey" hint="setupKeyHint">
                    <input
                      name="setupKey"
                      type="password"
                      required
                      autoComplete="off"
                    />
                  </Field>
                )}
              </>
            )}
            {mode === "join" && (
              <Field label="inviteCode">
                <input
                  name="invite"
                  required
                  autoComplete="off"
                  spellCheck="false"
                />
              </Field>
            )}
            <Field
              label="username"
              hint={mode !== "login" ? "usernameHint" : undefined}
            >
              <input
                name="username"
                required
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck="false"
                autoComplete="username"
                pattern="[a-zA-Z0-9_.\-]{3,40}"
                maxLength={40}
              />
            </Field>
            <PasswordField
              hint={mode !== "login" ? "passwordHint" : undefined}
              minLength={mode !== "login" ? 10 : undefined}
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
            />
            {mode !== "login" && (
              <PasswordField
                name="confirm"
                label="confirmPassword"
                autoComplete="new-password"
              />
            )}
            {error && (
              <div role="alert" className="form-error">
                <AlertCircle size={18} />
                {t(error)}
              </div>
            )}
            <Button icon={ArrowRight} disabled={busy}>
              {t(
                busy
                  ? "loading"
                  : mode === "create"
                    ? "createFleet"
                    : mode === "join"
                      ? "submitJoin"
                      : "submitLogin",
              )}
            </Button>
          </form>
          <div className="auth-foot">
            <ShieldCheck size={15} />
            <span>{t("privacy")}</span>
          </div>
          <div className="offline-choice">
            <Button secondary icon={CircleDot} onClick={openOffline}>
              {t("useOffline")}
            </Button>
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
    daily = dailyTally(state, day);
  const emptySlots = state.vehicles.reduce(
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
        <Button
          secondary
          icon={Plus}
          onClick={() => setModal({ type: "addVehicle" })}
          disabled={offline}
        >
          {t("addVehicle")}
        </Button>
        <Button
          icon={Plus}
          onClick={() => setModal({ type: "addTyre" })}
          disabled={offline}
        >
          {t("addTyre")}
        </Button>
      </PageHeading>
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
            value: state.vehicles.length,
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
            <input
              aria-label={t("date")}
              type="date"
              value={day}
              max={dayKey()}
              onChange={(e) => setDay(e.target.value || dayKey())}
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
              {t("tallyScrapped")}: {n(daily.scrapped)}
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
      {!state.tyres.length && !state.vehicles.length && (
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
          {!state.vehicles.length ? (
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
              {state.vehicles.slice(0, 3).map((v) => {
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
  const { t, date } = useApp();
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
        <span>{[e.tyre, e.vehicle, e.slot].filter(Boolean).join(" · ")}</span>
        <small>
          {e.actor} · {date(e.timestamp, true)}
        </small>
        {e.note && <p className="activity-note">{e.note}</p>}
      </div>
    </div>
  );
}
function Vehicles() {
  const { t, n, state, navigate, setModal, offline } = useApp();
  const [query, setQuery] = useState("");
  const vehicles = state.vehicles.filter((v) =>
    `${v.registration} ${v.name}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <PageHeading title={t("vehicles")} sub={t("noVehiclesSub")}>
        <Button
          icon={Plus}
          disabled={offline}
          onClick={() => setModal({ type: "addVehicle" })}
        >
          {t("addVehicle")}
        </Button>
      </PageHeading>
      <div className="toolbar">
        <SearchInput
          placeholder="searchVehicles"
          value={query}
          onChange={setQuery}
        />
        <span className="muted small">
          {n(state.vehicles.length)} {t("vehicles")}
        </span>
      </div>
      {!vehicles.length ? (
        <section className="card">
          <Empty
            icon={Truck}
            title={query ? "noResults" : "noVehicles"}
            sub={query ? "noResultsSub" : "noVehiclesSub"}
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
                <p>{v.name || t("vehicle")}</p>
                <div className="vehicle-progress">
                  <span>{t("roadTyres")}</span>
                  <strong>{n(road)} / 18</strong>
                  <div>
                    <i style={{ width: `${(road / 18) * 100}%` }} />
                  </div>
                </div>
                <div className="vehicle-meta">
                  <span>
                    <Gauge size={16} />
                    {n(v.odometer)} {t("km")}
                  </span>
                  <span>
                    {t("spare")}:{" "}
                    {v.hasSpare
                      ? `${tyres.some((t) => t.slot === "SP") ? 1 : 0}/1`
                      : "—"}
                  </span>
                </div>
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
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
function VehicleDetail({ id }) {
  const { t, n, state, setModal, offline } = useApp();
  const v = state.vehicles.find((v) => v.id === id);
  if (!v) return null;
  const tyres = state.tyres.filter((t) => t.vehicleId === id),
    count = tyres.filter((t) => t.slot !== "SP").length;
  function wheel(slot) {
    const tyre = tyres.find((t) => t.slot === slot);
    return (
      <button
        key={slot}
        aria-label={`${slot} · ${tyre?.serial || t("empty")}`}
        className={`wheel ${tyre ? `wheel-${tyre.type}` : "wheel-empty"}`}
        onClick={() =>
          setModal(
            tyre
              ? { type: "tyre", id: tyre.id }
              : { type: "fit", vehicleId: id, slot },
          )
        }
        disabled={!tyre && offline}
      >
        <span className="tread-line" />
        <CircleDot size={22} />
        <strong>{slot}</strong>
        <small>{tyre?.serial || "+"}</small>
      </button>
    );
  }
  return (
    <>
      <PageHeading title={v.registration} sub={v.name || t("slotHint")} back>
        <Button
          secondary
          icon={Gauge}
          disabled={offline}
          onClick={() => setModal({ type: "updateOdometer", vehicleId: id })}
        >
          {t("updateOdometer")}
        </Button>
      </PageHeading>
      <div className="vehicle-detail-columns">
        <section className="card wheel-map">
          <div className="card-title-row">
            <div>
              <h2>{t("road")}</h2>
              <p>{t("slotHint")}</p>
            </div>
            <Badge type={count === 18 ? "new" : "used"}>{n(count)} / 18</Badge>
          </div>
          <div className="truck-map">
            <div className="truck-cab">
              <Truck size={28} />
              <span>{t("front")}</span>
            </div>
            <div className="wheel-sides">
              <span>{t("left")}</span>
              <span>{t("right")}</span>
            </div>
            <div className="axle-row front-axle">
              {wheel("FL")}
              <span className="axle-label">1</span>
              {wheel("FR")}
            </div>
            {[2, 3, 4, 5].map((a) => (
              <div className="axle-row" key={a}>
                <div>
                  {wheel(`${a}LO`)}
                  {wheel(`${a}LI`)}
                </div>
                <span className="axle-label">{a}</span>
                <div>
                  {wheel(`${a}RI`)}
                  {wheel(`${a}RO`)}
                </div>
              </div>
            ))}
            <div className="spare-position">
              <span>{t("spare")}</span>
              {v.hasSpare ? wheel("SP") : <small>{t("noSpare")}</small>}
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
      (status === "all" || tyre.status === status) &&
      (type === "all" || tyre.type === type) &&
      `${tyre.serial} ${tyre.brand} ${tyre.size} ${state.vehicles.find((v) => v.id === tyre.vehicleId)?.registration || ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <>
      <PageHeading title={t("inventory")} sub={t("aboutTally")}>
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
            ["all", "all"],
            ["stock", "garage"],
            ["installed", "onRoad"],
            ["scrapped", "scrapped"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={status === key ? "selected" : ""}
              onClick={() => setStatus(key)}
            >
              {t(label)}
              <span>
                {n(
                  state.tyres.filter((t) => key === "all" || t.status === key)
                    .length,
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
                  <span className={`tyre-icon tyre-${tyre.type}`}>
                    <CircleDot size={26} />
                  </span>
                  <span className="tyre-main">
                    <strong>{tyre.serial}</strong>
                    <small>
                      {tyre.brand} · {tyre.size}
                    </small>
                  </span>
                  <span className="tyre-status">
                    <Badge type={tyre.type} />
                    <small>
                      {v
                        ? `${v.registration} · ${tyre.slot}`
                        : t(tyre.status === "stock" ? "garage" : "scrapped")}
                    </small>
                  </span>
                  <span className="tyre-distance">
                    {n(tyreKm(tyre, state))}
                    <small>{t("km")}</small>
                  </span>
                  <ChevronRight size={17} />
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
  if (native) {
    const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([
      import("@capacitor/filesystem"),
      import("@capacitor/share"),
    ]);
    const file = await Filesystem.writeFile({
      path: name,
      data: content,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    await Share.share({ title: name, url: file.uri });
    return;
  }
  const link = document.createElement("a");
  const url = URL.createObjectURL(new Blob([content], { type }));
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
        (!day || e.date === day) &&
        `${e.tyre || ""} ${e.vehicle || ""} ${e.actor} ${e.note} ${t("move_" + e.kind)}`
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
        "Time (UTC)",
        "Movement",
        "Tyre",
        "Vehicle",
        "Position",
        "Odometer",
        "Staff",
        "Note",
      ],
      ...events.map((e) => [
        e.date,
        e.timestamp,
        t("move_" + e.kind),
        e.tyre,
        e.vehicle,
        e.slot,
        e.odometer,
        e.actor,
        e.note,
      ]),
    ];
    await download(
      `TyreSaathi-log-${day || dayKey()}.csv`,
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
            <input
              aria-label={t("date")}
              type="date"
              value={day}
              max={dayKey()}
              onChange={(e) => setDay(e.target.value)}
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
    localMode,
    openOffline,
    leaveLocal,
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
    if (!localMode && session.user.role === "owner") load();
  }, []);
  async function invite() {
    try {
      const data = await request("/team/invite", {});
      setModal({ type: "invite", invite: data.invite });
    } catch (e) {
      setToast({ text: t(e.code), error: true });
    }
  }
  return (
    <>
      <PageHeading
        title={t("settings")}
        sub={t(localMode ? "localTeamHint" : "teamSub")}
      />
      <div className="settings-grid">
        <section className="card settings-card">
          <h2>
            <Users size={20} />
            {t(localMode ? "localAccount" : "team")}
          </h2>
          <div className="business-info">
            <span className="avatar">
              {session.fleetName.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <strong>{session.fleetName}</strong>
              <small>
                {localMode
                  ? t("thisPhone")
                  : `${session.user.username} · ${t(session.user.role)}`}
              </small>
            </div>
          </div>
          {localMode && (
            <>
              <p>{t("localHint")}</p>
              <p className="small muted">{t("localTeamHint")}</p>
              <Button secondary icon={Link} onClick={leaveLocal}>
                {t("sharedMode")}
              </Button>
            </>
          )}
          {!localMode && session.user.role === "owner" && (
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
              <Button secondary icon={Plus} disabled={offline} onClick={invite}>
                {t("rotateInvite")}
              </Button>
              <p className="small muted">{t("inviteHint")}</p>
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
            {!localMode && (
              <button
                className="setting-button"
                disabled={offline}
                onClick={() => setModal({ type: "password" })}
              >
                {t("changePassword")}
                <ChevronRight size={17} />
              </button>
            )}
            {!localMode && native && (
              <button className="setting-button" onClick={onChangeServer}>
                {t("changeServer")}
                <ChevronRight size={17} />
              </button>
            )}
            {!localMode && (
              <button className="setting-button" onClick={openOffline}>
                {t("useOffline")}
                <ChevronRight size={17} />
              </button>
            )}
            {!localMode && (
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
            )}
          </section>
          <section className="card settings-card">
            <h2>
              <Download size={20} />
              {t("backup")}
            </h2>
            <p>{t(localMode ? "localExportHint" : "exportHint")}</p>
            <Button
              secondary
              icon={Download}
              onClick={async () => {
                try {
                  await download(
                    `TyreSaathi-records-${dayKey()}.json`,
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
            <p className="small muted">
              {t(localMode ? "localHint" : "privacy")}
            </p>
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
function Dialog({ title, children, onClose, busy = false, wide = false }) {
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
      className={`dialog ${wide ? "wide" : ""}`}
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
    </dialog>
  );
}
function ModalContent({ modal, onClose }) {
  if (modal.type === "tyre")
    return <TyreDetails id={modal.id} onClose={onClose} />;
  if (modal.type === "invite")
    return <InviteModal invite={modal.invite} onClose={onClose} />;
  if (modal.type === "confirm")
    return <ConfirmModal {...modal} onClose={onClose} />;
  return <RecordForm modal={modal} onClose={onClose} />;
}
function InviteModal({ invite, onClose }) {
  const { t, setToast } = useApp();
  const ref = useRef();
  async function copy() {
    try {
      await navigator.clipboard.writeText(invite);
      setToast({ text: t("copied") });
    } catch {
      ref.current.select();
    }
  }
  return (
    <Dialog title={t("inviteCode")} onClose={onClose}>
      <p>{t("inviteReadySub")}</p>
      <input
        ref={ref}
        className="invite-code"
        aria-label={t("inviteCode")}
        readOnly
        value={invite}
        onFocus={(e) => e.target.select()}
      />
      <div className="form-actions">
        <Button secondary icon={Copy} onClick={copy}>
          {t("copy")}
        </Button>
        <Button onClick={onClose}>{t("done")}</Button>
      </div>
      <p className="small muted">{t("inviteHint")}</p>
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
function TyreDetails({ id, onClose }) {
  const { t, n, date, state, setModal, action, offline } = useApp();
  const tyre = state.tyres.find((t) => t.id === id);
  if (!tyre) return null;
  const vehicle = state.vehicles.find((v) => v.id === tyre.vehicleId);
  return (
    <Dialog title={tyre.serial} onClose={onClose}>
      <div className="tyre-detail-hero">
        <span className={`tyre-icon tyre-${tyre.type}`}>
          <CircleDot size={36} />
        </span>
        <div>
          <h3>{tyre.brand}</h3>
          <p>{tyre.size}</p>
          <Badge type={tyre.type} />
        </div>
        <Badge
          type={
            tyre.status === "stock"
              ? "new"
              : tyre.status === "scrapped"
                ? "scrapped"
                : "installed"
          }
        >
          {t(
            tyre.status === "stock"
              ? "garage"
              : tyre.status === "installed"
                ? "onRoad"
                : "scrapped",
          )}
        </Badge>
      </div>
      <div className="detail-stats">
        <div>
          <span>{t("currentKm")}</span>
          <strong>
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
                {vehicle.registration} · {tyre.slot}
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
      <p className="small muted">{t("distanceHint")}</p>
      {tyre.status !== "scrapped" && (
        <div className="tyre-actions">
          {tyre.status === "stock" ? (
            <>
              <Button
                icon={ArrowUpRight}
                disabled={offline || !state.vehicles.length}
                onClick={() => setModal({ type: "fit", tyreId: id })}
              >
                {t("fit")}
              </Button>
              <Button
                secondary
                icon={RefreshCw}
                disabled={offline}
                onClick={() =>
                  setModal({
                    type: "confirm",
                    title: "remoldAction",
                    text: "confirmRemold",
                    run: () => action("remold", { tyreId: id }),
                  })
                }
              >
                {t("remoldAction")}
              </Button>
              <button
                className="text-button danger"
                disabled={offline}
                onClick={() =>
                  setModal({
                    type: "confirm",
                    title: "scrapAction",
                    text: "confirmScrap",
                    run: () => action("scrap", { tyreId: id }),
                  })
                }
              >
                <Trash2 size={16} />
                {t("scrapAction")}
              </button>
            </>
          ) : (
            <Button
              icon={ArrowDownLeft}
              disabled={offline}
              onClick={() =>
                setModal({ type: "remove", tyreId: id, vehicleId: vehicle.id })
              }
            >
              {t("remove")}
            </Button>
          )}
        </div>
      )}
      <h3 className="history-heading">{t("tyreHistory")}</h3>
      {state.events
        .filter((e) => e.tyre === tyre.serial)
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
  const [vehicleId, setVehicleId] = useState(m.vehicleId || ""),
    [slot, setSlot] = useState(m.slot || "");
  const vehicle = state.vehicles.find((v) => v.id === vehicleId),
    tyre = state.tyres.find((t) => t.id === m.tyreId);
  const available = [...slots, ...(vehicle?.hasSpare ? ["SP"] : [])].filter(
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
        : m.type;
  async function submit(e) {
    e.preventDefault();
    if (offline) return setError("offlineHint");
    setBusy(true);
    setError("");
    const p = Object.fromEntries(new FormData(e.currentTarget));
    try {
      if (m.type === "addVehicle") p.hasSpare = p.hasSpare === "on";
      if (m.type === "password") {
        if (p.password !== p.confirm) throw { code: "passwordsDiffer" };
        await request("/password", p);
        setToast({ text: t("passwordChanged") });
      } else
        await action(m.type, {
          ...p,
          ...(m.tyreId ? { tyreId: m.tyreId } : {}),
          ...(vehicleId ? { vehicleId } : {}),
        });
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
            <div className="form-grid">
              <Field label="brand">
                <input
                  name="brand"
                  required
                  maxLength={80}
                  placeholder="MRF / Apollo / CEAT"
                />
              </Field>
              <Field label="size">
                <input
                  name="size"
                  required
                  maxLength={40}
                  placeholder="295/90 R20"
                />
              </Field>
            </div>
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
                {state.vehicles.map((v) => (
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
                    {s === "SP" ? `${s} · ${t("spare")}` : s}
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
                  {tyre.serial} · {tyre.slot}
                </span>
              )}
            </div>
            <KmInput
              name="odometer"
              value={vehicle?.odometer}
              min={vehicle?.odometer}
            />
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
          <Field label="notes">
            <textarea name="note" rows={3} maxLength={500} />
          </Field>
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
function KmInput({ name, value, min = 0, label = "odometer" }) {
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
      />
    </Field>
  );
}

createRoot(document.getElementById("root")).render(<App />);
if ("serviceWorker" in navigator && import.meta.env.PROD && !native)
  navigator.serviceWorker.register("/sw.js").catch(() => {});
