import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const DESKTOP_VERSION = "0.1.1";

function appInitial(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || "A";
}

function formatCheckpointTime(value: number) {
  try {
    return new Intl.DateTimeFormat("es-UY", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
  } catch {
    return "";
  }
}

function byApplicationName<T extends { applicationName: string }>(a: T, b: T) {
  return a.applicationName.localeCompare(b.applicationName);
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
  const onboardingSelectionInitialized = useRef(false);

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
      if (!nextOnboarding && !onboardingSelectionInitialized.current) {
        onboardingSelectionInitialized.current = true;
        setSelected(new Map(nextTracked.map((application) => [application.applicationId, application])));
      }
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

  const trackedIds = useMemo(() => new Set(tracked.map((application) => application.applicationId)), [tracked]);
  const availableNow = useMemo(
    () => discovered.filter((application) => !trackedIds.has(application.applicationId)).sort(byApplicationName),
    [discovered, trackedIds],
  );
  const onboardingSelected = useMemo(() => [...selected.values()].sort(byApplicationName), [selected]);
  const onboardingAvailable = useMemo(
    () => discovered.filter((application) => !selected.has(application.applicationId)).sort(byApplicationName),
    [discovered, selected],
  );
  const runningIds = useMemo(() => new Set(discovered.map((application) => application.applicationId)), [discovered]);

  const chooseExecutable = async (persistImmediately: boolean) => {
    setBusy(true);
    try {
      const picked = await invoke<TrackedApplication | null>("pick_application_executable");
      if (!picked) return;
      if (persistImmediately) {
        await invoke("set_application_tracking", { application: picked, enabled: true });
        await refresh();
      } else {
        setSelected((current) => new Map(current).set(picked.applicationId, picked));
      }
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const addTracked = async (application: TrackedApplication) => {
    setBusy(true);
    try {
      await invoke("set_application_tracking", { application, enabled: true });
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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const finishOnboarding = async () => {
    setBusy(true);
    try {
      await invoke("complete_onboarding", { applications: onboardingSelected });
      setOnboardingCompleted(true);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const togglePaused = async () => {
    setBusy(true);
    try {
      await invoke("set_tracking_paused", { paused: status.active });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
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
          <div className="onboarding-brand"><img src={logoUrl} alt="" /><span>SelfRelay</span><small>v{DESKTOP_VERSION}</small></div>
          <p className="eyebrow">Configuración inicial</p>
          <h1>Elegí qué aplicaciones querés seguir.</h1>
          <p className="lead">SelfRelay empieza con cero aplicaciones en seguimiento. Solo lo que añadas explícitamente podrá generar checkpoints.</p>

          <div className="management-group">
            <div className="group-heading"><strong>En seguimiento al continuar</strong><span>{onboardingSelected.length}</span></div>
            {onboardingSelected.length === 0 ? (
              <div className="empty-state compact"><strong>Ninguna aplicación seleccionada.</strong><span>Podés continuar así y SelfRelay no seguirá nada.</span></div>
            ) : (
              <div className="app-list">{onboardingSelected.map((application) => (
                <article className="app-row" key={application.applicationId}>
                  <span className="app-icon">{appInitial(application.applicationName)}</span>
                  <div className="app-copy"><strong>{application.applicationName}</strong><small>En seguimiento</small></div>
                  <button className="button secondary row-action" disabled={busy} onClick={() => setSelected((current) => {
                    const next = new Map(current);
                    next.delete(application.applicationId);
                    return next;
                  })}>Quitar</button>
                </article>
              ))}</div>
            )}
          </div>

          <div className="management-group">
            <div className="group-heading"><strong>Disponibles ahora</strong><span>{onboardingAvailable.length}</span></div>
            {onboardingAvailable.length === 0 ? (
              <div className="empty-state compact"><strong>No hay otras aplicaciones elegibles abiertas.</strong><span>Abrí Notepad, Paint u otra app para verla acá, o elegí un ejecutable.</span></div>
            ) : (
              <div className="app-list">{onboardingAvailable.map((application) => (
                <article className="app-row" key={application.applicationId}>
                  <span className="app-icon">{appInitial(application.applicationName)}</span>
                  <div className="app-copy"><strong>{application.applicationName}</strong><small>Abierta ahora · no seguida</small></div>
                  <button className="button primary row-action" disabled={busy} onClick={() => setSelected((current) => new Map(current).set(application.applicationId, application))}>Añadir</button>
                </article>
              ))}</div>
            )}
          </div>

          <div className="onboarding-actions">
            <button className="button secondary" disabled={busy} onClick={() => void chooseExecutable(false)}>Elegir otra aplicación</button>
            <button className="button primary" disabled={busy} onClick={() => void finishOnboarding()}>Continuar</button>
          </div>
          <p className="privacy-note">Todo queda local. SelfRelay usa metadata mínima de ventanas para reconocer las aplicaciones que elegiste; no lee documentos, no registra teclas y no sube datos.</p>
          {error && <div className="notice notice-error">{error}</div>}
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><img src={logoUrl} alt="" className="brand-logo" /><span>SelfRelay</span><small>v{DESKTOP_VERSION}</small></div>
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
              <div><p className="eyebrow">Tu entorno</p><h1>Aplicaciones</h1><p className="section-description">Añadí o quitá aplicaciones en cualquier momento. Solo las marcadas como “En seguimiento” pueden generar checkpoints.</p></div>
            </div>

            <div className="management-group">
              <div className="group-heading"><strong>En seguimiento</strong><span>{tracked.length}</span></div>
              {tracked.length === 0 ? (
                <div className="empty-state"><strong>No seguís ninguna aplicación.</strong><span>No se crearán checkpoints hasta que añadas una aplicación de forma explícita.</span></div>
              ) : (
                <div className="app-list">
                  {tracked.map((application) => (
                    <article className="app-row" key={application.applicationId}>
                      <span className="app-icon">{appInitial(application.applicationName)}</span>
                      <div className="app-copy"><strong>{application.applicationName}</strong><small>{runningIds.has(application.applicationId) ? "En seguimiento · abierta ahora" : "En seguimiento · esperando"}</small></div>
                      <span className="tracked-badge">En seguimiento</span>
                      <button className="button secondary row-action" disabled={busy} onClick={() => void removeTracked(application)}>Quitar</button>
                    </article>
                  ))}
                </div>
              )}
            </div>

            <div className="management-group">
              <div className="group-heading"><strong>Disponibles ahora</strong><span>{availableNow.length}</span></div>
              {availableNow.length === 0 ? (
                <div className="empty-state compact"><strong>No hay aplicaciones nuevas disponibles.</strong><span>Abrí una aplicación de escritorio elegible y aparecerá acá automáticamente.</span></div>
              ) : (
                <div className="app-list">
                  {availableNow.map((application) => (
                    <article className="app-row" key={application.applicationId}>
                      <span className="app-icon">{appInitial(application.applicationName)}</span>
                      <div className="app-copy"><strong>{application.applicationName}</strong><small>Abierta ahora · no seguida</small></div>
                      <button className="button primary row-action" disabled={busy} onClick={() => void addTracked(application)}>Añadir</button>
                    </article>
                  ))}
                </div>
              )}
            </div>

            <div className="manual-add-row">
              <div><strong>¿No aparece la aplicación?</strong><span>Elegí su archivo .exe como alternativa.</span></div>
              <button className="button secondary" disabled={busy} onClick={() => void chooseExecutable(true)}>Elegir otra aplicación</button>
            </div>
            <p className="privacy-line">La lista pública agrupa aplicaciones, no ventanas técnicas. HWND, PID y metadata interna del observer no se muestran ni se usan como identidad durable.</p>
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
