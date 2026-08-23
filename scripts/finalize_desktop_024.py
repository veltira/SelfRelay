from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

def read(path): return (ROOT / path).read_text(encoding="utf-8")
def write(path, text): (ROOT / path).write_text(text, encoding="utf-8", newline="\n")
def once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 occurrence, got {count}")
    return text.replace(old, new, 1)

def regex_once(text, pattern, repl, label):
    next_text, count = re.subn(pattern, repl, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 regex match, got {count}")
    return next_text

# ---------- versions / dependencies ----------
path = "apps/desktop/src-tauri/Cargo.toml"
s = read(path)
s = once(s, 'version = "0.2.3"', 'version = "0.2.4"', "cargo version")
s = once(s, 'crossbeam-channel = "0.5"', 'crossbeam-channel = "0.5"\nhound = "3.5.1"\nwhisper-rs = "0.16.0"', "whisper deps")
write(path, s)

for path in ["apps/desktop/package.json", "apps/desktop/package-lock.json"]:
    s = read(path).replace('"version": "0.2.3"', '"version": "0.2.4"')
    write(path, s)

path = "apps/desktop/src-tauri/tauri.conf.json"
s = read(path)
s = once(s, '"version": "0.2.3"', '"version": "0.2.4"', "tauri version")
s = once(s, '"resources": ["resources/whisper/whisper-cli.exe", "resources/whisper/ggml-base-q5_1.bin"]', '"resources": ["resources/whisper/ggml-base-q5_1.bin"]', "tauri resources")
write(path, s)

# ---------- storage: archive setting + exact deletion ----------
path = "apps/desktop/src-tauri/src/storage.rs"
s = read(path)
s = once(s, "pub const SCHEMA_VERSION: i64 = 3;", "pub const SCHEMA_VERSION: i64 = 4;", "schema version")
anchor = '''    if schema_version(connection)? < 3 {
        let tx = connection.transaction()?;
        tx.execute_batch(
            "ALTER TABLE checkpoints ADD COLUMN workset_id TEXT;'''
if anchor not in s:
    raise SystemExit("storage migration 3 anchor missing")
insert_after = '''        tx.commit()?;
    }

    connection.execute(
        "INSERT OR IGNORE INTO settings(key, value) VALUES ('desktop_onboarding_completed', '0')",
        [],
    )?;'''
replacement = '''        tx.commit()?;
    }

    if schema_version(connection)? < 4 {
        let tx = connection.transaction()?;
        tx.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_checkpoints_application_history
                ON checkpoints(application_id, created_at_ms, id);
             CREATE INDEX IF NOT EXISTS idx_checkpoints_workset_history
                ON checkpoints(workset_id, created_at_ms, id);
             INSERT OR IGNORE INTO settings(key, value) VALUES ('archive_resolved_checkpoints', '1');",
        )?;
        tx.execute(
            "INSERT OR IGNORE INTO schema_migrations(version, applied_at_ms) VALUES (4, 0)",
            [],
        )?;
        tx.commit()?;
    }

    connection.execute(
        "INSERT OR IGNORE INTO settings(key, value) VALUES ('desktop_onboarding_completed', '0')",
        [],
    )?;'''
s = once(s, insert_after, replacement, "migration 4")
s = once(s, '''    connection.execute(
        "INSERT OR IGNORE INTO settings(key, value) VALUES ('launch_at_startup', '0')",
        [],
    )?;
    Ok(())''', '''    connection.execute(
        "INSERT OR IGNORE INTO settings(key, value) VALUES ('launch_at_startup', '0')",
        [],
    )?;
    connection.execute(
        "INSERT OR IGNORE INTO settings(key, value) VALUES ('archive_resolved_checkpoints', '1')",
        [],
    )?;
    Ok(())''', "archive default")
resolve_fn = '''pub fn resolve_checkpoint(connection: &Connection, id: i64, resolved_at_ms: u64) -> rusqlite::Result<()> {
    connection.execute(
        "UPDATE checkpoints SET resolved_at_ms = COALESCE(resolved_at_ms, ?2) WHERE id = ?1",
        params![id, resolved_at_ms as i64],
    )?;
    Ok(())
}
'''
resolve_new = resolve_fn + '''
pub fn delete_checkpoint(connection: &Connection, id: i64) -> rusqlite::Result<Option<String>> {
    let audio_path: Option<String> = connection
        .query_row("SELECT audio_path FROM checkpoints WHERE id = ?1", [id], |row| row.get(0))
        .optional()?
        .flatten();
    connection.execute("DELETE FROM checkpoints WHERE id = ?1", [id])?;
    Ok(audio_path)
}
'''
s = once(s, resolve_fn, resolve_new, "delete checkpoint")
s = once(s, 'assert_eq!(schema_version(&connection).unwrap(), SCHEMA_VERSION);', 'assert_eq!(schema_version(&connection).unwrap(), SCHEMA_VERSION);\n        assert!(bool_setting(&connection, "archive_resolved_checkpoints").unwrap());', "storage migration test")
write(path, s)

# ---------- backend recovery / settings ----------
path = "apps/desktop/src-tauri/src/lib.rs"
s = read(path)
s = once(s, 'const PRODUCT_VERSION: &str = "0.2.3";', 'const PRODUCT_VERSION: &str = "0.2.4";', "product version")
s = once(s, '''enum RecoveryTargetKind {
    Context(ContextSnapshot),
    Workset { id: String, name: String, source: ContextSnapshot },
}''', '''enum RecoveryTargetKind {
    Context(ContextSnapshot),
    Workset { id: String, name: String, source: ContextSnapshot },
    Checkpoint {
        id: i64,
        target_name: String,
        source: ContextSnapshot,
        workset_id: Option<String>,
    },
}''', "checkpoint recovery kind")
s = once(s, '''struct SettingsView {
    launch_at_startup: bool,
    tracking_active: bool,
    version: &'static str,
    data_directory: String,
}''', '''struct SettingsView {
    launch_at_startup: bool,
    tracking_active: bool,
    archive_resolved_checkpoints: bool,
    version: &'static str,
    data_directory: String,
}''', "settings view")
s = once(s, '''        RecoveryTargetKind::Context(context) => storage::unresolved_for_context(connection, &context.context_id),
        RecoveryTargetKind::Workset { id, .. } => storage::unresolved_for_workset(connection, id),
    }
    .map_err(|error| error.to_string())''', '''        RecoveryTargetKind::Context(context) => storage::unresolved_for_context(connection, &context.context_id),
        RecoveryTargetKind::Workset { id, .. } => storage::unresolved_for_workset(connection, id),
        RecoveryTargetKind::Checkpoint { id, .. } => storage::checkpoint_by_id(connection, *id)
            .map(|checkpoint| checkpoint.into_iter().collect()),
    }
    .map_err(|error| error.to_string())''', "checkpoint target query")
s = once(s, '''            RecoveryTargetKind::Workset { id, name, source } => RecoveryView {
                target_kind: "workset",
                target_name: name,
                application_id: source.application_id,
                application_name: source.application_name,
                context_id: source.context_id,
                context_label: source.context_label,
                workset_id: Some(id),
                ready_token,
                checkpoints,
            },''', '''            RecoveryTargetKind::Workset { id, name, source } => RecoveryView {
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
            RecoveryTargetKind::Checkpoint { target_name, source, workset_id, .. } => RecoveryView {
                target_kind: "checkpoint",
                target_name,
                application_id: source.application_id,
                application_name: source.application_name,
                context_id: source.context_id,
                context_label: source.context_label,
                workset_id,
                ready_token,
                checkpoints,
            },''', "checkpoint recovery view")

old_resolve = '''#[tauri::command]
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
    clear_surface_ready(&state, "recovery");
    if has_more { show_surface(&app, "recovery"); } else { hide_surface(&app, "recovery"); }
    let _ = app.emit("desktop://state-changed", ());
    Ok(())
}
'''
new_resolve = '''#[tauri::command]
fn resolve_checkpoint(id: i64, state: State<'_, DesktopState>, app: tauri::AppHandle) -> Result<(), String> {
    let connection = storage::open(&state.db_path).map_err(|error| error.to_string())?;
    let checkpoint = storage::checkpoint_by_id(&connection, id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Checkpoint no encontrado.".to_string())?;
    let archive = storage::bool_setting(&connection, "archive_resolved_checkpoints")
        .map_err(|error| error.to_string())?;
    if archive {
        storage::resolve_checkpoint(&connection, id, now_ms()).map_err(|error| error.to_string())?;
    } else {
        let audio_path = storage::delete_checkpoint(&connection, id).map_err(|error| error.to_string())?;
        if let Some(path) = audio_path { let _ = fs::remove_file(path); }
    }

    let mut queue = state.recovery_queue.lock().map_err(|_| "recovery lock poisoned".to_string())?;
    let should_pop = queue.front().map(|target| match &target.kind {
        RecoveryTargetKind::Checkpoint { id: target_id, .. } => *target_id == id,
        _ => checkpoints_for_target(&connection, target).map(|items| items.is_empty()).unwrap_or(false),
    }).unwrap_or(false);
    if should_pop { queue.pop_front(); }
    let has_more = !queue.is_empty();
    drop(queue);
    clear_surface_ready(&state, "recovery");
    if has_more { show_surface(&app, "recovery"); } else { hide_surface(&app, "recovery"); }
    let _ = app.emit("desktop://state-changed", ());
    drop(checkpoint);
    Ok(())
}

#[tauri::command]
fn open_checkpoint(id: i64, state: State<'_, DesktopState>, app: tauri::AppHandle) -> Result<(), String> {
    let connection = storage::open(&state.db_path).map_err(|error| error.to_string())?;
    let checkpoint = storage::checkpoint_by_id(&connection, id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Checkpoint no encontrado.".to_string())?;
    let target_name = checkpoint.workset_id.as_deref().and_then(|workset_id| {
        storage::load_worksets(&connection).ok()?.into_iter()
            .find(|workset| workset.id == workset_id)
            .map(|workset| workset.name)
    }).unwrap_or_else(|| checkpoint.application_name.clone());
    let source = ContextSnapshot {
        application_id: checkpoint.application_id.clone(),
        application_name: checkpoint.application_name.clone(),
        context_id: checkpoint.context_id.clone(),
        context_label: checkpoint.context_label.clone(),
    };
    let mut queue = state.recovery_queue.lock().map_err(|_| "recovery lock poisoned".to_string())?;
    queue.retain(|target| !matches!(&target.kind, RecoveryTargetKind::Checkpoint { id: current, .. } if *current == id));
    queue.push_front(RecoveryTarget {
        key: format!("checkpoint:{id}:{}", now_ms()),
        kind: RecoveryTargetKind::Checkpoint {
            id,
            target_name,
            source,
            workset_id: checkpoint.workset_id,
        },
    });
    drop(queue);
    clear_surface_ready(&state, "recovery");
    show_surface(&app, "recovery");
    let _ = app.emit("desktop://state-changed", ());
    Ok(())
}
'''
s = once(s, old_resolve, new_resolve, "resolve/open checkpoint")
s = once(s, '''        launch_at_startup: storage::bool_setting(&connection, "launch_at_startup").map_err(|error| error.to_string())?,
        tracking_active: !state.paused.load(Ordering::Acquire),
        version: PRODUCT_VERSION,''', '''        launch_at_startup: storage::bool_setting(&connection, "launch_at_startup").map_err(|error| error.to_string())?,
        tracking_active: !state.paused.load(Ordering::Acquire),
        archive_resolved_checkpoints: storage::bool_setting(&connection, "archive_resolved_checkpoints").map_err(|error| error.to_string())?,
        version: PRODUCT_VERSION,''', "settings archive read")
startup_fn = '''#[tauri::command]
fn set_launch_at_startup(enabled: bool, state: State<'_, DesktopState>, app: tauri::AppHandle) -> Result<SettingsView, String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    autostart::set_enabled(enabled, &executable)?;
    let connection = storage::open(&state.db_path).map_err(|error| error.to_string())?;
    storage::set_bool_setting(&connection, "launch_at_startup", enabled).map_err(|error| error.to_string())?;
    let _ = app.emit("desktop://state-changed", ());
    get_settings(state)
}
'''
s = once(s, startup_fn, startup_fn + '''
#[tauri::command]
fn set_archive_resolved_checkpoints(enabled: bool, state: State<'_, DesktopState>, app: tauri::AppHandle) -> Result<SettingsView, String> {
    let connection = storage::open(&state.db_path).map_err(|error| error.to_string())?;
    storage::set_bool_setting(&connection, "archive_resolved_checkpoints", enabled)
        .map_err(|error| error.to_string())?;
    let _ = app.emit("desktop://state-changed", ());
    get_settings(state)
}
''', "archive setting command")
# Closing the recovery popup is non-destructive. Explicit 'Lo veo después' still dequeues it.
s = once(s, '''                    "recovery" => {
                        api.prevent_close();
                        if let Ok(mut queue) = state.recovery_queue.lock() {
                            queue.pop_front();
                        }
                        clear_surface_ready(&state, "recovery");
                        let _ = window.hide();
                        let _ = window.app_handle().emit("desktop://state-changed", ());
                    }''', '''                    "recovery" => {
                        api.prevent_close();
                        let _ = window.hide();
                        let _ = window.app_handle().emit("desktop://state-changed", ());
                    }''', "non-destructive recovery close")
s = once(s, '''            resolve_checkpoint,
            get_checkpoint_audio,''', '''            resolve_checkpoint,
            open_checkpoint,
            get_checkpoint_audio,''', "open handler")
s = once(s, '''            get_settings,
            set_launch_at_startup
''', '''            get_settings,
            set_launch_at_startup,
            set_archive_resolved_checkpoints
''', "archive handler")
s = once(s, 'assert_eq!(PRODUCT_VERSION, "0.2.3");', 'assert_eq!(PRODUCT_VERSION, "0.2.4");', "version test")
write(path, s)

# ---------- frontend: grouped archive, reopen, history transcription, archive toggle ----------
path = "apps/desktop/src/App.tsx"
s = read(path)
s = once(s, 'const PRODUCT_VERSION = "0.2.3";', 'const PRODUCT_VERSION = "0.2.4";', "frontend version")
new_sections = r'''function HistoryCheckpoint({ item, onOpen }: { item: CheckpointRecord; onOpen: (id: number) => Promise<void> }) {
  const [transcript, setTranscript] = useState(item.transcript ?? null);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setTranscript(item.transcript ?? null), [item.transcript]);
  const transcribe = async () => {
    setTranscribing(true);
    try { setTranscript(await invoke<string>("transcribe_checkpoint", { id: item.id })); setError(null); }
    catch (cause) { setError(String(cause)); }
    finally { setTranscribing(false); }
  };
  return <article className="history-entry"><div className="history-top"><div><strong>{item.contextLabel}</strong><span>Checkpoint #{item.id}</span></div><div className="history-status"><time>{formatTime(item.createdAtMs)}</time><span className={item.resolvedAtMs ? "resolved" : "pending"}>{item.resolvedAtMs ? "Retomado" : "Pendiente"}</span></div></div>{item.text && <p>{item.text}</p>}<AudioPlayback checkpoint={item} />{item.audioPath && !transcript && <button className="text-link transcribe-link" disabled={transcribing} onClick={() => void transcribe()}>{transcribing ? "Transcribiendo localmente…" : "Transcribir audio"}</button>}{transcript && <div className="transcript"><span>Transcripción</span><p>{transcript}</p></div>}{error && <div className="retry-line"><span>{error}</span><button className="text-link" onClick={() => void transcribe()}>Reintentar</button></div>}<div className="history-entry-actions"><button className="button button-secondary button-small" onClick={() => void onOpen(item.id)}>Abrir checkpoint</button></div></article>;
}

function HistorySection({ history, worksets, onOpen }: { history: CheckpointRecord[]; worksets: WorksetView[]; onOpen: (id: number) => Promise<void> }) {
  const names = useMemo(() => new Map(worksets.map((w) => [w.id, w.name])), [worksets]);
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; title: string; detail: string; latest: number; items: CheckpointRecord[] }>();
    for (const item of history) {
      const key = item.worksetId ? `workset:${item.worksetId}` : `application:${item.applicationId}`;
      const title = item.worksetId ? names.get(item.worksetId) ?? "Entorno" : item.applicationName;
      const detail = item.worksetId ? `${item.applicationName} · entorno` : "Aplicación";
      const group = map.get(key) ?? { key, title, detail, latest: item.createdAtMs, items: [] };
      group.latest = Math.max(group.latest, item.createdAtMs);
      group.items.push(item);
      map.set(key, group);
    }
    return [...map.values()].sort((a, b) => b.latest - a.latest).map((group) => ({ ...group, items: [...group.items].sort((a, b) => a.createdAtMs - b.createdAtMs || a.id - b.id) }));
  }, [history, names]);
  return <section className="main-section"><div className="section-title-row"><div><h1>Historial</h1><p>Tu contexto queda ordenado por aplicación o entorno. Cualquier checkpoint se puede volver a abrir.</p></div></div><div className="history-list">{groups.length === 0 && <div className="empty-line"><strong>Todavía no hay checkpoints.</strong></div>}{groups.map((group) => <section className="history-group" key={group.key}><div className="history-group-head"><div><h2>{group.title}</h2><span>{group.detail}</span></div><span>{group.items.length} {group.items.length === 1 ? "checkpoint" : "checkpoints"}</span></div><div className="history-timeline">{group.items.map((item) => <HistoryCheckpoint key={item.id} item={item} onOpen={onOpen} />)}</div></section>)}</div></section>;
}

function SettingsSection({ settings, onStartup, onPause, onArchive }: { settings: SettingsView; onStartup: (enabled: boolean) => Promise<void>; onPause: (paused: boolean) => Promise<void>; onArchive: (enabled: boolean) => Promise<void> }) {
  return <section className="main-section settings-section"><div className="section-title-row"><div><h1>Ajustes</h1><p>Preferencias esenciales de SelfRelay.</p></div></div><div className="settings-list"><label className="setting-row"><div><strong>Iniciar SelfRelay con Windows</strong><span>Se inicia en segundo plano y queda disponible desde el tray.</span></div><input className="switch" type="checkbox" checked={settings.launchAtStartup} onChange={(e) => void onStartup(e.target.checked)} /></label><label className="setting-row"><div><strong>Seguimiento</strong><span>Pausar no borra checkpoints ni aplicaciones seleccionadas.</span></div><input className="switch" type="checkbox" checked={settings.trackingActive} onChange={(e) => void onPause(!e.target.checked)} /></label><label className="setting-row"><div><strong>Conservar historial completo</strong><span>Al marcar un checkpoint como retomado, mantenelo archivado para seguir la evolución de cada aplicación o entorno.</span></div><input className="switch" type="checkbox" checked={settings.archiveResolvedCheckpoints} onChange={(e) => void onArchive(e.target.checked)} /></label><div className="setting-row static"><div><strong>Privacidad</strong><span>Aplicaciones, checkpoints, audio y transcripciones permanecen locales.</span></div><span className="local-pill">Solo local</span></div><div className="setting-row static"><div><strong>Transcripción</strong><span>Whisper se ejecuta dentro de SelfRelay, sin consola ni procesos auxiliares.</span></div><span className="local-pill">Integrada</span></div><div className="setting-row static"><div><strong>Datos locales</strong><span className="path-text">{settings.dataDirectory}</span></div></div></div><div className="about-line"><Brand compact /><span>SelfRelay {settings.version}</span></div></section>;
}

function MainProduct()'''
s = regex_once(s, r'function HistorySection\(.*?\n\}\n\nfunction MainProduct\(\)', new_sections, "history/settings replacement")
s = once(s, '''{section === "history" && <HistorySection history={history} worksets={worksets} />}{section === "settings" && <SettingsSection settings={settings} onStartup={async (enabled) => run(() => invoke("set_launch_at_startup", { enabled }))} onPause={async (paused) => run(() => invoke("set_tracking_paused", { paused }))} />}''', '''{section === "history" && <HistorySection history={history} worksets={worksets} onOpen={async (id) => run(() => invoke("open_checkpoint", { id }))} />}{section === "settings" && <SettingsSection settings={settings} onStartup={async (enabled) => run(() => invoke("set_launch_at_startup", { enabled }))} onPause={async (paused) => run(() => invoke("set_tracking_paused", { paused }))} onArchive={async (enabled) => run(() => invoke("set_archive_resolved_checkpoints", { enabled }))} />}''', "main history/settings wiring")
s = once(s, '''const settings: SettingsView = { launchAtStartup: true, trackingActive: true, version: PRODUCT_VERSION, dataDirectory: "C:\\\\Users\\\\Demo\\\\AppData\\\\Local\\\\SelfRelay" };''', '''const settings: SettingsView = { launchAtStartup: true, trackingActive: true, archiveResolvedCheckpoints: true, version: PRODUCT_VERSION, dataDirectory: "C:\\\\Users\\\\Demo\\\\AppData\\\\Local\\\\SelfRelay" };''', "qa settings")
s = once(s, '''{section === "history" && <HistorySection history={qaHistory} worksets={qaWorksets} />}{section === "settings" && <SettingsSection settings={settings} onStartup={async () => undefined} onPause={async () => undefined} />}''', '''{section === "history" && <HistorySection history={qaHistory} worksets={qaWorksets} onOpen={async () => undefined} />}{section === "settings" && <SettingsSection settings={settings} onStartup={async () => undefined} onPause={async () => undefined} onArchive={async () => undefined} />}''', "qa section wiring")
write(path, s)

# ---------- CSS ----------
path = "apps/desktop/src/styles.css"
s = read(path)
css = '''

/* Desktop 0.2.4 — history is a durable project timeline, not a dead log. */
.history-group { display: grid; gap: 12px; padding: 18px; border: 1px solid var(--border, #d9dee7); border-radius: 16px; background: var(--surface, #fff); }
.history-group + .history-group { margin-top: 16px; }
.history-group-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.history-group-head > div { display: grid; gap: 2px; }
.history-group-head h2 { margin: 0; font-size: 17px; }
.history-group-head span { font-size: 12px; opacity: .66; }
.history-timeline { display: grid; gap: 10px; }
.history-entry-actions { display: flex; justify-content: flex-end; margin-top: 12px; }
.history-entry .transcribe-link { margin-top: 8px; }
'''
if "Desktop 0.2.4 — history" not in s:
    s += css
write(path, s)

# ---------- resources: model only, no helper executable ----------
write("apps/desktop/scripts/prepare-ci-resources.ps1", '''$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "../../..")).Path
$Out = Join-Path $Root "apps/desktop/src-tauri/resources/whisper"
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$Model = Join-Path $Out "ggml-base-q5_1.bin"

# Tauri validates configured resources during check/test. CI needs only a model
# placeholder; production packaging downloads the pinned real model. Whisper is
# linked into SelfRelay.exe, so no whisper-cli.exe is ever bundled.
[IO.File]::WriteAllBytes($Model, [Text.Encoding]::ASCII.GetBytes("SELFRELAY_CI_RESOURCE_PLACEHOLDER_MODEL"))
if ((Get-Item $Model).Length -eq 0) { throw "Failed to create CI-only model placeholder" }
Write-Host "Prepared CI-only Whisper model placeholder (in-process runtime; no helper executable)."
''')

write("apps/desktop/scripts/prepare-whisper-runtime.ps1", '''$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "../../..")).Path
$Out = Join-Path $Root "apps/desktop/src-tauri/resources/whisper"
$Work = Join-Path $env:RUNNER_TEMP "selfrelay-desktop-whisper"
$ModelCommit = "c521a4b02f422512d734391fdf08bb08c0862f68"
$ModelUrl = "https://huggingface.co/ggerganov/whisper.cpp/resolve/$ModelCommit/ggml-base-q5_1.bin?download=true"
$ModelSha256 = "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898"
$SampleCommit = "f86a51a04e5c9e6b82dc9f22c01ada4cb8c40c5f"
$SampleUrl = "https://raw.githubusercontent.com/wudale/whisper-asr-server/$SampleCommit/samples/es.wav"

Remove-Item $Work -Force -Recurse -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $Work, $Out | Out-Null
Remove-Item (Join-Path $Out "*") -Force -Recurse -ErrorAction SilentlyContinue

$Model = Join-Path $Out "ggml-base-q5_1.bin"
Invoke-WebRequest -Uri $ModelUrl -OutFile $Model
$ActualModelSha = (Get-FileHash $Model -Algorithm SHA256).Hash.ToLowerInvariant()
if ($ActualModelSha -ne $ModelSha256) { throw "Whisper model checksum mismatch: $ActualModelSha" }

$Sample = Join-Path $Work "spanish.wav"
Invoke-WebRequest -Uri $SampleUrl -OutFile $Sample
if (-not (Test-Path $Sample) -or (Get-Item $Sample).Length -lt 1000) { throw "Spanish Whisper sample download failed" }

@(
  "WHISPER_BINDING=whisper-rs-0.16.0"
  "MODEL_COMMIT=$ModelCommit"
  "MODEL_SHA256=$ActualModelSha"
  "EXECUTION=IN_PROCESS"
  "CHILD_EXECUTABLE=NONE"
  "CONSOLE_WINDOW=NONE"
) | Set-Content (Join-Path $Out "runtime-metadata.txt") -Encoding utf8

Write-Host "Prepared SelfRelay in-process Whisper model. No whisper-cli.exe is bundled."
''')

# ---------- package workflow / upgrade scripts ----------
path = ".github/workflows/desktop-package.yml"
s = read(path)
s = s.replace("0.2.3", "0.2.4")
s = s.replace("SelfRelay-Windows-Installer-0.2.3", "SelfRelay-Windows-Installer-0.2.4")
needle = '''      - name: Install frontend dependencies
        working-directory: apps/desktop
        run: npm ci --workspaces=false --no-audit --no-fund
'''
addition = needle + '''      - name: In-process Whisper Spanish smoke
        working-directory: apps/desktop/src-tauri
        shell: pwsh
        env:
          SELFRELAY_RESOURCE_DIR: ${{ github.workspace }}\\apps\\desktop\\src-tauri
          SELFRELAY_WHISPER_SAMPLE: ${{ runner.temp }}\\selfrelay-desktop-whisper\\spanish.wav
        run: cargo test --release real_spanish_sample_uses_in_process_whisper -- --ignored --nocapture
      - name: Assert no Whisper helper executable is bundled
        shell: pwsh
        run: |
          $helper = Join-Path $env:GITHUB_WORKSPACE "apps/desktop/src-tauri/resources/whisper/whisper-cli.exe"
          if (Test-Path $helper) { throw "whisper-cli.exe must not be present in Desktop 0.2.4" }
'''
s = once(s, needle, addition, "package whisper smoke")
s = s.replace('"WHISPER_RUNTIME=LOCAL_ON_DEMAND"', '"WHISPER_RUNTIME=LOCAL_IN_PROCESS"')
s = s.replace('"TRANSCRIPTION=LOCAL_WHISPER_ASYNC_AUTOMATIC_ON_RECOVERY_WITH_MANUAL_RETRY"', '"TRANSCRIPTION=LOCAL_WHISPER_IN_PROCESS_ASYNC_FROM_RECOVERY_AND_HISTORY"\n            "WHISPER_CHILD_PROCESS=NONE"\n            "WHISPER_CONSOLE_WINDOW=NONE"')
write(path, s)

for path in ["apps/desktop/scripts/upgrade-qa.ps1", "apps/desktop/scripts/installed-webview-smoke.ps1"]:
    s = read(path).replace("0.2.3", "0.2.4")
    write(path, s)

# Ensure Desktop CI accepts final/* branch pushes too (PR already works, this gives immediate feedback).
path = ".github/workflows/desktop-ci.yml"
s = read(path)
s = once(s, '      - "desktop/**"\n    paths:', '      - "desktop/**"\n      - "final/**"\n    paths:', "desktop ci final push")
write(path, s)

# README wording is updated after public artifact verification; avoid stale 0.2.3 claims in source docs now.
print("Desktop 0.2.4 deterministic patch applied")
