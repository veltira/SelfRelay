import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import logoUrl from "../../../assets/branding/selfrelay-logo.png";
import type {
  ApplicationIcon, CaptureView, CheckpointRecord, DiscoveredApplication,
  RecoveryView, SettingsView, TrackedApplication, WorksetView,
} from "./types";

const PRODUCT_VERSION = "0.2.3";
const iconCache = new Map<string, string>();
type MainSection = "apps" | "worksets" | "history" | "settings";

function formatTime(value: number) {
  return new Intl.DateTimeFormat("es-UY", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function encodeWav(samples: Float32Array, sampleRate: number) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => { for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i)); };
  write(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); write(8, "WAVE"); write(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, "data"); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) { const sample = Math.max(-1, Math.min(1, samples[i] ?? 0)); view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true); }
  return new Uint8Array(buffer);
}

async function mediaBlobToWav(blob: Blob) {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const sampleRate = 16_000;
    const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * sampleRate)), sampleRate);
    const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
    const rendered = await offline.startRendering();
    return encodeWav(rendered.getChannelData(0), sampleRate);
  } finally { await context.close(); }
}

function applicationToTracked(app: DiscoveredApplication): TrackedApplication {
  return { applicationId: app.applicationId, applicationName: app.applicationName, executablePath: app.executablePath };
}

function searchable(app: DiscoveredApplication) {
  return [app.applicationName, app.executableName, app.executablePath, app.packageFamilyName, app.appUserModelId, ...(app.aliases ?? [])]
    .filter(Boolean).join(" ").toLocaleLowerCase();
}

function AppIcon({ app, size = 36 }: { app: TrackedApplication; size?: number }) {
  const key = app.executablePath ?? app.applicationId;
  const [src, setSrc] = useState<string | null>(() => iconCache.get(key) ?? null);
  useEffect(() => {
    let cancelled = false;
    const cached = iconCache.get(key); if (cached) { setSrc(cached); return () => { cancelled = true; }; }
    void invoke<ApplicationIcon>("get_application_icon", { executablePath: app.executablePath ?? null }).then((icon) => {
      if (cancelled || icon.rgba.length !== icon.width * icon.height * 4) return;
      const canvas = document.createElement("canvas"); canvas.width = icon.width; canvas.height = icon.height;
      const context = canvas.getContext("2d"); if (!context) return;
      context.putImageData(new ImageData(new Uint8ClampedArray(icon.rgba), icon.width, icon.height), 0, 0);
      const url = canvas.toDataURL("image/png"); iconCache.set(key, url); if (!cancelled) setSrc(url);
    }).catch(() => setSrc(null));
    return () => { cancelled = true; };
  }, [app.executablePath, key]);
  return <span className="native-app-icon" style={{ width: size, height: size }} aria-hidden="true">{src ? <img src={src} alt="" /> : <span className="icon-fallback"><span /></span>}</span>;
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={`brand ${compact ? "brand-compact" : ""}`}><span className="brand-mark"><img src={logoUrl} alt="" /></span><span>SelfRelay</span></div>;
}
function Notice({ children, error = false }: { children: React.ReactNode; error?: boolean }) { return <div className={`notice ${error ? "notice-error" : ""}`}>{children}</div>; }
function AppRow({ app, detail, action, actionLabel, mutedAction = false }: { app: TrackedApplication; detail: string; action?: () => void; actionLabel?: string; mutedAction?: boolean }) {
  return <div className="app-row"><AppIcon app={app} /><div className="row-copy"><strong>{app.applicationName}</strong><span>{detail}</span></div>{action && actionLabel && <button className={`button button-small ${mutedAction ? "button-secondary" : "button-primary"}`} onClick={action}>{actionLabel}</button>}</div>;
}

