import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import logoUrl from "../../../assets/branding/selfrelay-logo.png";
import type {
  CheckpointRecord,
  ContextSnapshot,
  DiscoveredApplication,
  RecoveryView,
  TrackedApplication,
  TrackingStatus,
} from "./types";

function appInitial(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || "A";
}

function mergeApps(discovered: DiscoveredApplication[], tracked: TrackedApplication[]) {
  const map = new Map<string, DiscoveredApplication>();
  for (const app of discovered) map.set(app.applicationId, app);
  for (const app of tracked) {
    if (!map.has(app.applicationId)) {
      map.set(app.applicationId, { ...app, running: false, foreground: false });
    }
  }
  return [...map.values()].sort((a, b) => Number(b.foreground) - Number(a.foreground) || a.applicationName.localeCompare(b.applicationName));
}

function formatCheckpointTime(value: number) {
  try {
    return new Intl.DateTimeFormat("es-UY", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
  } catch {
    return "";
  }
}

export default function App() {
  const [discovered, setDiscovered] = useState<DiscoveredApplication[]>([]);
  const [tracked, setTracked] = useState<TrackedApplication[]>([]);
  const [onboardingCompleted, setOnboardingCompleted] = useState<boolean | null>(null);
  const [status, setStatus] = useState<TrackingStatus>({ active: true, observer: "win32" });
  const [capture, setCapture] = useState<ContextSnapshot | null>(null);
  const [recovery, setRecovery] = useState<RecoveryView | null>(null);
  const [history, setHistory] = useState<CheckpointRecord[]>([]);
  const [selected, setSelected] = useState<Map<string, TrackedApplication>>(new Map());
  const [checkpointText, setCheckpointText] = useState("");
  const [section, setSection] = useState<"apps" | "history">("apps");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextDiscovered, nextTracked, nextOnboarding, nextStatus, nextCapture, nextRecovery, nextHistory] = await Promise.all([
        invoke<DiscoveredApplication[]>("get_discovered_applications"),
        invoke<TrackedApplication[]>("get_tracked_applications"),
        invoke<boolean>("get_onboarding_completed"),
        invoke<TrackingStatus>("get_tracking_status"),
        invoke<ContextSnapshot | null>("get_pending_capture"),
        invoke<RecoveryView | null>("get_active_recovery"),
        invoke<CheckpointRecord[]>("get_checkpoint_history"),
      ]);
      setDiscovered(nextDiscovered);
      setTracked(nextTracked);
      setOnboardingCompleted(nextOnboarding);
      setStatus(nextStatus);
      setCapture(nextCapture);
      setRecovery(nextRecovery);
      setHistory(nextHistory);
      setSelected((current) => {
        if (nextOnboarding || current.size > 0) return current;
        return new Map(nextTracked.map((app) => [app.applicationId, app]));
      });
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const unlisteners = Promise.all([
      listen("desktop://windows-changed", () => void refresh()),
      listen("desktop://tracking-changed", () => void refresh()),
      listen("desktop://tracking-rules-changed", () => void refresh()),
      listen("desktop://checkpoint-changed", () => void refresh()),
    ]);
    return () => {
      void unlisteners.then((items) => items.forEach((unlisten) => unlisten()));
    };
  }, [refresh]);

  const allApps = useMemo(() => mergeApps(discovered, tracked), [discovered, tracked]);
  const runningIds = useMemo(() => new Set(discovered.map((app) => app.applicationId)), [discovered]);

  const chooseExecutable = async (persistImmediately: boolean) => {
    setBusy(true);
    try {
      const picked = await invoke<TrackedApplication | null>("pick_application_executable");
      if (!picked) return;
      if (persistImmediately) {
        await invoke("set_application_tracking", { application: picked, enabled: true });
      } else {
        setSelected((current) => new Map(current).set(picked.applicationId, picked));
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const finishOnboarding = async () => {
    setBusy(true);
    try {
      await invoke("complete_onboarding", { applications: [...selected.values()] });
      setOnboardingCompleted(true);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const removeTracked = async (application: TrackedApplication) => {
    setBusy(true);
    try {
      await invoke("set_application_tracking", { application, enabled: false });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const togglePaused = async () => {
    setBusy(true);
    try {
      await invoke("set_tracking_paused", { paused: status.active });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const saveCapture = async () => {
    if (!checkpointText.trim()) return;
    setBusy(true);
    try {
      await invoke("save_checkpoint", { text: checkpointText });
      setCheckpointText("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  if (onboardingCompleted === null) {
    return <main className="shell loading-shell"><img src={logoUrl} alt="" className="loading-logo" /></main>;
  }

  if (!onboardingCompleted) {
    return (
      <main className="shell onboarding-shell">
        <section className="onboarding-card">
          <div className="onboarding-brand"><img src={logoUrl} alt="" /><span>SelfRelay</span></div>
          <p className="eyebrow">Configuración inicial</p>
          <h1>Elegí dónde querés que SelfRelay te acompañe.</h1>
          <p className="lead">Solo las aplicaciones que selecciones podrán generar checkpoints. Podés cambiar esta lista cuando quieras.</p>

          <div className="selection-list">
            {allApps.length === 0 ? (
              <div className="empty-state compact"><strong>No hay aplicaciones elegibles abiertas.</strong><span>Podés abrir una aplicación o añadir su ejecutable manualmente.</span></div>
            ) : allApps.map((application) => {
              const checked = selected.has(application.applicationId);
              return (
                <label className={`selection-row ${checked ? "selected" : ""}`} key={application.applicationId}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => setSelected((current) => {
                      const next = new Map(current);
                      if (next.has(application.applicationId)) next.delete(application.applicationId);
                      else next.set(application.applicationId, application);
                      return next;
                    })}
                  />
                  <span className="app-icon">{appInitial(application.applicationName)}</span>
                  <span className="app-copy"><strong>{application.applicationName}</strong><small>{application.running ? "Abierta ahora" : "Añadida manualmente"}</small></span>
                  <span className="checkmark" aria-hidden="true">✓</span>
                </label>
              );
            })}
          </div>

          <div className="onboarding-actions">
            <button className="button secondary" disabled={busy} onClick={() => void chooseExecutable(false)}>+ Añadir aplicación</button>
            <button className="button primary" disabled={busy} onClick={() => void finishOnboarding()}>Continuar</button>
          </div>
          <p className="privacy-note">SelfRelay usa metadata mínima de ventanas. No toma capturas, no lee documentos, no registra teclas y no sube datos.</p>
          {error && <div className="notice notice-error">{error}</div>}
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><img src={logoUrl} alt="" className="brand-logo" /><span>SelfRelay</span></div>
        <div className="top-actions">
          <button className="text-button" onClick={() => setSection(section === "apps" ? "history" : "apps")}>{section === "apps" ? "Historial" : "Aplicaciones"}</button>
          <button className={`status ${status.active ? "status-active" : "status-paused"}`} disabled={busy} onClick={() => void togglePaused()}>
            <span className="status-dot" />{status.active ? "Activo" : "Pausado"}
          </button>
        </div>
      </header>

      <section className="content">
        {section === "apps" ? (
          <>
            <div className="section-heading">
              <div><p className="eyebrow">Tu entorno</p><h1>Aplicaciones</h1><p className="section-description">SelfRelay solo crea checkpoints para esta lista.</p></div>
              <button className="button primary compact-button" disabled={busy} onClick={() => void chooseExecutable(true)}>+ Añadir</button>
            </div>

            {tracked.length === 0 ? (
              <div className="empty-state"><strong>No seguís ninguna aplicación.</strong><span>Añadí una para activar el loop de checkpoint y retorno.</span></div>
            ) : (
              <div className="app-list">
                {tracked.map((application) => (
                  <article className="app-row" key={application.applicationId}>
                    <span className="app-icon">{appInitial(application.applicationName)}</span>
                    <div className="app-copy"><strong>{application.applicationName}</strong><small>{runningIds.has(application.applicationId) ? "Abierta · elegible ahora" : "En seguimiento"}</small></div>
                    <span className={`availability ${runningIds.has(application.applicationId) ? "online" : ""}`}>{runningIds.has(application.applicationId) ? "Activa" : "Esperando"}</span>
                    <button className="icon-button" title="Quitar aplicación" disabled={busy} onClick={() => void removeTracked(application)}>Quitar</button>
                  </article>
                ))}
              </div>
            )}
            <p className="privacy-line">La observación de Windows descubre solo metadata necesaria para reconocer aplicaciones. Checkpoint y recovery se limitan a las que elegiste.</p>
          </>
        ) : (
          <>
            <div className="section-heading"><div><p className="eyebrow">Local</p><h1>Historial</h1><p className="section-description">Tus checkpoints guardados; los resueltos no vuelven a aparecer automáticamente.</p></div></div>
            {history.length === 0 ? <div className="empty-state"><strong>Todavía no hay checkpoints.</strong><span>Van a aparecer acá después de guardarlos.</span></div> : (
              <div className="history-list">{history.map((item) => (
                <article className="history-row" key={item.id}>
                  <div className="history-meta"><strong>{item.applicationName}</strong><span>{item.contextLabel}</span><time>{formatCheckpointTime(item.createdAtMs)}</time></div>
                  <p>{item.text}</p>
                  <span className={`history-state ${item.resolvedAtMs ? "resolved" : "pending"}`}>{item.resolvedAtMs ? "Retomado" : "Pendiente"}</span>
                </article>
              ))}</div>
            )}
          </>
        )}
        {error && <div className="notice notice-error global-error">{error}</div>}
      </section>

      {capture && (
        <div className="modal-backdrop">
          <section className="checkpoint-modal" role="dialog" aria-modal="true" aria-labelledby="capture-title">
            <div className="modal-brand"><img src={logoUrl} alt="" /><span>SelfRelay</span></div>
            <p className="eyebrow">{capture.applicationName}</p>
            <h2 id="capture-title">¿Dónde quedaste?</h2>
            <p className="context-line">{capture.contextLabel}</p>
            <textarea autoFocus value={checkpointText} onChange={(event) => setCheckpointText(event.target.value)} placeholder="Dejá lo mínimo que necesitás para retomar después…" />
            <div className="modal-actions">
              <button className="button secondary" disabled={busy} onClick={() => void invoke("dismiss_capture").then(() => refresh())}>No guardar</button>
              <button className="button primary" disabled={busy || !checkpointText.trim()} onClick={() => void saveCapture()}>Guardar checkpoint</button>
            </div>
          </section>
        </div>
      )}

      {!capture && recovery && (
        <div className="modal-backdrop">
          <section className="checkpoint-modal recovery-modal" role="dialog" aria-modal="true" aria-labelledby="recovery-title">
            <div className="modal-brand"><img src={logoUrl} alt="" /><span>SelfRelay</span></div>
            <p className="eyebrow">Recuperación</p>
            <h2 id="recovery-title">Volviste a {recovery.applicationName}</h2>
            <p className="context-line">{recovery.contextLabel}</p>
            <div className="pending-list">
              {recovery.checkpoints.map((item) => (
                <article className="pending-checkpoint" key={item.id}>
                  <div><time>{formatCheckpointTime(item.createdAtMs)}</time><p>{item.text}</p></div>
                  <button className="button secondary resolve-button" disabled={busy} onClick={() => void invoke("resolve_checkpoint", { id: item.id }).then(() => refresh())}>Ya retomé</button>
                </article>
              ))}
            </div>
            <div className="modal-actions single"><button className="button secondary" disabled={busy} onClick={() => void invoke("defer_recovery").then(() => refresh())}>Lo veo después</button></div>
          </section>
        </div>
      )}
    </main>
  );
}
