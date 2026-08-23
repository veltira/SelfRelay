import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import App from "./App";
import { CaptureRuntimeSurface, RecoveryRuntimeSurface } from "./SurfaceRuntime";
import type { RecoveryView } from "./types";
import "./styles.css";

const transcriptionInFlight = new Set<number>();

function RecoveryWindowRoot() {
  const [revision, setRevision] = React.useState(0);

  React.useEffect(() => {
    let disposed = false;
    let reconciling = false;
    const windowHandle = getCurrentWebviewWindow();

    const reconcile = async () => {
      if (disposed || reconciling) return;
      reconciling = true;
      try {
        const recovery = await invoke<RecoveryView | null>("get_active_recovery");
        if (disposed) return;
        if (!recovery) {
          await windowHandle.hide();
          return;
        }

        let transcriptChanged = false;
        for (const checkpoint of recovery.checkpoints) {
          if (!checkpoint.audioPath || checkpoint.transcript || transcriptionInFlight.has(checkpoint.id)) continue;
          transcriptionInFlight.add(checkpoint.id);
          try {
            await invoke<string>("transcribe_checkpoint", { id: checkpoint.id });
            transcriptChanged = true;
          } catch {
            // The recovery surface keeps the explicit retry action and error path.
          } finally {
            transcriptionInFlight.delete(checkpoint.id);
          }
        }
        if (!disposed && transcriptChanged) setRevision((value) => value + 1);
      } catch {
        // SurfaceRuntime owns the user-visible retry/error experience.
      } finally {
        reconciling = false;
      }
    };

    void reconcile();
    const unlisten = listen("desktop://state-changed", () => void reconcile());
    return () => {
      disposed = true;
      void unlisten.then((stop) => stop());
    };
  }, []);

  return <RecoveryRuntimeSurface key={revision} />;
}

function ProductionRoot() {
  // Mock visual QA remains URL-driven, but packaged/dev Desktop routing uses the
  // identity Tauri already gives each WebView window.
  if (new URLSearchParams(window.location.search).has("qa")) {
    return <App />;
  }
  let label = "main";
  try {
    label = getCurrentWebviewWindow().label;
  } catch {
    // Vite/browser fallback is the main product; production Tauri always has a label.
  }
  if (label === "capture") return <CaptureRuntimeSurface />;
  if (label === "recovery") return <RecoveryWindowRoot />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ProductionRoot />
  </React.StrictMode>,
);