function Onboarding({ discovered, initialTracked, onComplete, onPick, busy }: { discovered: DiscoveredApplication[]; initialTracked: TrackedApplication[]; onComplete: (apps: TrackedApplication[]) => Promise<void>; onPick: () => Promise<TrackedApplication | null>; busy: boolean }) {
  const [selected, setSelected] = useState(() => new Map(initialTracked.map((app) => [app.applicationId, app])));
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => { const term = search.trim().toLocaleLowerCase(); return discovered.filter((app) => !term || searchable(app).includes(term)); }, [discovered, search]);
  const toggle = (app: DiscoveredApplication) => setSelected((current) => { const next = new Map(current); if (next.has(app.applicationId)) next.delete(app.applicationId); else next.set(app.applicationId, applicationToTracked(app)); return next; });
  const pick = async () => { const app = await onPick(); if (app) setSelected((current) => new Map(current).set(app.applicationId, app)); };
  return <main className="onboarding-page"><section className="onboarding-panel"><Brand /><div className="onboarding-copy"><h1>Elegí las aplicaciones donde trabajás.</h1><p>SelfRelay solo seguirá las que elijas. Podés cambiarlas en cualquier momento.</p></div><label className="search-box"><span>⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar aplicaciones" autoFocus /></label><div className="select-list">{filtered.length === 0 ? <div className="empty-inline">No encontramos otra aplicación útil. Podés elegir un .exe o .lnk.</div> : filtered.map((app) => { const checked = selected.has(app.applicationId); return <button className={`select-app ${checked ? "selected" : ""}`} key={app.applicationId} onClick={() => toggle(app)}><AppIcon app={app} size={38} /><span className="select-copy"><strong>{app.applicationName}</strong><small>{app.running ? "Abierta ahora" : app.appUserModelId ? "Microsoft Store / Windows" : "Instalada"}</small></span><span className={`check-control ${checked ? "checked" : ""}`}>{checked ? "✓" : ""}</span></button>; })}</div><div className="onboarding-footer"><button className="button button-secondary" disabled={busy} onClick={() => void pick()}>Elegir otra aplicación…</button><button className="button button-primary" disabled={busy} onClick={() => void onComplete([...selected.values()])}>Continuar</button></div><p className="privacy-copy">Todo queda en este equipo. SelfRelay no lee tus documentos, no registra teclas y no sube checkpoints a la nube.</p></section></main>;
}

function AudioPlayback({ checkpoint }: { checkpoint: CheckpointRecord }) {
  const [url, setUrl] = useState<string | null>(null); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const load = async () => { setBusy(true); try { const bytes = await invoke<number[]>("get_checkpoint_audio", { id: checkpoint.id }); const next = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "audio/wav" })); if (url) URL.revokeObjectURL(url); setUrl(next); setError(null); } catch (cause) { setError(String(cause)); } finally { setBusy(false); } };
  if (!checkpoint.audioPath) return null;
  return <div className="checkpoint-audio">{url ? <audio controls src={url} /> : <button className="text-link" disabled={busy} onClick={() => void load()}>{busy ? "Cargando audio…" : "Escuchar audio"}</button>}{error && <small className="inline-error">{error}</small>}</div>;
}

