import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import logoUrl from "../../../assets/branding/selfrelay-logo.png";
import type { CaptureView, CheckpointRecord, RecoveryView } from "./types";

type SurfaceLoad<T> =
  | { phase: "loading" }
  | { phase: "ready"; value: T }
  | { phase: "error"; message: string };

function Brand() {
  return <div className="brand brand-compact"><span className="brand-mark"><img src={logoUrl} alt="" /></span><span>SelfRelay</span></div>;
}

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="notice notice-error">{children}</div>;
}

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

function scheduleAfterPaint(callback: () => void) {
  requestAnimationFrame(() => requestAnimationFrame(callback));
}

function SurfaceLoading({ label }: { label: string }) {
  return <main className="surface-shell"><Brand /><div className="surface-heading"><h1>{label}</h1><p>Preparando el contexto guardado…</p></div></main>;
}

function SurfaceError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <main className="surface-shell"><Brand /><div className="surface-heading"><h1>No pudimos preparar esta ventana.</h1><p>Tu checkpoint sigue guardado en este equipo.</p></div><Notice>{message}</Notice><div className="surface-actions"><button className="button button-primary" onClick={onRetry}>Reintentar</button></div></main>;
}

function useRetryingSurface<T>(surface: "capture" | "recovery", command: string) {
  const [state, setState] = useState<SurfaceLoad<T>>({ phase: "loading" });
  const attemptRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const clearTimer = () => { if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null; } };
  const report = useCallback((detail: string) => {
    void invoke("report_surface_error", { surface, detail }).catch(() => undefined);
  }, [surface]);

  const refresh = useCallback(async () => {
    clearTimer();
    if (!mountedRef.current) return;
    setState((current) => current.phase === "ready" ? current : { phase: "loading" });
    try {
      const value = await invoke<T | null>(command);
      if (!mountedRef.current) return;
      if (value) {
        attemptRef.current = 0;
        setState({ phase: "ready", value });
        return;
      }
      const attempt = attemptRef.current += 1;
      if (attempt <= 8) {
        timerRef.current = window.setTimeout(() => void refresh(), Math.min(2000, 200 * 2 ** Math.min(attempt, 4)));
      } else {
        const message = "El backend todavía no entregó un estado durable para esta superficie.";
        setState({ phase: "error", message });
        report(message);
      }
    } catch (cause) {
      if (!mountedRef.current) return;
      const message = String(cause);
      const attempt = attemptRef.current += 1;
      report(`${command} failed: ${message}`);
      if (attempt <= 8) {
        setState({ phase: "loading" });
        timerRef.current = window.setTimeout(() => void refresh(), Math.min(2000, 250 * 2 ** Math.min(attempt, 4)));
      } else {
        setState({ phase: "error", message });
      }
    }
  }, [command, report]);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const unlisten = listen("desktop://state-changed", () => void refresh());
    return () => {
      mountedRef.current = false;
      clearTimer();
      void unlisten.then((stop) => stop());
    };
  }, [refresh]);

  return { state, retry: () => { attemptRef.current = 0; void refresh(); } };
}

