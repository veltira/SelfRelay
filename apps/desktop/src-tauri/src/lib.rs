mod adapters;
mod autostart;
mod capture_runtime;
mod capture_store;
mod checkpoints;
mod classification;
mod discovery;
mod discovery_quality;
mod icons;
mod identity;
mod lifecycle;
mod model;
mod observer;
mod runtime_smoke;
mod storage;
mod transcription;

#[cfg(test)]
mod runtime_state_tests;

use capture_runtime::CaptureCoordinator;
use capture_store::PendingCapture;
use discovery::DiscoveredApplication;
use lifecycle::{ContextSnapshot, LifecycleState};
use observer::{ObserverHandle, WindowRegistry};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use storage::{CheckpointRecord, TrackedApplication, WorksetRecord};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, State, WindowEvent,
};

const PRODUCT_VERSION: &str = "0.2.2";
static AUDIO_SEQUENCE: AtomicU64 = AtomicU64::new(1);
static WORKSET_SEQUENCE: AtomicU64 = AtomicU64::new(1);
static SURFACE_WATCHDOGS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

struct DesktopState {
    registry: WindowRegistry,
    paused: Arc<AtomicBool>,
    observer: Mutex<Option<ObserverHandle>>,
    exiting: AtomicBool,
    db_path: PathBuf,
    data_dir: PathBuf,
    resource_dir: PathBuf,
    lifecycle: Arc<Mutex<LifecycleState>>,
    capture: Arc<CaptureCoordinator>,
    recovery_queue: Arc<Mutex<VecDeque<RecoveryTarget>>>,
    active_worksets: Arc<Mutex<HashSet<String>>>,
    surface_ready: Mutex<HashMap<String, String>>,
}

impl DesktopState {
    fn set_paused(&self, paused: bool) -> Result<(), String> {
        self.paused.store(paused, Ordering::Release);
        let connection = storage::open(&self.db_path).map_err(|error| error.to_string())?;
        storage::set_bool_setting(&connection, "tracking_paused", paused)
            .map_err(|error| error.to_string())?;
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
        Ok(())
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
        synchronize_active_worksets(&self.db_path, &records, &self.active_worksets)?;
        Ok(())
    }
}

#[derive(Debug, Clone)]
enum RecoveryTargetKind {
    Context(ContextSnapshot),
    Workset { id: String, name: String, source: ContextSnapshot },
}