function ApplicationsSection({ discovered, tracked, busy, onAdd, onRemove, onPick, onManualCheckpoint }: { discovered: DiscoveredApplication[]; tracked: TrackedApplication[]; busy: boolean; onAdd: (app: TrackedApplication) => Promise<void>; onRemove: (app: TrackedApplication) => Promise<void>; onPick: () => Promise<void>; onManualCheckpoint: () => Promise<void> }) {
  const [search, setSearch] = useState(""); const running = useMemo(() => new Set(discovered.filter((a) => a.running).map((a) => a.applicationId)), [discovered]); const trackedIds = useMemo(() => new Set(tracked.map((a) => a.applicationId)), [tracked]);
  const available = useMemo(() => { const term = search.trim().toLocaleLowerCase(); return discovered.filter((app) => !trackedIds.has(app.applicationId) && (!term || searchable(app).includes(term))); }, [discovered, trackedIds, search]);
  return <section className="main-section"><div className="section-title-row"><div><h1>Aplicaciones</h1><p>SelfRelay observa únicamente las aplicaciones que añadiste.</p></div><button className="button button-secondary" disabled={busy} onClick={() => void onManualCheckpoint()}>Guardar checkpoint ahora</button></div><div className="section-block"><div className="block-title"><h2>En seguimiento</h2><span>{tracked.length}</span></div>{tracked.length === 0 ? <div className="empty-line"><strong>No hay aplicaciones en seguimiento.</strong><span>SelfRelay no generará checkpoints hasta que añadas una.</span></div> : tracked.map((app) => <AppRow key={app.applicationId} app={app} detail={running.has(app.applicationId) ? "Activa" : "Esperando"} action={() => void onRemove(app)} actionLabel="Quitar" mutedAction />)}</div><div className="section-block"><div className="block-title"><h2>Disponibles</h2><span>{available.length}</span></div><label className="search-box compact"><span>⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre, ejecutable o paquete" /></label>{available.slice(0, 24).map((app) => <AppRow key={app.applicationId} app={app} detail={app.running ? "Abierta ahora" : app.appUserModelId ? "Microsoft Store / Windows" : "Instalada"} action={() => void onAdd(applicationToTracked(app))} actionLabel="Añadir" />)}{available.length === 0 && <div className="empty-line"><span>No hay más aplicaciones que coincidan con la búsqueda.</span></div>}<div className="manual-choice"><span>¿No aparece?</span><button className="text-link" disabled={busy} onClick={() => void onPick()}>Elegir .exe o .lnk…</button></div></div></section>;
}

