import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import App from "./App";
import { CaptureRuntimeSurface, RecoveryRuntimeSurface } from "./SurfaceRuntime";
import "./styles.css";

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
  if (label === "recovery") return <RecoveryRuntimeSurface />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ProductionRoot />
  </React.StrictMode>,
);
