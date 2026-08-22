import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import logoUrl from "../../../assets/branding/selfrelay-logo.png";
import { presentDetectedContext } from "./lib/windowPresentation";
import type { DetectedContext, TrackingStatus } from "./types";

export default function App() {
  const [contexts, setContexts] = useState<DetectedContext[]>([]);
  const [status, setStatus] = useState<TrackingStatus>({ active: true, observer: "win32" });
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextContexts, nextStatus] = await Promise.all([
        invoke<DetectedContext[]>("get_detected_contexts"),
        invoke<TrackingStatus>("get_tracking_status"),
      ]);
      setContexts(nextContexts);
      setStatus(nextStatus);
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
    ]);
    return () => {
      void unlisteners.then((items) => items.forEach((unlisten) => unlisten()));
    };
  }, [refresh]);

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <img src={logoUrl} alt="" className="brand-logo" />
          <span>SelfRelay</span>
        </div>
        <div className={`status ${status.active ? "status-active" : "status-paused"}`}>
          <span className="status-dot" />
          {status.active ? "Activo" : "Pausado"}
        </div>
      </header>

      <section className="content">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Seguimiento local</p>
            <h1>Aplicaciones de trabajo detectadas</h1>
          </div>
          <span className="count">{contexts.length}</span>
        </div>

        {error ? (
          <div className="notice notice-error">No se pudo leer el observer: {error}</div>
        ) : contexts.length === 0 ? (
          <div className="empty-state">
            <strong>No hay ventanas de trabajo detectadas.</strong>
            <span>SelfRelay seguirá observando cambios mientras permanezca en el tray.</span>
          </div>
        ) : (
          <div className="window-list">
            {contexts.map((context) => {
              const view = presentDetectedContext(context);
              return (
                <article className="window-row" key={`${context.applicationId}:${context.contextId}`}>
                  <div className="window-icon" aria-hidden="true">{view.primary.slice(0, 1).toUpperCase()}</div>
                  <div className="window-copy">
                    <div className="window-title-line">
                      <strong>{view.primary}</strong>
                      {context.foreground && <span className="foreground-label">En uso</span>}
                    </div>
                    {view.secondary && <span className="window-context">{view.secondary}</span>}
                  </div>
                  <span className={`adapter-badge ${context.stability === "fallback" ? "adapter-fallback" : ""}`}>
                    {view.badge}
                  </span>
                </article>
              );
            })}
          </div>
        )}

        <footer className="privacy-line">
          Sólo metadata mínima de ventanas. Chrome y Edge quedan excluidos del seguimiento Desktop.
        </footer>
      </section>
    </main>
  );
}
