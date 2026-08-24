use hound::{SampleFormat, WavReader};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
};
use whisper_rs::{
    convert_integer_to_float_audio, FullParams, SamplingStrategy, WhisperContext,
    WhisperContextParameters,
};

// Keep transcription deliberately conservative. SelfRelay is a background
// productivity tool; local speech recognition must never monopolize the PC.
const WHISPER_THREAD_LIMIT: i32 = 1;
static TRANSCRIPTION_GATE: OnceLock<Mutex<()>> = OnceLock::new();
static MODEL_CACHE: OnceLock<Mutex<Option<(PathBuf, Arc<WhisperContext>)>>> = OnceLock::new();

pub fn transcribe(audio_path: &Path, resource_dir: &Path, _work_dir: &Path) -> Result<String, String> {
    if !audio_path.is_file() {
        return Err("El audio original ya no está disponible.".into());
    }

    let model = resource_dir
        .join("resources")
        .join("whisper")
        .join("ggml-base-q5_1.bin");
    if !model.is_file() {
        return Err("El modelo local de transcripción no está disponible en esta instalación.".into());
    }

    // Never run two Whisper jobs at once. Each state owns sizeable compute
    // buffers, so concurrent jobs can otherwise force low-memory Windows PCs
    // into paging and make the whole desktop appear frozen.
    let _transcription_guard = TRANSCRIPTION_GATE
        .get_or_init(|| Mutex::new(()))
        .try_lock()
        .map_err(|_| "Ya hay una transcripción local en curso. Esperá a que termine antes de iniciar otra.".to_string())?;

    let mut reader = WavReader::open(audio_path)
        .map_err(|error| format!("No se pudo leer la nota de voz: {error}"))?;
    let spec = reader.spec();
    if spec.channels != 1
        || spec.sample_rate != 16_000
        || spec.bits_per_sample != 16
        || spec.sample_format != SampleFormat::Int
    {
        return Err("La nota de voz no tiene el formato PCM mono de 16 kHz esperado por SelfRelay.".into());
    }

    let samples = reader
        .samples::<i16>()
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("La nota de voz está dañada o incompleta: {error}"))?;
    if samples.is_empty() {
        return Err("La nota de voz está vacía.".into());
    }

    let mut pcm = vec![0.0f32; samples.len()];
    convert_integer_to_float_audio(&samples, &mut pcm)
        .map_err(|error| format!("No se pudo preparar el audio para Whisper: {error}"))?;

    // Whisper is linked directly into SelfRelay. There is deliberately no
    // whisper-cli.exe, cmd.exe, PowerShell or other child process involved.
    // Cache the immutable model context after the first use so repeated notes
    // do not reread the model from disk every time.
    let context = {
        let cache = MODEL_CACHE.get_or_init(|| Mutex::new(None));
        let mut cache = cache
            .lock()
            .map_err(|_| "No se pudo acceder al modelo local de transcripción.".to_string())?;
        if let Some((cached_path, cached_context)) = cache.as_ref() {
            if cached_path == &model {
                Arc::clone(cached_context)
            } else {
                let loaded = Arc::new(
                    WhisperContext::new_with_params(&model, WhisperContextParameters::default())
                        .map_err(|error| format!("No se pudo cargar Whisper local: {error}"))?,
                );
                *cache = Some((model.clone(), Arc::clone(&loaded)));
                loaded
            }
        } else {
            let loaded = Arc::new(
                WhisperContext::new_with_params(&model, WhisperContextParameters::default())
                    .map_err(|error| format!("No se pudo cargar Whisper local: {error}"))?,
            );
            *cache = Some((model.clone(), Arc::clone(&loaded)));
            loaded
        }
    };

    let mut state = context
        .create_state()
        .map_err(|error| format!("No se pudo iniciar Whisper local: {error}"))?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    // A single decoder thread keeps transcription responsive on modest PCs;
    // the Tauri command already runs this blocking work off the UI thread.
    params.set_n_threads(WHISPER_THREAD_LIMIT);
    params.set_no_context(true);
    // language=None requests automatic language selection while still running
    // the full transcription pipeline. Do not enable detect_language: upstream
    // whisper.cpp treats that flag as detection-only and returns before text
    // segments are produced.
    params.set_language(None);
    params.set_translate(false);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_no_timestamps(true);

    state
        .full(params, &pcm)
        .map_err(|error| format!("Whisper local no pudo transcribir este audio: {error}"))?;

    let text = state
        .as_iter()
        .filter_map(|segment| segment.to_str_lossy().ok().map(|text| text.into_owned()))
        .collect::<Vec<_>>()
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    if text.is_empty() {
        return Err("Whisper no detectó voz suficiente para transcribir.".into());
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{env, path::PathBuf};

    #[test]
    fn transcription_is_resource_bounded() {
        assert_eq!(WHISPER_THREAD_LIMIT, 1);
    }

    #[test]
    fn missing_audio_fails_before_model_load() {
        let error = transcribe(
            Path::new("definitely-missing.wav"),
            Path::new("missing-resources"),
            Path::new("missing-work"),
        )
        .unwrap_err();
        assert!(error.contains("audio original"));
    }

    #[test]
    #[ignore = "requires the packaged Whisper model and Spanish QA sample"]
    fn real_spanish_sample_uses_in_process_whisper() {
        let resource_dir = PathBuf::from(env::var("SELFRELAY_RESOURCE_DIR").unwrap());
        let sample = PathBuf::from(env::var("SELFRELAY_WHISPER_SAMPLE").unwrap());
        let transcript = transcribe(&sample, &resource_dir, Path::new("unused")).unwrap();
        let lower = transcript.to_lowercase();
        let score = ["hola", "prueba", "sistema", "reconocimiento"]
            .iter()
            .filter(|token| lower.contains(**token))
            .count();
        assert!(score >= 3, "Spanish Whisper quality gate failed ({score}/4): {transcript}");
    }
}