#[derive(Debug, Clone)]
struct RecoveryTarget {
    key: String,
    kind: RecoveryTargetKind,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorksetOption {
    id: String,
    name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptureView {
    id: String,
    application_id: String,
    application_name: String,
    context_id: String,
    context_label: String,
    created_at_ms: u64,
    worksets: Vec<WorksetOption>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryView {
    target_kind: &'static str,
    target_name: String,
    application_id: String,
    application_name: String,
    context_id: String,
    context_label: String,
    workset_id: Option<String>,
    ready_token: String,
    checkpoints: Vec<CheckpointRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorksetView {
    id: String,
    name: String,
    application_ids: Vec<String>,
    active: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrackingStatus {
    active: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SettingsView {
    launch_at_startup: bool,
    tracking_active: bool,
    version: &'static str,
    data_directory: String,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn registry_records(registry: &WindowRegistry) -> Vec<model::WindowRecord> {
    registry
        .lock()
        .map(|items| items.values().cloned().collect())
        .unwrap_or_default()
}

fn load_tracked_ids(path: &Path) -> Result<HashSet<String>, String> {
    let connection = storage::open(path).map_err(|error| error.to_string())?;
    Ok(storage::load_tracked_applications(&connection)
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|application| application.application_id)
        .collect())
}

fn active_application_ids(records: &[model::WindowRecord]) -> HashSet<String> {
    records.iter().map(|record| record.context.application_id.clone()).collect()
}

fn active_workset_ids(
    connection: &rusqlite::Connection,
    records: &[model::WindowRecord],
) -> Result<HashSet<String>, String> {
    let active_apps = active_application_ids(records);
    Ok(storage::load_worksets(connection)
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter(|workset| workset.application_ids.iter().any(|id| active_apps.contains(id)))
        .map(|workset| workset.id)
        .collect())
}

fn synchronize_active_worksets(
    db_path: &Path,
    records: &[model::WindowRecord],
    active_worksets: &Arc<Mutex<HashSet<String>>>,
) -> Result<(), String> {
    let connection = storage::open(db_path).map_err(|error| error.to_string())?;
    let current = active_workset_ids(&connection, records)?;
    *active_worksets.lock().map_err(|_| "workset state lock poisoned".to_string())? = current;
    Ok(())
}

fn hide_surface(app: &tauri::AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.hide();
    }
}

fn force_show_surface(app: &tauri::AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn expected_surface_token(state: &DesktopState, label: &str) -> Option<String> {
    match label {
        "capture" => state.capture.current().ok().flatten().map(|capture| capture.id),
        "recovery" => state
            .recovery_queue
            .lock()
            .ok()
            .and_then(|queue| queue.front().map(|target| target.key.clone())),
        _ => None,
    }
}

fn surface_token_ready(state: &DesktopState, label: &str, expected: &str) -> bool {
    state
        .surface_ready
        .lock()
        .ok()
        .and_then(|ready| ready.get(label).cloned())
        .as_deref()
        == Some(expected)
}

fn schedule_surface_watchdog(app: &tauri::AppHandle, label: &str, expected: &str) {
    let key = format!("{label}:{expected}");
    let watchdogs = SURFACE_WATCHDOGS.get_or_init(|| Mutex::new(HashSet::new()));
    if !watchdogs.lock().map(|mut current| current.insert(key.clone())).unwrap_or(false) {
        return;
    }
    let app = app.clone();
    let label = label.to_string();
    let expected = expected.to_string();
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(4));
        let still_waiting = {
            let state = app.state::<DesktopState>();
            expected_surface_token(&state, &label).as_deref() == Some(expected.as_str())
                && !surface_token_ready(&state, &label, &expected)
        };
        if still_waiting {
            let state = app.state::<DesktopState>();
            state.capture.diagnostic(
                "surface_ready_timeout_reload",
                &format!("surface={label} expected={expected}"),
                now_ms(),
            );
            hide_surface(&app, &label);
            if let Some(window) = app.get_webview_window(&label) {
                let _ = window.eval("window.location.reload()");
            }
            let _ = app.emit("desktop://state-changed", ());
            thread::sleep(Duration::from_secs(4));
            let state = app.state::<DesktopState>();
            if expected_surface_token(&state, &label).as_deref() == Some(expected.as_str())
                && !surface_token_ready(&state, &label, &expected)
            {
                state.capture.diagnostic(
                    "surface_ready_timeout_after_reload",
                    &format!("surface={label} expected={expected}"),
                    now_ms(),
                );
                hide_surface(&app, &label);
            }
        }
        if let Some(watchdogs) = SURFACE_WATCHDOGS.get() {
            if let Ok(mut current) = watchdogs.lock() {
                current.remove(&key);
            }
        }
    });
}

fn show_surface(app: &tauri::AppHandle, label: &str) {
    if !matches!(label, "capture" | "recovery") {
        force_show_surface(app, label);
        return;
    }
    let state = app.state::<DesktopState>();
    let Some(expected) = expected_surface_token(&state, label) else {
        hide_surface(app, label);
        return;
    };
    if surface_token_ready(&state, label, &expected) {
        force_show_surface(app, label);
    } else {
        // A native HWND/WebView existing is not enough. It stays hidden until the
        // real React surface has fetched and rendered the exact durable target.
        hide_surface(app, label);
        schedule_surface_watchdog(app, label, &expected);
    }
}

fn enqueue_capture_and_show(
    app: &tauri::AppHandle,
    coordinator: &CaptureCoordinator,
    snapshot: &ContextSnapshot,
) -> Result<(), String> {
    let inserted = coordinator.enqueue(snapshot, now_ms())?;
    let current = coordinator.current()?;
    if current.is_none() {
        coordinator.diagnostic(
            "capture_enqueue_without_visible_row",
            &format!("inserted={}", inserted.id),
            now_ms(),
        );
        hide_surface(app, "capture");
        return Err("SelfRelay no pudo preparar la captura antes de abrirla.".into());
    }
    show_surface(app, "capture");
    let _ = app.emit("desktop://state-changed", ());
    Ok(())
}

fn process_registry_change(
    app: &tauri::AppHandle,
    registry: &WindowRegistry,
    lifecycle: &Arc<Mutex<LifecycleState>>,
    capture: &Arc<CaptureCoordinator>,
    recovery_queue: &Arc<Mutex<VecDeque<RecoveryTarget>>>,
    active_worksets: &Arc<Mutex<HashSet<String>>>,
    db_path: &Path,
) {
    let tracked = match load_tracked_ids(db_path) {
        Ok(value) => value,
        Err(error) => {
            capture.diagnostic("tracking_load_failed", &error, now_ms());
            return;
        }
    };
    let records = registry_records(registry);
    let delta = match lifecycle.lock() {
        Ok(mut state) => state.transition_at(&records, &tracked, now_ms()),
        Err(_) => return,
    };

    let connection = match storage::open(db_path) {
        Ok(value) => value,
        Err(error) => {
            capture.diagnostic("storage_open_failed", &error.to_string(), now_ms());
            return;
        }
    };

    let current_worksets = active_workset_ids(&connection, &records).unwrap_or_default();
    let previous_worksets = active_worksets
        .lock()
        .map(|mut previous| {
            let snapshot = previous.clone();
            *previous = current_worksets.clone();
            snapshot
        })
        .unwrap_or_default();
    let newly_active_worksets = current_worksets
        .difference(&previous_worksets)
        .cloned()
        .collect::<HashSet<_>>();

    let mut should_show_recovery = false;
    if let Ok(mut queue) = recovery_queue.lock() {
        for returned in &delta.returns {
            let pending = storage::unresolved_for_context(&connection, &returned.context_id)
                .map(|items| !items.is_empty())
                .unwrap_or(false);
            let key = format!("context:{}", returned.context_id);
            if pending && !queue.iter().any(|item| item.key == key) {
                queue.push_back(RecoveryTarget {
                    key,
                    kind: RecoveryTargetKind::Context(returned.clone()),
                });
                should_show_recovery = true;
            }
        }

        if !newly_active_worksets.is_empty() {
            for workset in storage::load_worksets(&connection).unwrap_or_default() {
                if !newly_active_worksets.contains(&workset.id) {
                    continue;
                }
                let pending = storage::unresolved_for_workset(&connection, &workset.id)
                    .map(|items| !items.is_empty())
                    .unwrap_or(false);
                let key = format!("workset:{}", workset.id);
                if !pending || queue.iter().any(|item| item.key == key) {
                    continue;
                }
                let source = delta
                    .returns
                    .iter()
                    .find(|returned| workset.application_ids.contains(&returned.application_id))
                    .cloned()
                    .or_else(|| {
                        records
                            .iter()
                            .find(|record| workset.application_ids.contains(&record.context.application_id))
                            .map(ContextSnapshot::from)
                    });
                if let Some(source) = source {
                    queue.push_back(RecoveryTarget {
                        key,
                        kind: RecoveryTargetKind::Workset {
                            id: workset.id,
                            name: workset.name,
                            source,
                        },
                    });
                    should_show_recovery = true;
                }
            }
        }
    }

    for snapshot in &delta.captures {
        if let Err(error) = capture.enqueue(snapshot, now_ms()) {
            capture.diagnostic(
                "capture_persist_failed",
                &format!("{}: {error}", snapshot.context_id),
                now_ms(),
            );
        }
    }

    let _ = app.emit("desktop://state-changed", ());
    if !delta.captures.is_empty() {
        match capture.current() {
            Ok(Some(_)) => show_surface(app, "capture"),
            Ok(None) => {
                capture.diagnostic("capture_surface_suppressed", "lifecycle emitted capture but durable queue was empty", now_ms());
                hide_surface(app, "capture");
            }
            Err(error) => {
                capture.diagnostic("capture_surface_suppressed", &error, now_ms());
                hide_surface(app, "capture");
            }
        }
    }
    if should_show_recovery {
        show_surface(app, "recovery");
    }
}

#[tauri::command]
fn get_discovered_applications(state: State<'_, DesktopState>) -> Vec<DiscoveredApplication> {
    discovery_quality::filter(discovery::discover(&registry_records(&state.registry)))
}

#[tauri::command]
fn get_tracked_applications(state: State<'_, DesktopState>) -> Result<Vec<TrackedApplication>, String> {
    let connection = storage::open(&state.db_path).map_err(|error| error.to_string())?;
    storage::load_tracked_applications(&connection).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_application_icon(executable_path: Option<String>, state: State<'_, DesktopState>) -> icons::ApplicationIcon {
    icons::load(executable_path.as_deref(), &state.data_dir.join("icon-cache"))
}

#[tauri::command]
fn get_onboarding_completed(state: State<'_, DesktopState>) -> Result<bool, String> {
    let connection = storage::open(&state.db_path).map_err(|error| error.to_string())?;
    storage::onboarding_completed(&connection).map_err(|error| error.to_string())
}

#[tauri::command]
fn complete_onboarding(
    applications: Vec<TrackedApplication>,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let records = registry_records(&state.registry);
    for application in &applications {
        discovery::validate_trackable(application, &records)?;
    }
    let mut connection = storage::open(&state.db_path).map_err(|error| error.to_string())?;
    storage::replace_application_tracking(&mut connection, &applications, now_ms())
        .map_err(|error| error.to_string())?;
    storage::set_onboarding_completed(&connection, true).map_err(|error| error.to_string())?;
    state.synchronize_selection()?;
    let _ = app.emit("desktop://state-changed", ());
    Ok(())
}

#[tauri::command]
fn set_application_tracking(
    application: TrackedApplication,
    enabled: bool,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    if enabled {
        discovery::validate_trackable(&application, &registry_records(&state.registry))?;
    }
    let connection = storage::open(&state.db_path).map_err(|error| error.to_string())?;
    storage::set_application_tracking(&connection, &application, enabled, now_ms())
        .map_err(|error| error.to_string())?;
    state.synchronize_selection()?;
    let _ = app.emit("desktop://state-changed", ());
    Ok(())
}

#[cfg(windows)]
#[tauri::command]
fn pick_application_executable() -> Result<Option<TrackedApplication>, String> {
    use ::windows::{
        core::{PCWSTR, PWSTR},
        Win32::UI::Controls::Dialogs::{
            GetOpenFileNameW, OPENFILENAMEW, OFN_EXPLORER, OFN_FILEMUSTEXIST, OFN_PATHMUSTEXIST,
        },
    };
    let mut buffer = vec![0u16; 32768];
    let filter = "Aplicaciones (*.exe;*.lnk)\0*.exe;*.lnk\0Ejecutables (*.exe)\0*.exe\0Accesos directos (*.lnk)\0*.lnk\0\0"
        .encode_utf16()
        .collect::<Vec<_>>();
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
    discovery::tracked_from_selection(&path).map(Some)
}

#[cfg(not(windows))]
#[tauri::command]
fn pick_application_executable() -> Result<Option<TrackedApplication>, String> {
    Ok(None)
}

fn inactive_worksets_for_snapshot(
    state: &DesktopState,
    capture: &ContextSnapshot,
) -> Result<Vec<WorksetOption>, String> {
    let connection = storage::open(&state.db_path).map_err(|error| error.to_string())?;
    let active = active_application_ids(&registry_records(&state.registry));
    let mut options = storage::worksets_for_application(&connection, &capture.application_id)
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter(|workset| !workset.application_ids.iter().any(|id| active.contains(id)))
        .map(|workset| WorksetOption { id: workset.id, name: workset.name })
        .collect::<Vec<_>>();
    options.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(options)
}

fn capture_to_view(state: &DesktopState, capture: PendingCapture) -> Result<CaptureView, String> {
    let worksets = inactive_worksets_for_snapshot(state, &capture.snapshot())?;
    Ok(CaptureView {
        id: capture.id,
        application_id: capture.application_id,
        application_name: capture.application_name,
        context_id: capture.context_id,
        context_label: capture.context_label,
        created_at_ms: capture.created_at_ms,
        worksets,
    })
}

#[tauri::command]
fn get_pending_capture(
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<Option<CaptureView>, String> {
    match state.capture.current()? {
        Some(capture) => capture_to_view(&state, capture).map(Some),
        None => {
            state.capture.diagnostic("empty_capture_surface", "capture frontend requested state with no durable pending row", now_ms());
            hide_surface(&app, "capture");
            Ok(None)
        }
    }
}

fn maybe_exit_runtime_smoke(app: &tauri::AppHandle, finished: bool) {
    if !finished {
        return;
    }
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(150));
        app.exit(0);
    });
}

#[tauri::command]
fn capture_surface_ready(
    capture_id: String,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let current = state
        .capture
        .current()?
        .ok_or_else(|| "La superficie de captura reportó ready sin una captura pendiente.".to_string())?;
    if current.id != capture_id {
        state.capture.diagnostic(
            "capture_ready_id_mismatch",
            &format!("current={} reported={capture_id}", current.id),
            now_ms(),
        );
        hide_surface(&app, "capture");
        return Err("La captura renderizada ya no coincide con el checkpoint pendiente.".into());
    }
    state
        .surface_ready
        .lock()
        .map_err(|_| "surface readiness lock poisoned".to_string())?
        .insert("capture".into(), capture_id.clone());
    let finished = runtime_smoke::mark_capture_ready(&capture_id)?;
    show_surface(&app, "capture");
    maybe_exit_runtime_smoke(&app, finished);
    Ok(())
}

#[tauri::command]
fn report_surface_error(
    surface: String,
    detail: String,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    if !matches!(surface.as_str(), "capture" | "recovery") {
        return Err("Unknown SelfRelay surface.".into());
    }
    state.capture.diagnostic(
        "surface_frontend_error",
        &format!("surface={surface} detail={detail}"),
        now_ms(),
    );
    hide_surface(&app, &surface);
    Ok(())
}

fn advance_capture_surface(app: &tauri::AppHandle, next: Option<PendingCapture>) {
    if next.is_some() {
        show_surface(app, "capture");
    } else {
        hide_surface(app, "capture");
    }
    let _ = app.emit("desktop://state-changed", ());
}

#[tauri::command]
fn dismiss_capture(
    capture_id: String,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let next = state.capture.discard_exact(&capture_id)?;
    advance_capture_surface(&app, next);
    Ok(())
}

fn validate_audio(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("La nota de voz no terminó de guardarse correctamente.".into());
    }
    if bytes.len() > 32 * 1024 * 1024 {
        return Err("La nota de voz es demasiado grande para un checkpoint.".into());
    }
    Ok(())
}

fn persist_audio(state: &DesktopState, bytes: &[u8]) -> Result<String, String> {
    validate_audio(bytes)?;
    let audio_dir = state.data_dir.join("audio");
    fs::create_dir_all(&audio_dir).map_err(|error| error.to_string())?;
    let sequence = AUDIO_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let path = audio_dir.join(format!("checkpoint-{}-{sequence}.wav", now_ms()));
    fs::write(&path, bytes).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn save_checkpoint(
    capture_id: String,
    text: String,
    workset_id: Option<String>,
    audio_bytes: Option<Vec<u8>>,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<CheckpointRecord, String> {
    let text = text.trim().to_string();
    let audio_path = match audio_bytes.as_deref() {
        Some(bytes) if !bytes.is_empty() => Some(persist_audio(&state, bytes)?),
        _ => None,
    };
    if text.is_empty() && audio_path.is_none() {
        return Err("Escribí una nota o grabá audio antes de guardar.".into());
    }

    let capture = state.capture.current()?
        .filter(|capture| capture.id == capture_id)
        .ok_or_else(|| "Ese checkpoint ya no es la captura que está mostrando SelfRelay.".to_string())?;
    if let Some(ref requested_workset) = workset_id {
        let valid = inactive_worksets_for_snapshot(&state, &capture.snapshot())?
            .iter()
            .any(|workset| &workset.id == requested_workset);
        if !valid {
            return Err("Ese entorno ya no corresponde a esta salida.".into());
        }
    }

    match state.capture.save_exact(
        &capture_id,
        workset_id.as_deref(),
        &text,
        audio_path.as_deref(),
        now_ms(),
    ) {
        Ok((checkpoint, next)) => {
            advance_capture_surface(&app, next);
            Ok(checkpoint)
        }
        Err(error) => {
            if let Some(path) = audio_path {
                let _ = fs::remove_file(path);
            }
            Err(error)
        }
    }
}

#[tauri::command]
fn save_checkpoint_now(state: State<'_, DesktopState>, app: tauri::AppHandle) -> Result<(), String> {
    let tracked = load_tracked_ids(&state.db_path)?;
    let records = registry_records(&state.registry);
    let snapshot = records
        .iter()
        .filter(|record| tracked.contains(&record.context.application_id))
        .max_by_key(|record| record.metadata.foreground)
        .map(ContextSnapshot::from)
        .ok_or_else(|| "Abrí una aplicación en seguimiento para guardar un checkpoint.".to_string())?;
    enqueue_capture_and_show(&app, &state.capture, &snapshot)
}

fn checkpoints_for_target(
    connection: &rusqlite::Connection,
    target: &RecoveryTarget,
) -> Result<Vec<CheckpointRecord>, String> {
    match &target.kind {
        RecoveryTargetKind::Context(context) => storage::unresolved_for_context(connection, &context.context_id),
        RecoveryTargetKind::Workset { id, .. } => storage::unresolved_for_workset(connection, id),
    }
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_active_recovery(state: State<'_, DesktopState>) -> Result<Option<RecoveryView>, String> {
    let connection = storage::open(&state.db_path).map_err(|error| error.to_string())?;
    let mut queue = state.recovery_queue.lock().map_err(|_| "recovery lock poisoned".to_string())?;
    loop {
        let Some(target) = queue.front().cloned() else { return Ok(None); };
        let checkpoints = checkpoints_for_target(&connection, &target)?;
        if checkpoints.is_empty() {
            queue.pop_front();
            continue;
        }
        let ready_token = target.key.clone();
        return Ok(Some(match target.kind {
            RecoveryTargetKind::Context(context) => RecoveryView {
                target_kind: "context",
                target_name: context.application_name.clone(),
                application_id: context.application_id,
                application_name: context.application_name,
                context_id: context.context_id,
                context_label: context.context_label,
                workset_id: None,
                ready_token,
                checkpoints,
            },
            RecoveryTargetKind::Workset { id, name, source } => RecoveryView {
                target_kind: "workset",
                target_name: name,
                application_id: source.application_id,
                application_name: source.application_name,
                context_id: source.context_id,
                context_label: source.context_label,
                workset_id: Some(id),
                ready_token,
                checkpoints,
            },
        }));
    }
}

#[tauri::command]
fn recovery_surface_ready(
    ready_token: String,
    checkpoint_ids: Vec<i64>,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let target = state
        .recovery_queue
        .lock()
        .map_err(|_| "recovery lock poisoned".to_string())?
        .front()
        .cloned()
        .ok_or_else(|| "La superficie de recuperación reportó ready sin una recuperación pendiente.".to_string())?;
    if target.key != ready_token {
        state.capture.diagnostic(
            "recovery_ready_token_mismatch",
            &format!("current={} reported={ready_token}", target.key),
            now_ms(),
        );
        hide_surface(&app, "recovery");
        return Err("La recuperación renderizada ya no coincide con el contexto activo.".into());
    }
    let connection = storage::open(&state.db_path).map_err(|error| error.to_string())?;
    let current_ids = checkpoints_for_target(&connection, &target)?
        .into_iter()
        .map(|checkpoint| checkpoint.id)
        .collect::<Vec<_>>();
    if current_ids != checkpoint_ids {
        state.capture.diagnostic(
            "recovery_ready_checkpoint_mismatch",
            &format!("current={current_ids:?} reported={checkpoint_ids:?}"),
            now_ms(),
        );
        hide_surface(&app, "recovery");
        return Err("Los checkpoints renderizados ya no coinciden con la recuperación actual.".into());
    }
    state
        .surface_ready
        .lock()
        .map_err(|_| "surface readiness lock poisoned".to_string())?
        .insert("recovery".into(), ready_token.clone());
    let finished = runtime_smoke::mark_recovery_ready(&ready_token, &checkpoint_ids)?;
    show_surface(&app, "recovery");
    maybe_exit_runtime_smoke(&app, finished);
    Ok(())
}

#[tauri::command]
fn defer_recovery(state: State<'_, DesktopState>, app: tauri::AppHandle) -> Result<(), String> {
    let mut queue = state.recovery_queue.lock().map_err(|_| "recovery lock poisoned".to_string())?;
    queue.pop_front();
    let has_more = !queue.is_empty();
    drop(queue);
    if has_more { show_surface(&app, "recovery"); } else { hide_surface(&app, "recovery"); }
    let _ = app.emit("desktop://state-changed", ());
    Ok(())
}

#[tauri::command]
fn resolve_checkpoint(id: i64, state: State<'_, DesktopState>, app: tauri::AppHandle) -> Result<(), String> {
    let connection = storage::open(&state.db_path).map_err(|error| error.to_string())?;
    storage::resolve_checkpoint(&connection, id, now_ms()).map_err(|error| error.to_string())?;
    let mut queue = state.recovery_queue.lock().map_err(|_| "recovery lock poisoned".to_string())?;
    if let Some(target) = queue.front() {
        if checkpoints_for_target(&connection, target)?.is_empty() {
            queue.pop_front();
        }
    }
    let has_more = !queue.is_empty();
    drop(queue);
    if has_more { show_surface(&app, "recovery"); } else { hide_surface(&app, "recovery"); }
    let _ = app.emit("desktop://state-changed", ());
    Ok(())
}

#[tauri::command]
fn get_checkpoint_audio(id: i64, state: State<'_, DesktopState>) -> Result<Vec<u8>, String> {
    let connection = storage::open(&state.db_path).map_err(|error| error.to_string())?;
    let checkpoint = storage::checkpoint_by_id(&connection, id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Checkpoint no encontrado.".to_string())?;
    let path = checkpoint.audio_path.ok_or_else(|| "Este checkpoint no tiene audio.".to_string())?;
    fs::read(path).map_err(|_| "El audio original ya no está disponible.".to_string())
}

#[tauri::command]
fn transcribe_checkpoint(id: i64, state: State<'_, DesktopState>, app: tauri::AppHandle) -> Result<String, String> {
    let connection = storage::open(&state.db_path).map_err(|error| error.to_string())?;
    let checkpoint = storage::checkpoint_by_id(&connection, id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Checkpoint no encontrado.".to_string())?;
    if let Some(existing) = checkpoint.transcript.filter(|value| !value.trim().is_empty()) {
        return Ok(existing);
    }
    let audio_path = checkpoint.audio_path.map(PathBuf::from)
        .ok_or_else(|| "Este checkpoint no tiene audio para transcribir.".to_string())?;
    drop(connection);
    let transcript = transcription::transcribe(
        &audio_path,
        &state.resource_dir,
        &state.data_dir.join("transcription-temp"),
    )?;
    let connection = storage::open(&state.db_path).map_err(|error| error.to_string())?;
    storage::set_checkpoint_transcript(&connection, id, &transcript)
        .map_err(|error| error.to_string())?;
    let _ = app.emit("desktop://state-changed", ());
    Ok(transcript)
}

#[tauri::command]
fn get_checkpoint_history(state: State<'_, DesktopState>) -> Result<Vec<CheckpointRecord>, String> {
    let connection = storage::open(&state.db_path).map_err(|error| error.to_string())?;
    storage::checkpoint_history(&connection).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_worksets(state: State<'_, DesktopState>) -> Result<Vec<WorksetView>, String> {
    let connection = storage::open(&state.db_path).map_err(|error| error.to_string())?;
    let worksets = storage::load_worksets(&connection).map_err(|error| error.to_string())?;
    let active_apps = active_application_ids(&registry_records(&state.registry));
    Ok(worksets.into_iter().map(|workset| WorksetView {
        active: workset.application_ids.iter().any(|id| active_apps.contains(id)),
        id: workset.id,
        name: workset.name,
        application_ids: workset.application_ids,
    }).collect())
}

fn clean_workset_name(name: String) -> Result<String, String> {
    let name = name.trim().to_string();
    if name.is_empty() { return Err("Poné un nombre al entorno.".into()); }
    if name.chars().count() > 80 { return Err("El nombre del entorno es demasiado largo.".into()); }
    Ok(name)
}

#[tauri::command]
fn create_workset(
    name: String,
    application_ids: Vec<String>,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<WorksetRecord, String> {
    let name = clean_workset_name(name)?;
    let id = format!("workset:{}:{}", now_ms(), WORKSET_SEQUENCE.fetch_add(1, Ordering::Relaxed));
    let mut connection = storage::open(&state.db_path).map_err(|error| error.to_string())?;
    let workset = storage::create_workset(&mut connection, &id, &name, &application_ids, now_ms())
        .map_err(|error| error.to_string())?;
    state.synchronize_selection()?;
    let _ = app.emit("desktop://state-changed", ());
    Ok(workset)
}

#[tauri::command]
fn rename_workset(id: String, name: String, state: State<'_, DesktopState>, app: tauri::AppHandle) -> Result<(), String> {
    let name = clean_workset_name(name)?;
    let connection = storage::open(&state.db_path).map_err(|error| error.to_string())?;
    storage::rename_workset(&connection, &id, &name, now_ms()).map_err(|error| error.to_string())?;
    let _ = app.emit("desktop://state-changed", ());
    Ok(())
}

#[tauri::command]
fn set_workset_applications(
    id: String,
    application_ids: Vec<String>,
    state: State<'_, DesktopState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let mut connection = storage::open(&state.db_path).map_err(|error| error.to_string())?;
    storage::set_workset_applications(&mut connection, &id, &application_ids, now_ms())
        .map_err(|error| error.to_string())?;
    state.synchronize_selection()?;
    let _ = app.emit("desktop://state-changed", ());
    Ok(())
}

#[tauri::command]
fn delete_workset(id: String, state: State<'_, DesktopState>, app: tauri::AppHandle) -> Result<(), String> {
    let connection = storage::open(&state.db_path).map_err(|error| error.to_string())?;
    storage::delete_workset(&connection, &id).map_err(|error| error.to_string())?;
    state.synchronize_selection()?;
    let _ = app.emit("desktop://state-changed", ());
    Ok(())
}

#[tauri::command]
fn get_tracking_status(state: State<'_, DesktopState>) -> TrackingStatus {
    TrackingStatus { active: !state.paused.load(Ordering::Acquire) }
}

#[tauri::command]
fn set_tracking_paused(paused: bool, state: State<'_, DesktopState>, app: tauri::AppHandle) -> Result<TrackingStatus, String> {
    state.set_paused(paused)?;
    let _ = app.emit("desktop://state-changed", ());
    Ok(TrackingStatus { active: !paused })
}

#[tauri::command]
fn get_settings(state: State<'_, DesktopState>) -> Result<SettingsView, String> {
    let connection = storage::open(&state.db_path).map_err(|error| error.to_string())?;
    Ok(SettingsView {
        launch_at_startup: storage::bool_setting(&connection, "launch_at_startup").map_err(|error| error.to_string())?,
        tracking_active: !state.paused.load(Ordering::Acquire),
        version: PRODUCT_VERSION,
        data_directory: state.data_dir.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn set_launch_at_startup(enabled: bool, state: State<'_, DesktopState>, app: tauri::AppHandle) -> Result<SettingsView, String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    autostart::set_enabled(enabled, &executable)?;
    let connection = storage::open(&state.db_path).map_err(|error| error.to_string())?;
    storage::set_bool_setting(&connection, "launch_at_startup", enabled).map_err(|error| error.to_string())?;
    let _ = app.emit("desktop://state-changed", ());
    get_settings(state)
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Abrir SelfRelay", true, None::<&str>)?;
    let manual = MenuItem::with_id(app, "manual", "Guardar checkpoint ahora", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "Pausar seguimiento", true, None::<&str>)?;
    let resume = MenuItem::with_id(app, "resume", "Reanudar seguimiento", false, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
    let separator_a = PredefinedMenuItem::separator(app)?;
    let separator_b = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &manual, &separator_a, &pause, &resume, &separator_b, &quit])?;

    let pause_item = pause.clone();
    let resume_item = resume.clone();
    let mut tray = TrayIconBuilder::with_id("selfrelay-tray")
        .menu(&menu)
        .tooltip("SelfRelay")
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "open" => show_surface(app, "main"),
            "manual" => {
                let state = app.state::<DesktopState>();
                let tracked = load_tracked_ids(&state.db_path).unwrap_or_default();
                let records = registry_records(&state.registry);
                if let Some(snapshot) = records
                    .iter()
                    .filter(|record| tracked.contains(&record.context.application_id))
                    .max_by_key(|record| record.metadata.foreground)
                    .map(ContextSnapshot::from)
                {
                    if let Err(error) = enqueue_capture_and_show(app, &state.capture, &snapshot) {
                        state.capture.diagnostic("manual_capture_failed", &error, now_ms());
                    }
                } else {
                    show_surface(app, "main");
                }
            }
            "pause" => {
                let state = app.state::<DesktopState>();
                if state.set_paused(true).is_ok() {
                    let _ = pause_item.set_enabled(false);
                    let _ = resume_item.set_enabled(true);
                    let _ = app.emit("desktop://state-changed", ());
                }
            }
            "resume" => {
                let state = app.state::<DesktopState>();
                if state.set_paused(false).is_ok() {
                    let _ = pause_item.set_enabled(true);
                    let _ = resume_item.set_enabled(false);
                    let _ = app.emit("desktop://state-changed", ());
                }
            }
            "quit" => {
                app.state::<DesktopState>().shutdown();
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event {
                show_surface(tray.app_handle(), "main");
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

fn argument_path(flag: &str) -> Option<PathBuf> {
    let arguments = std::env::args().collect::<Vec<_>>();
    arguments
        .windows(2)
        .find(|pair| pair[0] == flag)
        .map(|pair| PathBuf::from(&pair[1]))
}

fn version_probe_from_args() -> Option<PathBuf> {
    argument_path("--selfrelay-version-file")
}

fn discovery_probe_from_args() -> Option<PathBuf> {
    argument_path("--selfrelay-discovery-report")
}

fn run_discovery_probe(path: &Path) -> Result<(), String> {
    let applications = discovery_quality::filter(discovery::discover(&[]));
    discovery_quality::assert_quality(&applications)?;
    let parent = path.parent().ok_or_else(|| "Discovery report path has no parent.".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let json = serde_json::to_string_pretty(&applications).map_err(|error| error.to_string())?;
    fs::write(path, json).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Some(path) = version_probe_from_args() {
        let _ = fs::write(path, PRODUCT_VERSION);
        return;
    }
    if let Some(path) = discovery_probe_from_args() {
        if let Err(error) = run_discovery_probe(&path) {
            eprintln!("SelfRelay discovery QA failed: {error}");
            std::process::exit(2);
        }
        return;
    }
    let started_by_autostart = std::env::args().any(|argument| argument == "--autostart");
    let runtime_smoke_dir = runtime_smoke::dir_from_args();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_surface(app, "main")))
        .setup(move |app| {
            let data_dir = runtime_smoke_dir
                .as_ref()
                .map(|directory| directory.join("data"))
                .unwrap_or(app.path().app_local_data_dir()?);
            fs::create_dir_all(&data_dir)?;
            fs::create_dir_all(data_dir.join("audio"))?;
            let db_path = data_dir.join("selfrelay.db");
            storage::initialize(&db_path)?;
            identity::migrate_020_identities(&db_path)?;
            capture_store::initialize(&db_path)?;
            let resource_dir = app.path().resource_dir()?;

            let paused = {
                let connection = storage::open(&db_path)?;
                storage::bool_setting(&connection, "tracking_paused")?
            };
            let registry: WindowRegistry = Arc::new(Mutex::new(HashMap::new()));
            let paused_flag = Arc::new(AtomicBool::new(paused));
            let lifecycle = Arc::new(Mutex::new(LifecycleState::default()));
            let capture = Arc::new(CaptureCoordinator::new(&db_path));
            let recovery_queue = Arc::new(Mutex::new(VecDeque::new()));
            let active_worksets = Arc::new(Mutex::new(HashSet::new()));

            if let Some(report_dir) = runtime_smoke_dir.as_ref() {
                let snapshot = ContextSnapshot {
                    application_id: "qa:webview-app".into(),
                    application_name: "SelfRelay WebView Fixture".into(),
                    context_id: "qa:webview-context".into(),
                    context_label: "SelfRelay WebView Fixture".into(),
                };
                let pending = capture
                    .enqueue(&snapshot, now_ms())
                    .map_err(std::io::Error::other)?;
                let connection = storage::open(&db_path)?;
                let checkpoint = storage::insert_checkpoint(
                    &connection,
                    &snapshot.application_id,
                    &snapshot.application_name,
                    &snapshot.context_id,
                    &snapshot.context_label,
                    None,
                    "installed WebView recovery fixture",
                    None,
                    now_ms(),
                )?;
                let recovery_token = format!("context:{}", snapshot.context_id);
                recovery_queue
                    .lock()
                    .map_err(|_| std::io::Error::other("recovery smoke lock poisoned"))?
                    .push_back(RecoveryTarget {
                        key: recovery_token.clone(),
                        kind: RecoveryTargetKind::Context(snapshot),
                    });
                runtime_smoke::configure(
                    report_dir.clone(),
                    pending.id,
                    recovery_token,
                    vec![checkpoint.id],
                )
                .map_err(std::io::Error::other)?;
            }

            let app_handle = app.handle().clone();
            let notify_registry = Arc::clone(&registry);
            let notify_lifecycle = Arc::clone(&lifecycle);
            let notify_capture = Arc::clone(&capture);
            let notify_recovery = Arc::clone(&recovery_queue);
            let notify_worksets = Arc::clone(&active_worksets);
            let notify_db_path = db_path.clone();
            let notify = Arc::new(move || {
                process_registry_change(
                    &app_handle,
                    &notify_registry,
                    &notify_lifecycle,
                    &notify_capture,
                    &notify_recovery,
                    &notify_worksets,
                    &notify_db_path,
                );
            });
            let observer = observer::start(Arc::clone(&registry), Arc::clone(&paused_flag), notify);

            let startup_capture = capture.current().ok().flatten().is_some();
            app.manage(DesktopState {
                registry,
                paused: paused_flag,
                observer: Mutex::new(Some(observer)),
                exiting: AtomicBool::new(false),
                db_path,
                data_dir,
                resource_dir,
                lifecycle,
                capture,
                recovery_queue,
                active_worksets,
                surface_ready: Mutex::new(HashMap::new()),
            });
            if runtime_smoke::active() {
                hide_surface(app.handle(), "main");
                show_surface(app.handle(), "capture");
                show_surface(app.handle(), "recovery");
                let _ = app.emit("desktop://state-changed", ());
            } else {
                setup_tray(app)?;
                if started_by_autostart {
                    hide_surface(app.handle(), "main");
                }
                if startup_capture {
                    show_surface(app.handle(), "capture");
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<DesktopState>();
                if state.exiting.load(Ordering::Acquire) {
                    return;
                }
                match window.label() {
                    "main" => {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                    "capture" => {
                        api.prevent_close();
                        if state.capture.current().ok().flatten().is_some() {
                            show_surface(window.app_handle(), "capture");
                        } else {
                            state.capture.diagnostic("capture_close_without_pending", "close requested while no durable capture existed", now_ms());
                            let _ = window.hide();
                        }
                    }
                    "recovery" => {
                        api.prevent_close();
                        if let Ok(mut queue) = state.recovery_queue.lock() {
                            queue.pop_front();
                        }
                        let _ = window.hide();
                        let _ = window.app_handle().emit("desktop://state-changed", ());
                    }
                    _ => {}
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_discovered_applications,
            get_tracked_applications,
            get_application_icon,
            get_onboarding_completed,
            complete_onboarding,
            set_application_tracking,
            pick_application_executable,
            get_pending_capture,
            capture_surface_ready,
            report_surface_error,
            dismiss_capture,
            save_checkpoint,
            save_checkpoint_now,
            get_active_recovery,
            recovery_surface_ready,
            defer_recovery,
            resolve_checkpoint,
            get_checkpoint_audio,
            transcribe_checkpoint,
            get_checkpoint_history,
            get_worksets,
            create_workset,
            rename_workset,
            set_workset_applications,
            delete_workset,
            get_tracking_status,
            set_tracking_paused,
            get_settings,
            set_launch_at_startup
        ])
        .run(tauri::generate_context!())
        .expect("failed to run SelfRelay Desktop");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_finalized_wav_and_rejects_partial_audio() {
        let mut wav = vec![0u8; 44];
        wav[0..4].copy_from_slice(b"RIFF");
        wav[8..12].copy_from_slice(b"WAVE");
        assert!(validate_audio(&wav).is_ok());
        assert!(validate_audio(b"RIFFpartial").is_err());
    }

    #[test]
    fn product_version_is_complete_candidate_line() {
        assert_eq!(PRODUCT_VERSION, "0.2.2");
    }
}