function WorksetsSection({ worksets, tracked, onCreate, onRename, onMembers, onDelete }: { worksets: WorksetView[]; tracked: TrackedApplication[]; onCreate: (name: string, ids: string[]) => Promise<void>; onRename: (id: string, name: string) => Promise<void>; onMembers: (id: string, ids: string[]) => Promise<void>; onDelete: (id: string) => Promise<void> }) {
  const [creating, setCreating] = useState(false); const [newName, setNewName] = useState(""); const [newMembers, setNewMembers] = useState<Set<string>>(new Set()); const trackedMap = useMemo(() => new Map(tracked.map((a) => [a.applicationId, a])), [tracked]);
  const submit = async () => { if (!newName.trim()) return; await onCreate(newName, [...newMembers]); setNewName(""); setNewMembers(new Set()); setCreating(false); };
  return <section className="main-section"><div className="section-title-row"><div><h1>Entornos</h1><p>Agrupá aplicaciones que forman parte del mismo trabajo.</p></div><button className="button button-primary" onClick={() => setCreating(true)}>Crear entorno</button></div>{creating && <div className="workset-editor"><label><span>Nombre</span><input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Proyecto CoderCup" /></label><div className="member-picker">{tracked.map((app) => <label key={app.applicationId} className="member-option"><input type="checkbox" checked={newMembers.has(app.applicationId)} onChange={() => setNewMembers((current) => { const next = new Set(current); next.has(app.applicationId) ? next.delete(app.applicationId) : next.add(app.applicationId); return next; })} /><AppIcon app={app} size={28} /><span>{app.applicationName}</span></label>)}</div><div className="editor-actions"><button className="button button-secondary" onClick={() => setCreating(false)}>Cancelar</button><button className="button button-primary" onClick={() => void submit()}>Crear</button></div></div>}<div className="workset-list">{worksets.length === 0 && <div className="empty-line"><strong>Todavía no hay entornos.</strong><span>Agrupá las aplicaciones que forman parte del mismo trabajo.</span></div>}{worksets.map((workset) => <article className="workset-row" key={workset.id}><div className="workset-head"><div><strong>{workset.name}</strong><span className={`activity-label ${workset.active ? "active" : ""}`}>{workset.active ? "Activo" : "Esperando"}</span></div><button className="text-link danger-link" onClick={() => void onDelete(workset.id)}>Eliminar</button></div><div className="workset-members">{workset.applicationIds.map((id) => trackedMap.get(id)).filter(Boolean).map((app) => <span className="member-chip" key={app!.applicationId}><AppIcon app={app!} size={22} />{app!.applicationName}</span>)}</div><div className="workset-edit-grid"><label><span>Nombre</span><input defaultValue={workset.name} onBlur={(e) => { if (e.target.value.trim() && e.target.value.trim() !== workset.name) void onRename(workset.id, e.target.value); }} /></label><div className="member-picker">{tracked.map((app) => <label key={app.applicationId} className="member-option"><input type="checkbox" defaultChecked={workset.applicationIds.includes(app.applicationId)} onChange={(e) => { const next = new Set(workset.applicationIds); e.target.checked ? next.add(app.applicationId) : next.delete(app.applicationId); void onMembers(workset.id, [...next]); }} /><AppIcon app={app} size={26} /><span>{app.applicationName}</span></label>)}</div></div></article>)}</div></section>;
}

function HistorySection({ history, worksets }: { history: CheckpointRecord[]; worksets: WorksetView[] }) {
  const names = useMemo(() => new Map(worksets.map((w) => [w.id, w.name])), [worksets]);
  return <section className="main-section"><div className="section-title-row"><div><h1>Historial</h1><p>Checkpoints guardados en este equipo.</p></div></div><div className="history-list">{history.length === 0 && <div className="empty-line"><strong>Todavía no hay checkpoints.</strong></div>}{history.map((item) => <article className="history-entry" key={item.id}><div className="history-top"><div><strong>{item.worksetId ? names.get(item.worksetId) ?? "Entorno" : item.applicationName}</strong><span>{item.contextLabel}</span></div><div className="history-status"><time>{formatTime(item.createdAtMs)}</time><span className={item.resolvedAtMs ? "resolved" : "pending"}>{item.resolvedAtMs ? "Retomado" : "Pendiente"}</span></div></div>{item.text && <p>{item.text}</p>}<AudioPlayback checkpoint={item} />{item.transcript && <div className="transcript"><span>Transcripción</span><p>{item.transcript}</p></div>}</article>)}</div></section>;
}

function SettingsSection({ settings, onStartup, onPause }: { settings: SettingsView; onStartup: (enabled: boolean) => Promise<void>; onPause: (paused: boolean) => Promise<void> }) {
  return <section className="main-section settings-section"><div className="section-title-row"><div><h1>Ajustes</h1><p>Preferencias esenciales de SelfRelay.</p></div></div><div className="settings-list"><label className="setting-row"><div><strong>Iniciar SelfRelay con Windows</strong><span>Se inicia en segundo plano y queda disponible desde el tray.</span></div><input className="switch" type="checkbox" checked={settings.launchAtStartup} onChange={(e) => void onStartup(e.target.checked)} /></label><label className="setting-row"><div><strong>Seguimiento</strong><span>Pausar no borra checkpoints ni aplicaciones seleccionadas.</span></div><input className="switch" type="checkbox" checked={settings.trackingActive} onChange={(e) => void onPause(!e.target.checked)} /></label><div className="setting-row static"><div><strong>Privacidad</strong><span>Aplicaciones, checkpoints, audio y transcripciones permanecen locales.</span></div><span className="local-pill">Solo local</span></div><div className="setting-row static"><div><strong>Datos locales</strong><span className="path-text">{settings.dataDirectory}</span></div></div></div><div className="about-line"><Brand compact /><span>SelfRelay {settings.version}</span></div></section>;
}

function MainProduct() {
  const [discovered, setDiscovered] = useState<DiscoveredApplication[]>([]); const [tracked, setTracked] = useState<TrackedApplication[]>([]); const [worksets, setWorksets] = useState<WorksetView[]>([]); const [history, setHistory] = useState<CheckpointRecord[]>([]); const [settings, setSettings] = useState<SettingsView | null>(null); const [onboarding, setOnboarding] = useState<boolean | null>(null); const [section, setSection] = useState<MainSection>("apps"); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => { try { const [apps, selected, sets, checkpoints, nextSettings, completed] = await Promise.all([invoke<DiscoveredApplication[]>("get_discovered_applications"), invoke<TrackedApplication[]>("get_tracked_applications"), invoke<WorksetView[]>("get_worksets"), invoke<CheckpointRecord[]>("get_checkpoint_history"), invoke<SettingsView>("get_settings"), invoke<boolean>("get_onboarding_completed")]); setDiscovered(apps); setTracked(selected); setWorksets(sets); setHistory(checkpoints); setSettings(nextSettings); setOnboarding(completed); setError(null); } catch (cause) { setError(String(cause)); } }, []);
  useEffect(() => { void refresh(); const unlisten = listen("desktop://state-changed", () => void refresh()); return () => { void unlisten.then((stop) => stop()); }; }, [refresh]);
  const run = async (operation: () => Promise<unknown>) => { setBusy(true); try { await operation(); await refresh(); setError(null); } catch (cause) { setError(String(cause)); } finally { setBusy(false); } };
  const pick = async () => invoke<TrackedApplication | null>("pick_application_executable"); const pickAndAdd = async () => { const app = await pick(); if (app) await run(() => invoke("set_application_tracking", { application: app, enabled: true })); };
  if (onboarding === null || !settings) return <main className="boot-page"><Brand /><span>Preparando tu entorno…</span></main>;
  if (!onboarding) return <Onboarding discovered={discovered} initialTracked={tracked} busy={busy} onPick={pick} onComplete={async (apps) => run(() => invoke("complete_onboarding", { applications: apps }))} />;
  const label = (item: MainSection) => item === "apps" ? "Aplicaciones" : item === "worksets" ? "Entornos" : item === "history" ? "Historial" : "Ajustes";
  return <main className="app-shell"><header className="app-header"><Brand /><nav className="nav-tabs">{(["apps", "worksets", "history", "settings"] as MainSection[]).map((item) => <button key={item} className={section === item ? "active" : ""} onClick={() => setSection(item)}>{label(item)}</button>)}</nav><span className={`tracking-pill ${settings.trackingActive ? "active" : "paused"}`}><span />{settings.trackingActive ? "Activo" : "Pausado"}</span></header>{section === "apps" && <ApplicationsSection discovered={discovered} tracked={tracked} busy={busy} onAdd={async (app) => run(() => invoke("set_application_tracking", { application: app, enabled: true }))} onRemove={async (app) => run(() => invoke("set_application_tracking", { application: app, enabled: false }))} onPick={pickAndAdd} onManualCheckpoint={async () => run(() => invoke("save_checkpoint_now"))} />}{section === "worksets" && <WorksetsSection worksets={worksets} tracked={tracked} onCreate={async (name, ids) => run(() => invoke("create_workset", { name, applicationIds: ids }))} onRename={async (id, name) => run(() => invoke("rename_workset", { id, name }))} onMembers={async (id, ids) => run(() => invoke("set_workset_applications", { id, applicationIds: ids }))} onDelete={async (id) => run(() => invoke("delete_workset", { id }))} />}{section === "history" && <HistorySection history={history} worksets={worksets} />}{section === "settings" && <SettingsSection settings={settings} onStartup={async (enabled) => run(() => invoke("set_launch_at_startup", { enabled }))} onPause={async (paused) => run(() => invoke("set_tracking_paused", { paused }))} />}{error && <div className="global-notice"><Notice error>{error}</Notice></div>}</main>;
}

