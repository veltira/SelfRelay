mod adapters;
mod classification;
mod model;
mod observer;
mod storage;

use model::DetectedContext;
use observer::{ObserverHandle, WindowRegistry};
use std::{collections::HashMap, fs, sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex}};
use tauri::{menu::{Menu, MenuItem, PredefinedMenuItem}, tray::TrayIconBuilder, Emitter, Manager, State, WindowEvent};

struct DesktopState {
    registry: WindowRegistry,
    paused: Arc<AtomicBool>,
    observer: Mutex<Option<ObserverHandle>>,
    exiting: AtomicBool,
}

impl DesktopState {
    fn set_paused(&self, paused: bool) {
        self.paused.store(paused, Ordering::Release);
        if !paused {
            if let Ok(observer) = self.observer.lock() {
                if let Some(observer) = observer.as_ref() {
                    observer.request_reconcile();
                }
            }
        }
    }

    fn shutdown(&self) {
        self.exiting.store(true, Ordering::Release);
        if let Ok(observer) = self.observer.lock() {
            if let Some(observer) = observer.as_ref() {
                observer.shutdown();
            }
        }
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TrackingStatus {
    active: bool,
    observer: &'static str,
}

#[tauri::command]
fn get_detected_contexts(state: State<'_, DesktopState>) -> Vec<DetectedContext> {
    let mut contexts = state.registry.lock()
        .map(|items| items.values().map(DetectedContext::from).collect::<Vec<_>>())
        .unwrap_or_default();
    contexts.sort_by(|a, b| {
        b.foreground.cmp(&a.foreground)
            .then_with(|| a.application_name.cmp(&b.application_name))
            .then_with(|| a.context_label.cmp(&b.context_label))
    });
    contexts
}

#[tauri::command]
fn get_tracking_status(state: State<'_, DesktopState>) -> TrackingStatus {
    TrackingStatus {
        active: !state.paused.load(Ordering::Acquire),
        observer: if cfg!(windows) { "win32" } else { "unsupported" },
    }
}

#[tauri::command]
fn set_tracking_paused(paused: bool, state: State<'_, DesktopState>) -> TrackingStatus {
    state.set_paused(paused);
    get_tracking_status(state)
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Abrir SelfRelay", true, None::<&str>)?;
    let checkpoint = MenuItem::with_id(app, "checkpoint", "Guardar checkpoint ahora — disponible en D1", false, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "Pausar seguimiento", true, None::<&str>)?;
    let resume = MenuItem::with_id(app, "resume", "Reanudar seguimiento", false, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
    let separator_a = PredefinedMenuItem::separator(app)?;
    let separator_b = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &checkpoint, &separator_a, &pause, &resume, &separator_b, &quit])?;

    let pause_item = pause.clone();
    let resume_item = resume.clone();
    let mut tray = TrayIconBuilder::with_id("selfrelay-tray")
        .menu(&menu)
        .tooltip("SelfRelay — Activo")
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "open" => show_main(app),
            "pause" => {
                let state = app.state::<DesktopState>();
                state.set_paused(true);
                let _ = pause_item.set_enabled(false);
                let _ = resume_item.set_enabled(true);
                let _ = app.emit("desktop://tracking-changed", ());
            }
            "resume" => {
                let state = app.state::<DesktopState>();
                state.set_paused(false);
                let _ = pause_item.set_enabled(true);
                let _ = resume_item.set_enabled(false);
                let _ = app.emit("desktop://tracking-changed", ());
            }
            "quit" => {
                app.state::<DesktopState>().shutdown();
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app);
        }))
        .setup(|app| {
            let data_dir = app.path().app_local_data_dir()?;
            fs::create_dir_all(&data_dir)?;
            storage::initialize(&data_dir.join("selfrelay.db"))?;

            let registry: WindowRegistry = Arc::new(Mutex::new(HashMap::new()));
            let paused = Arc::new(AtomicBool::new(false));
            let app_handle = app.handle().clone();
            let notify = Arc::new(move || {
                let _ = app_handle.emit("desktop://windows-changed", ());
            });
            let observer = observer::start(Arc::clone(&registry), Arc::clone(&paused), notify);

            app.manage(DesktopState {
                registry,
                paused,
                observer: Mutex::new(Some(observer)),
                exiting: AtomicBool::new(false),
            });
            setup_tray(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<DesktopState>();
                if !state.exiting.load(Ordering::Acquire) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_detected_contexts,
            get_tracking_status,
            set_tracking_paused
        ])
        .run(tauri::generate_context!())
        .expect("failed to run SelfRelay Desktop");
}