export function CaptureRuntimeSurface() {
  const { state, retry } = useRetryingSurface<CaptureView>("capture", "get_pending_capture");
  const capture = state.phase === "ready" ? state.value : null;
  const [text, setText] = useState("");
  const [target, setTarget] = useState("");
  const [recording, setRecording] = useState(false);
  const [audioBytes, setAudioBytes] = useState<Uint8Array | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopPromiseRef = useRef<Promise<Uint8Array> | null>(null);

  useEffect(() => {
    if (!capture) return;
    setText(""); setTarget(""); setAudioBytes(null); setError(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    scheduleAfterPaint(() => {
      void invoke("capture_surface_ready", { captureId: capture.id }).catch((cause) => {
        const message = String(cause);
        setError(message);
        void invoke("report_surface_error", { surface: "capture", detail: `ready failed: ${message}` }).catch(() => undefined);
      });
    });
    // The ID is the durable binding. State changes that keep the same ID do not reset the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capture?.id]);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  }, [audioUrl]);

  const clearAudioUrl = () => { if (audioUrl) URL.revokeObjectURL(audioUrl); setAudioUrl(null); };
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      streamRef.current = stream; recorderRef.current = recorder; chunksRef.current = [];
      setAudioBytes(null); clearAudioUrl();
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunksRef.current.push(event.data); };
      recorder.start(); setRecording(true); setError(null);
    } catch {
      setError("SelfRelay no pudo usar el micrófono. Podés seguir guardando el checkpoint con texto.");
    }
  };
  const stopRecording = async () => {
    if (stopPromiseRef.current) return stopPromiseRef.current;
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return audioBytes ?? new Uint8Array();
    const promise = new Promise<Uint8Array>((resolve, reject) => {
      recorder.addEventListener("stop", async () => {
        try {
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
          const wav = await mediaBlobToWav(blob);
          setAudioBytes(wav); clearAudioUrl(); setAudioUrl(URL.createObjectURL(new Blob([wav], { type: "audio/wav" }))); resolve(wav);
        } catch (cause) { reject(cause); }
        finally {
          streamRef.current?.getTracks().forEach((track) => track.stop());
          streamRef.current = null; recorderRef.current = null; stopPromiseRef.current = null; setRecording(false);
        }
      }, { once: true });
      recorder.stop();
    });
    stopPromiseRef.current = promise;
    return promise;
  };

  const save = async () => {
    if (!capture) return;
    setBusy(true);
    try {
      let finalAudio = audioBytes;
      if (recording) finalAudio = await stopRecording();
      await invoke("save_checkpoint", {
        captureId: capture.id,
        text,
        worksetId: target || null,
        audioBytes: finalAudio?.length ? Array.from(finalAudio) : null,
      });
      setError(null);
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  };

  const discard = async () => {
    if (!capture) return;
    if (recording) { try { await stopRecording(); } catch { /* explicit discard still wins */ } }
    try { await invoke("dismiss_capture", { captureId: capture.id }); }
    catch (cause) { setError(String(cause)); }
  };

  if (state.phase === "loading") return <SurfaceLoading label="Preparando checkpoint" />;
  if (state.phase === "error") return <SurfaceError message={state.message} onRetry={retry} />;

  return <main className="surface-shell capture-surface"><Brand /><div className="surface-heading"><div className="capture-app"><span className="native-app-icon" style={{ width: 34, height: 34 }} aria-hidden="true"><span className="icon-fallback"><span /></span></span><span>{state.value.applicationName}</span></div><h1>¿Dónde quedaste?</h1>{state.value.contextLabel !== state.value.applicationName && <p>{state.value.contextLabel}</p>}</div><textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Dejá lo mínimo que necesitás para retomar después…" autoFocus /><div className="voice-box">{!recording && !audioBytes && <button className="button button-secondary mic-button" onClick={() => void startRecording()}><span>●</span> Grabar nota de voz</button>}{recording && <div className="recording-row"><span className="recording-dot" /><strong>Grabando…</strong><button className="text-link" onClick={() => void stopRecording()}>Detener</button></div>}{!recording && audioBytes && <div className="audio-preview"><audio controls src={audioUrl ?? undefined} /><button className="text-link" onClick={() => { setAudioBytes(null); clearAudioUrl(); }}>Descartar audio</button></div>}</div>{state.value.worksets.length > 0 && <fieldset className="target-choice"><legend>Guardar para</legend><label><input type="radio" checked={!target} onChange={() => setTarget("")} /> Esta aplicación</label>{state.value.worksets.map((workset) => <label key={workset.id}><input type="radio" checked={target === workset.id} onChange={() => setTarget(workset.id)} /> {workset.name}</label>)}</fieldset>}{error && <Notice>{error}</Notice>}<div className="surface-actions"><button className="button button-secondary" disabled={busy} onClick={() => void discard()}>No guardar</button><button className="button button-primary" disabled={busy} onClick={() => void save()}>{recording ? "Guardar y detener" : "Guardar checkpoint"}</button></div></main>;
}

function RecoveryAudio({ checkpoint }: { checkpoint: CheckpointRecord }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  if (!checkpoint.audioPath) return null;
  const load = async () => {
    setBusy(true);
    try {
      const bytes = await invoke<number[]>("get_checkpoint_audio", { id: checkpoint.id });
      const next = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "audio/wav" }));
      if (url) URL.revokeObjectURL(url); setUrl(next); setError(null);
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  };
  return <div className="checkpoint-audio">{url ? <audio controls src={url} /> : <button className="text-link" disabled={busy} onClick={() => void load()}>{busy ? "Cargando audio…" : "Escuchar audio"}</button>}{error && <small className="inline-error">{error}</small>}</div>;
}