function CaptureSurface({ qaCapture }: { qaCapture?: CaptureView }) {
  const [capture, setCapture] = useState<CaptureView | null>(qaCapture ?? null); const [text, setText] = useState(""); const [target, setTarget] = useState(""); const [recording, setRecording] = useState(false); const [audioBytes, setAudioBytes] = useState<Uint8Array | null>(null); const [audioUrl, setAudioUrl] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null); const streamRef = useRef<MediaStream | null>(null); const chunksRef = useRef<Blob[]>([]); const stopPromiseRef = useRef<Promise<Uint8Array> | null>(null);
  const refresh = useCallback(async () => { if (qaCapture) return; try { setCapture(await invoke<CaptureView | null>("get_pending_capture")); } catch (cause) { setError(String(cause)); } }, [qaCapture]);
  useEffect(() => { void refresh(); if (qaCapture) return; const unlisten = listen("desktop://state-changed", () => void refresh()); return () => { void unlisten.then((stop) => stop()); }; }, [qaCapture, refresh]);
  useEffect(() => { setText(""); setTarget(""); setAudioBytes(null); if (audioUrl) URL.revokeObjectURL(audioUrl); setAudioUrl(null); }, [capture?.id]);
  useEffect(() => () => { streamRef.current?.getTracks().forEach((track) => track.stop()); if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);
  const clearAudioUrl = () => { if (audioUrl) URL.revokeObjectURL(audioUrl); setAudioUrl(null); };
  const startRecording = async () => { try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); const recorder = new MediaRecorder(stream); streamRef.current = stream; recorderRef.current = recorder; chunksRef.current = []; setAudioBytes(null); clearAudioUrl(); recorder.ondataavailable = (event) => { if (event.data.size > 0) chunksRef.current.push(event.data); }; recorder.start(); setRecording(true); setError(null); } catch { setError("SelfRelay no pudo usar el micrófono. Podés seguir guardando el checkpoint con texto."); } };
  const stopRecording = async () => { if (stopPromiseRef.current) return stopPromiseRef.current; const recorder = recorderRef.current; if (!recorder || recorder.state === "inactive") return audioBytes ?? new Uint8Array(); const promise = new Promise<Uint8Array>((resolve, reject) => { recorder.addEventListener("stop", async () => { try { const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" }); const wav = await mediaBlobToWav(blob); setAudioBytes(wav); clearAudioUrl(); setAudioUrl(URL.createObjectURL(new Blob([wav], { type: "audio/wav" }))); resolve(wav); } catch (cause) { reject(cause); } finally { streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; recorderRef.current = null; stopPromiseRef.current = null; setRecording(false); } }, { once: true }); recorder.stop(); }); stopPromiseRef.current = promise; return promise; };
  const save = async () => { if (qaCapture || !capture) return; setBusy(true); try { let finalAudio = audioBytes; if (recording) finalAudio = await stopRecording(); await invoke("save_checkpoint", { captureId: capture.id, text, worksetId: target || null, audioBytes: finalAudio?.length ? Array.from(finalAudio) : null }); await refresh(); setError(null); } catch (cause) { setError(String(cause)); } finally { setBusy(false); } };
  const discard = async () => { if (!capture) return; if (recording) { try { await stopRecording(); } catch { /* explicit discard still wins */ } } if (!qaCapture) { await invoke("dismiss_capture", { captureId: capture.id }); await refresh(); } };
  // Backend also hides this window when no durable ID exists. Never display a misleading empty-capture state.
  if (!capture) return null;
  return <main className="surface-shell capture-surface"><Brand compact /><div className="surface-heading"><div className="capture-app"><AppIcon app={{ applicationId: capture.applicationId, applicationName: capture.applicationName }} size={34} /><span>{capture.applicationName}</span></div><h1>¿Dónde quedaste?</h1>{capture.contextLabel !== capture.applicationName && <p>{capture.contextLabel}</p>}</div><textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Dejá lo mínimo que necesitás para retomar después…" autoFocus /><div className="voice-box">{!recording && !audioBytes && <button className="button button-secondary mic-button" onClick={() => void startRecording()}><span>●</span> Grabar nota de voz</button>}{recording && <div className="recording-row"><span className="recording-dot" /><strong>Grabando…</strong><button className="text-link" onClick={() => void stopRecording()}>Detener</button></div>}{!recording && audioBytes && <div className="audio-preview"><audio controls src={audioUrl ?? undefined} /><button className="text-link" onClick={() => { setAudioBytes(null); clearAudioUrl(); }}>Descartar audio</button></div>}</div>{capture.worksets.length > 0 && <fieldset className="target-choice"><legend>Guardar para</legend><label><input type="radio" checked={!target} onChange={() => setTarget("")} /> Esta aplicación</label>{capture.worksets.map((w) => <label key={w.id}><input type="radio" checked={target === w.id} onChange={() => setTarget(w.id)} /> {w.name}</label>)}</fieldset>}{error && <Notice error>{error}</Notice>}<div className="surface-actions"><button className="button button-secondary" disabled={busy} onClick={() => void discard()}>No guardar</button><button className="button button-primary" disabled={busy} onClick={() => void save()}>{recording ? "Guardar y detener" : "Guardar checkpoint"}</button></div></main>;
}

function RecoveryCheckpoint({ item, onResolve, qa = false }: { item: CheckpointRecord; onResolve: (id: number) => Promise<void>; qa?: boolean }) {
  const [transcript, setTranscript] = useState(item.transcript ?? null); const [transcribing, setTranscribing] = useState(false); const [error, setError] = useState<string | null>(null);
  const transcribe = async () => { if (qa) { setTranscript("Revisar la introducción y cerrar con el ejemplo final."); return; } setTranscribing(true); try { setTranscript(await invoke<string>("transcribe_checkpoint", { id: item.id })); setError(null); } catch (cause) { setError(String(cause)); } finally { setTranscribing(false); } };
  return <article className="recovery-item"><time>{formatTime(item.createdAtMs)}</time>{item.text && <p className="recovery-note">“{item.text}”</p>}<AudioPlayback checkpoint={item} />{item.audioPath && !transcript && <button className="text-link transcribe-link" disabled={transcribing} onClick={() => void transcribe()}>{transcribing ? "Transcribiendo localmente…" : "Transcribir audio"}</button>}{transcript && <div className="transcript"><span>Transcripción</span><p>{transcript}</p></div>}{error && <div className="retry-line"><span>{error}</span><button className="text-link" onClick={() => void transcribe()}>Reintentar</button></div>}<button className="button button-secondary resolved-button" onClick={() => void onResolve(item.id)}>Ya retomé</button></article>;
}

function RecoverySurface({ qaRecovery }: { qaRecovery?: RecoveryView }) {
  const [recovery, setRecovery] = useState<RecoveryView | null>(qaRecovery ?? null); const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => { if (qaRecovery) return; try { setRecovery(await invoke<RecoveryView | null>("get_active_recovery")); } catch (cause) { setError(String(cause)); } }, [qaRecovery]);
  useEffect(() => { void refresh(); if (qaRecovery) return; const unlisten = listen("desktop://state-changed", () => void refresh()); return () => { void unlisten.then((stop) => stop()); }; }, [qaRecovery, refresh]);
  const resolve = async (id: number) => { if (qaRecovery) { setRecovery((current) => current ? { ...current, checkpoints: current.checkpoints.filter((item) => item.id !== id) } : null); return; } await invoke("resolve_checkpoint", { id }); await refresh(); };
  const defer = async () => { if (!qaRecovery) await invoke("defer_recovery"); };
  if (!recovery) return null;
  return <main className="surface-shell recovery-surface"><Brand compact /><div className="surface-heading"><p className="return-label">Volviste a</p><h1>{recovery.targetName}</h1><p>{recovery.checkpoints.length} {recovery.checkpoints.length === 1 ? "checkpoint pendiente" : "checkpoints pendientes"}</p>{recovery.targetKind === "context" && recovery.contextLabel !== recovery.applicationName && <p>{recovery.contextLabel}</p>}</div><div className="recovery-list">{recovery.checkpoints.map((item) => <RecoveryCheckpoint key={item.id} item={item} onResolve={resolve} qa={Boolean(qaRecovery)} />)}</div>{error && <Notice error>{error}</Notice>}<div className="recovery-footer"><button className="button button-secondary" onClick={() => void defer()}>Lo veo después</button></div></main>;
}

const qaApps: DiscoveredApplication[] = [
  ["app:notepad.exe", "Notepad", "notepad.exe"], ["app:mspaint.exe", "Paint", "mspaint.exe"], ["app:winword.exe", "Microsoft Word", "winword.exe"], ["app:excel.exe", "Microsoft Excel", "excel.exe"], ["aumid:spotify", "Spotify", null], ["app:discord.exe", "Discord", "discord.exe"],
].map(([applicationId, applicationName, executableName], index) => ({ applicationId: String(applicationId), applicationName: String(applicationName), executablePath: null, executableName: executableName ? String(executableName) : null, aliases: [String(applicationName)], packageFamilyName: index === 4 ? "SpotifyAB.SpotifyMusic_xyz" : null, appUserModelId: index === 4 ? "SpotifyAB.SpotifyMusic_xyz!Spotify" : null, running: index === 0 || index === 4, foreground: index === 0 }));
const qaTracked = qaApps.slice(0, 3).map(applicationToTracked);
const qaWorksets: WorksetView[] = [{ id: "ws:coder", name: "Proyecto CoderCup", applicationIds: qaTracked.map((a) => a.applicationId), active: true }];
const qaHistory: CheckpointRecord[] = [{ id: 1, applicationId: qaApps[0]!.applicationId, applicationName: "Notepad", contextId: qaApps[0]!.applicationId, contextLabel: "Notepad", text: "Terminar la introducción.", createdAtMs: Date.now() - 86_400_000, resolvedAtMs: null }, { id: 2, applicationId: qaApps[0]!.applicationId, applicationName: "Notepad", contextId: qaApps[0]!.applicationId, contextLabel: "Notepad", text: "Revisar el ejemplo final.", audioPath: "qa.wav", createdAtMs: Date.now() - 3_600_000, resolvedAtMs: null }];

function QaPreview({ state }: { state: string }) {
  if (state === "onboarding") return <Onboarding discovered={qaApps} initialTracked={[]} busy={false} onPick={async () => null} onComplete={async () => undefined} />;
  if (state === "capture") return <CaptureSurface qaCapture={{ id: "qa-capture-1", applicationId: qaApps[0]!.applicationId, applicationName: "Notepad", contextId: qaApps[0]!.applicationId, contextLabel: "Notepad", createdAtMs: Date.now(), worksets: [{ id: "ws:coder", name: "Proyecto CoderCup" }] }} />;
  if (state === "recovery") return <RecoverySurface qaRecovery={{ targetKind: "context", targetName: "Notepad", applicationId: qaApps[0]!.applicationId, applicationName: "Notepad", contextId: qaApps[0]!.applicationId, contextLabel: "Notepad", checkpoints: qaHistory }} />;
  const section: MainSection = state === "worksets" ? "worksets" : state === "history" ? "history" : state === "settings" ? "settings" : "apps";
  const settings: SettingsView = { launchAtStartup: true, trackingActive: true, version: PRODUCT_VERSION, dataDirectory: "C:\\Users\\Demo\\AppData\\Local\\SelfRelay" };
  return <main className="app-shell"><header className="app-header"><Brand /><nav className="nav-tabs"><button className={section === "apps" ? "active" : ""}>Aplicaciones</button><button className={section === "worksets" ? "active" : ""}>Entornos</button><button className={section === "history" ? "active" : ""}>Historial</button><button className={section === "settings" ? "active" : ""}>Ajustes</button></nav><span className="tracking-pill active"><span />Activo</span></header>{section === "apps" && <ApplicationsSection discovered={qaApps} tracked={qaTracked} busy={false} onAdd={async () => undefined} onRemove={async () => undefined} onPick={async () => undefined} onManualCheckpoint={async () => undefined} />}{section === "worksets" && <WorksetsSection worksets={qaWorksets} tracked={qaTracked} onCreate={async () => undefined} onRename={async () => undefined} onMembers={async () => undefined} onDelete={async () => undefined} />}{section === "history" && <HistorySection history={qaHistory} worksets={qaWorksets} />}{section === "settings" && <SettingsSection settings={settings} onStartup={async () => undefined} onPause={async () => undefined} />}</main>;
}

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const qa = params.get("qa"); if (qa) return <QaPreview state={qa} />;
  const surface = params.get("surface"); if (surface === "capture") return <CaptureSurface />; if (surface === "recovery") return <RecoverySurface />;
  return <MainProduct />;
}
