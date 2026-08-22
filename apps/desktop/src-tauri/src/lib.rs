mod adapters;
mod classification;
mod model;
mod storage;

use std::sync::{atomic::{AtomicBool, Ordering}, Mutex};
use tauri::State;

use model::DetectedContext;

struct DesktopState {
    contexts: Mutex<Vec<DetectedContext>>,
    paused: AtomicBool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TrackingStatus {
    active: bool,
    observer: &'static str,
}

#[tauri::command]
fn get_detected_contexts(state: State<'_, DesktopState>) -> Vec<DetectedContext> {
    state.contexts.lock().map(|items| items.clone()).unwrap_or_default()
}

#[tauri::command]
fn get_tracking_status(state: State<'_, DesktopState>) -> TrackingStatus {
    TrackingStatus {
        active: !state.paused.load(Ordering::Relaxed),
        observer: if cfg!(windows) { "win32" } else { "unsupported" },
    }
}

#[tauri::command]
fn set_tracking_paused(paused: bool, state: State<'_, DesktopState>) -> TrackingStatus {
    state.paused.store(paused, Ordering::Relaxed);
    get_tracking_status(state)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .manage(DesktopState {
            contexts: Mutex::new(Vec::new()),
            paused: AtomicBool::new(false),
        })
        .invoke_handler(tauri::generate_handler![
            get_detected_contexts,
            get_tracking_status,
            set_tracking_paused
        ])
        .run(tauri::generate_context!())
        .expect("failed to run SelfRelay Desktop");
}