function RuntimeRecoveryCheckpoint({ item, onResolve }: { item: CheckpointRecord; onResolve: (id: number) => Promise<void> }) {
  const [transcript, setTranscript] = useState(item.transcript ?? null);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const transcribe = async () => {
    setTranscribing(true);
    try { setTranscript(await invoke<string>("transcribe_checkpoint", { id: item.id })); setError(null); }
    catch (cause) { setError(String(cause)); }
    finally { setTranscribing(false); }
  };
  return <article className="recovery-item"><time>{formatTime(item.createdAtMs)}</time>{item.text && <p className="recovery-note">“{item.text}”</p>}<RecoveryAudio checkpoint={item} />{item.audioPath && !transcript && <button className="text-link transcribe-link" disabled={transcribing} onClick={() => void transcribe()}>{transcribing ? "Transcribiendo localmente…" : "Transcribir audio"}</button>}{transcript && <div className="transcript"><span>Transcripción</span><p>{transcript}</p></div>}{error && <div className="retry-line"><span>{error}</span><button className="text-link" onClick={() => void transcribe()}>Reintentar</button></div>}<button className="button button-secondary resolved-button" onClick={() => void onResolve(item.id)}>Ya retomé</button></article>;
}

export function RecoveryRuntimeSurface() {
  const { state, retry } = useRetryingSurface<RecoveryView>("recovery", "get_active_recovery");
  const recovery = state.phase === "ready" ? state.value : null;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!recovery) return;
    const token = recovery.readyToken;
    if (!token) {
      const message = "La recuperación no recibió un token de binding válido.";
      setError(message);
      void invoke("report_surface_error", { surface: "recovery", detail: message }).catch(() => undefined);
      return;
    }
    const checkpointIds = recovery.checkpoints.map((item) => item.id);
    scheduleAfterPaint(() => {
      void invoke("recovery_surface_ready", { readyToken: token, checkpointIds }).catch((cause) => {
        const message = String(cause);
        setError(message);
        void invoke("report_surface_error", { surface: "recovery", detail: `ready failed: ${message}` }).catch(() => undefined);
      });
    });
  }, [recovery?.readyToken, recovery?.checkpoints.map((item) => item.id).join(",")]);

  const resolve = async (id: number) => {
    try { await invoke("resolve_checkpoint", { id }); setError(null); }
    catch (cause) { setError(String(cause)); }
  };
  const defer = async () => {
    try { await invoke("defer_recovery"); setError(null); }
    catch (cause) { setError(String(cause)); }
  };

  if (state.phase === "loading") return <SurfaceLoading label="Preparando recuperación" />;
  if (state.phase === "error") return <SurfaceError message={state.message} onRetry={retry} />;

  return <main className="surface-shell recovery-surface"><Brand /><div className="surface-heading"><p className="return-label">Volviste a</p><h1>{state.value.targetName}</h1><p>{state.value.checkpoints.length} {state.value.checkpoints.length === 1 ? "checkpoint pendiente" : "checkpoints pendientes"}</p>{state.value.targetKind === "context" && state.value.contextLabel !== state.value.applicationName && <p>{state.value.contextLabel}</p>}</div><div className="recovery-list">{state.value.checkpoints.map((item) => <RuntimeRecoveryCheckpoint key={item.id} item={item} onResolve={resolve} />)}</div>{error && <Notice>{error}</Notice>}<div className="recovery-footer"><button className="button button-secondary" onClick={() => void defer()}>Lo veo después</button></div></main>;
}
