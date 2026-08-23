mod adapters;
mod checkpoints;
mod classification;
mod lifecycle;
mod model;
mod observer;
mod storage;

use lifecycle::{ContextSnapshot, LifecycleState};
use model::{DetectedContext, WindowRecord};
use observer::{ObserverHandle, WindowRegistry};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs,
    path::{Path, PathBuf},
    sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use storage::{CheckpointRecord, TrackedApplication};
use tauri::{menu::{Menu, MenuItem, PredefinedMenuItem}, tray::TrayIconBuilder, Emitter, Manager, State, WindowEvent};

struct DesktopState {
    registry: WindowRegistry,
    paused: Arc<AtomicBool>,
    observer: Mutex<Option<ObserverHandle>>,
    exiting: AtomicBool,
    db_path: PathBuf,
    lifecycle: Arc<Mutex<LifecycleState>>,
    recovery_queue: Arc<Mutex<VecDeque<ContextSnapshot>>>,
}

impl DesktopState {
    fn set_paused(&self, paused: bool) {
        self.paused.store(paused, Ordering::Release);
        if let Ok(mut lifecycle) = self.lifecycle.lock() {
            lifecycle.reset();
        }
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

    fn synchronize_selection(&self) -> Result<(), String> {
        let tracked = load_tracked_ids(&self.db_path)?;
        let records = registry_records(&self.registry);
        self.lifecycle
            .lock()
            .map_err(|_| "lifecycle lock poisoned".to_string())?
            .synchronize(&records, &tracked);
        Ok(())
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TrackingStatus {
    active: bool,
    observer: &'static str,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DiscoveredApplication {
    application_id: String,
    application_name: String,
    executable_path: Option<String>,
    running: bool,
    foreground: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryView {
    application_id: String,
    application_name: String,
    context_id: String,
    context_label: String,
    checkpoints: Vec<CheckpointRecord>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn registry_records(registry: &WindowRegistry) -> Vec<WindowRecord> {
    registry
        .lock()
        .map(|items| items.values().cloned().collect())
        .unwrap_or_default()
}

fn load_tracked_ids(path: &Path) -> Result<HashSet<String>, String> {
    let connection = storage::open(path).map_err(|error| error.to_string())?;
    let applications = storage::load_tracked_applications(&connection).map_err(|error| error.to_string())?;
    Ok(applications.into_iter().map(|application| application.application_id).collect())
}

fn process_registry_change(
    app: &tauri::AppHandle,
    registry: &WindowRegistry,
    lifecycle: &Arc<Mutex<LifecycleState>>,
    recovery_queue: &Arc<Mutex<VecDeque<ContextSnapshot>>>,
    db_path: &Path,
) {
    let tracked = match load_tracked_ids(db_path) {
        Ok(value) => value,
        Err(_) => {
            let _ = app.emit("desktop://windows-changed", ());
            return;
        }
    };
    let records = registry_records(registry);
    let delta = match lifecycle.lock() {
        Ok(mut state) => state.transition(&records, &tracked),
        Err(_) => return,
    };

    let mut should_show = !delta.captures.is_empty();
    if !delta.returns.is_empty() {
        if let Ok(connection) = storage::open(db_path) {
            if let Ok(mut queue) = recovery_queue.lock() {
                for returned in delta.returns {
                    let has_pending = storage::unresolved_for_context(&connection, &returned.context_id)
                        .map(|items| !items.is_empty())
                        .unwrap_or(false);
                    if has_pending && !queue.iter().any(|queued| queued.context_id == returned.context_id) {
                        queue.push_back(returned);
                        should_show = true;
                    }
                }
            }
        }
    }

    let _ = app.emit("desktop://windows-changed", ());
    if should_show {
        let _ = app.emit("desktop://checkpoint-changed", ());
        show_main(app);
    }
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
fn get_discovered_applications(state: State<'_, DesktopState>) -> Vec<DiscoveredApplication> {
    let mut applications = HashMap::<String, DiscoveredApplication>::new();
    if let Ok(records) = state.registry.lock() {
        for record in records.values() {
            let entry = applications.entry(record.context.application_id.clone()).or_insert_with(|| DiscoveredApplication {
                application_id: record.context.application_id.clone(),
                application_name: record.context.application_name.clone(),
                executable_path: record.metadata.executable_path.clone(),
                running: true,
                foreground: false,
            });
            entry.foreground |= record.metadata.foreground;
            if entry.executable_path.is_none() {
                entry.executable_path = record.metadata.executable_path.clone();
            }
        }
    }
    let mut applications = applications.into_values().collect::<Vec<_>>();
    applications.sort_by(|a, b| b.foreground.cmp(&a.foreground).then_with(|| a.application_name.cmp(&b.application_name)));
    applications
}

#[tauri::command]
fn get_tracked_applications(state: State<'_, DesktopState>) -> Result<Vec<TrackedApplication>, String> {
    let connection = storage::open(&state.db_path).map_err(|error| error.to_string())?;
    storage::load_tracked_applications(&connection).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_onboarding_completed(state: State<'_, DesktopState>) -> Result<bool, String> {
    let connection = storage::open(&state.db_path).map_err(|error| error.to_string())?;
    storage::onboarding_completed(&connection).map_err(|error| error.to_string())
}

#[tauri::command]
fn complete_onboarding(applications: Vec<TrackedApplication>, state: State<'_, DesktopState>, app: tauri::AppHandle) -> Result<(), String> {
    let mut connection = storage::open(&state.db_path).map_err(|error| error.to_string())?;
    storage::replace_application_tracking(&mut connection, &applications, now_ms()).map_err(|error| error.to_string())?;
    storage::set_onboarding_completed(&connection, true).map_err(|error| error.to_string())?;
    state.synchronize_selection()?;
    let _ = app.emit("desktop://tracking-rules-changed", ());
    Ok(())
}

#[tauri::command]
fn set_application_tracking(application: TrackedApplication, enabled: bool, state: State<'_, DesktopState>, app: tauri::AppHandle) -> Result<(), String> {
    let connection = storage::open(&state.db_path).map_err(|error| error.to_string())?;
    storage::set_application_tracking(&connection, &application, enabled, now_ms()).map_err(|error| error.to_string())?;
    state.synchronize_selection()?;
    let _ = app.emit("desktop://tracking-rules-changed", ());
    Ok(())
}

#[cfg(windows)]
#[tauri::command]
fn pick_application_executable() -> Result<Option<TrackedApplication>, String> {
    use ::windows::{
        core::{PCWSTR, PWSTR},
        Win32::UI::Controls::Dialogs::{GetOpenFileNameW, OPENFILENAMEW, OFN_EXPLORER, OFN_FILEMUSTEXIST, OFN_PATHMUSTEXIST},
    };

    let mut buffer = vec![0u16; 32768];
    let filter = "Aplicaciones (*.exe)\0*.exe\0Todos los archivos\0*.*\0\0".encode_utf16().collect::<Vec<_>>();
    let mut dialog = OPENFILENAMEW::default();
    dialog.lStructSize = std::mem::size_of::<OPENFILENAMEW>() as u32;
    dialog.lpstrFile = PWSTR(buffer.as_mut_ptr());
    dialog.nMaxFile = buffer.len() as u32;
    dialog.lpstrFilter = PCWSTR(filter.as_ptr());
    dialog.Flags = OFN_EXPLORER | OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST;

    if !unsafe { GetOpenFileNameW(&mut dialog) }.as_bool() {
        return Ok(None);
    }
    let length = buffer.iter().position(|value| *value == 0).unwrap_or(0);
    let path = String::from_utf16_lossy(&buffer[..length]);
    let executable_name = Path::new(&path)
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "No se pudo leer el ejecutable seleccionado".to_string())?
        .to_string();
    let application_id = format!("app:{}", executable_name.to_lowercase());
    Ok(Some(TrackedApplication {
        application_id,
        application_name: friendly_application_name(&executable_name),
        executable_path: Some(path),
    }))
}

#[cfg(not(windows))]
#[tauri::command]
fn pick_application_executable() -> Result<Option<TrackedApplication>, String> {
    Ok(None)
}

fn friendly_application_name(executable_name: &str) -> String {
    match executable_name.to_lowercase().as_str() {
        "notepad.exe" => "Notepad".into(),
        "winword.exe" => "Microsoft Word".into(),
        "excel.exe" => "Microsoft Excel".into(),
        "code.exe" => "Visual Studio Code".into(),
        _ => executable_name.trim_end_matches(".exe").to_string(),
    }
}

#[tauri::command]
fn get_pending_capture(state: State<'_, DesktopState>) -> Option<ContextSnapshot> {
    state.lifecycle.lock().ok().and_then(|lifecycle| lifecycle.pending_capture())
}

#[tauri::command]
fn dismiss_capture(state: State<'_, DesktopState>, app: tauri::AppHandle) -> Result<(), String> {
    state.lifecycle.lock().map_err(|_| "lifecycle lock poisoned".to_string())?.consume_capture();
    let _ = app.emit("desktop://checkpoint-changed", ());
    Ok(())
}

#[tauri::command]
fn save_checkpoint(text: String, state: State<'_, DesktopState>, app: tauri::AppHandle) -> Result<CheckpointRecord, String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("Escribí una nota antes de guardar.".into());
    }
    let capture = state.lifecycle
        .lock()
        .map_err(|_| "lifecycle lock poisoned".to_string())?
        .pending_capture()
        .ok_or_else(|| "No hay un contexto pendiente de checkpoint.".to_string())?;
    let connection = storage::open(&state.db_path).map_err(|error| error.to_string())?;
    let checkpoint = storage::insert_checkpoint(
        &connection,
        &capture.application_id,
        &capture.application_name,
        &capture.context_id,
        &capture.context_label,
        &text,
        now_ms(),
    ).map_err(|error| error.to_string())?;
    state.lifecycle.lock().map_err(|_| "lifecycle lock poisoned".to_string())?.consume_capture();
    let _ = app.emit("desktop://checkpoint-changed", ());
    Ok(checkpoint)
}

#[tauri::command]
fn get_active_recovery(state: State<'_, DesktopState>) -> Result<Option<RecoveryView>, String> {
    let connection = storage::open(&state.db_path).map_err(|error| error.to_string())?;
    let mut queue = state.recovery_queue.lock().map_err(|_| "recovery lock poisoned".to_string())?;
    loop {
        let Some(context) = queue.front().cloned() else { return Ok(None); };
        let checkpoints = storage::unresolved_for_context(&connection, &context.context_id).map_err(|error| error.to_string())?;
        if checkpoints.is_empty() {
            queue.pop_front();
            continue;
        }
        return Ok(Some(RecoveryView {
            application_id: context.application_id,
            application_name: context.application_name,
            context_id: context.context_id,
            context_label: context.context_label,
            checkpoints,
        }));
    }
}

#[tauri::command]
fn defer_recovery(state: State<'_, DesktopState>, app: tauri::AppHandle) -> Result<(), String> {
    state.recovery_queue.lock().map_err(|_| "recovery lock poisoned".to_string())?.pop_front();
    let _ = app.emit("desktop://checkpoint-changed", ());
    Ok(())
}

#[tauri::command]
fn resolve_checkpoint(id: i64, state: State<'_, DesktopState>, app: tauri::AppHandle) -> Result<(), String> {
    let connection = storage::open(&state.db_path).map_err(|error| error.to_string())?;
    storage::resolve_checkpoint(&connection, id, now_ms()).map_err(|error| error.to_string())?;
    if let Ok(mut queue) = state.recovery_queue.lock() {
        if let Some(context) = queue.front() {
            let remaining = storage::unresolved_for_context(&connection, &context.context_id)
                .map(|items| !items.is_empty())
                .unwrap_or(true);
            if !remaining {
                queue.pop_front();
            }
        }
    }
    let _ = app.emit("desktop://checkpoint-changed", ());
    Ok(())
}

#[tauri::command]
fn get_checkpoint_history(state: State<'_, DesktopState>) -> Result<Vec<CheckpointRecord>, String> {
    let connection = storage::open(&state.db_path).map_err(|error| error.to_string())?;
    storage::checkpoint_history(&connection).map_err(|error| error.to_string())
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
    let pause = MenuItem::with_id(app, "pause", "Pausar seguimiento", true, None::<&str>)?;
    let resume = MenuItem::with_id(app, "resume", "Reanudar seguimiento", false, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
    let separator_a = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &separator_a, &pause, &resume, &quit])?;

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
            let db_path = data_dir.join("selfrelay.db");
            storage::initialize(&db_path)?;

            let registry: WindowRegistry = Arc::new(Mutex::new(HashMap::new()));
            let paused = Arc::new(AtomicBool::new(false));
            let lifecycle = Arc::new(Mutex::new(LifecycleState::default()));
            let recovery_queue = Arc::new(Mutex::new(VecDeque::new()));

            let app_handle = app.handle().clone();
            let notify_registry = Arc::clone(&registry);
            let notify_lifecycle = Arc::clone(&lifecycle);
            let notify_recovery = Arc::clone(&recovery_queue);
            let notify_db_path = db_path.clone();
            let notify = Arc::new(move || {
                process_registry_change(
                    &app_handle,
                    &notify_registry,
                    &notify_lifecycle,
                    &notify_recovery,
                    &notify_db_path,
                );
            });
            let observer = observer::start(Arc::clone(&registry), Arc::clone(&paused), notify);

            app.manage(DesktopState {
                registry,
                paused,
                observer: Mutex::new(Some(observer)),
                exiting: AtomicBool::new(false),
                db_path,
                lifecycle,
                recovery_queue,
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
            get_discovered_applications,
            get_tracked_applications,
            get_onboarding_completed,
            complete_onboarding,
            set_application_tracking,
            pick_application_executable,
            get_pending_capture,
            dismiss_capture,
            save_checkpoint,
            get_active_recovery,
            defer_recovery,
            resolve_checkpoint,
            get_checkpoint_history,
            get_tracking_status,
            set_tracking_paused
        ])
        .run(tauri::generate_context!())
        .expect("failed to run SelfRelay Desktop");
}
