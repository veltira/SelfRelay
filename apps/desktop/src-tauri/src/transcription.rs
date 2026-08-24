use hound::{SampleFormat, WavReader};
use std::path::Path;
use whisper_rs::{
    convert_integer_to_float_audio, FullParams, SamplingStrategy, WhisperContext,
    WhisperContextParameters,
};

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
    let model_path = model.to_string_lossy();
    let context = WhisperContext::new_with_params(
        model_path.as_ref(),
        WhisperContextParameters::default(),
    )
    .map_err(|error| format!("No se pudo cargar Whisper local: {error}"))?;
    let mut state = context
        .create_state()
        .map_err(|error| format!("No se pudo iniciar Whisper local: {error}"))?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
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
