use std::{fs, path::{Path, PathBuf}, process::Command};

pub fn transcribe(audio_path: &Path, resource_dir: &Path, work_dir: &Path) -> Result<String, String> {
    if !audio_path.is_file() {
        return Err("El audio original ya no está disponible.".into());
    }
    let whisper_dir = resource_dir.join("resources").join("whisper");
    let cli = whisper_dir.join(executable_name());
    let model = whisper_dir.join("ggml-base-q5_1.bin");
    if !cli.is_file() || !model.is_file() {
        return Err("El motor local de transcripción no está disponible en esta instalación.".into());
    }
    fs::create_dir_all(work_dir).map_err(|error| error.to_string())?;
    let output_base = work_dir.join(format!("transcript-{}", unique_suffix()));

    let mut command = Command::new(&cli);
    command
        .arg("-m")
        .arg(&model)
        .arg("-f")
        .arg(audio_path)
        .arg("-l")
        .arg("auto")
        .arg("-otxt")
        .arg("-of")
        .arg(&output_base)
        .arg("-nt")
        .arg("-np");

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: whisper is a console executable internally, but the
        // user must never see a console host while SelfRelay invokes it.
        command.creation_flags(0x0800_0000);
    }

    let output = command.output().map_err(|error| format!("No se pudo iniciar Whisper local: {error}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "Whisper local no pudo transcribir este audio. {}",
            detail.lines().last().unwrap_or("")
        ).trim().to_string());
    }
    let txt_path = with_txt_extension(&output_base);
    let text = fs::read_to_string(&txt_path)
        .map_err(|error| format!("Whisper terminó sin producir una transcripción: {error}"))?
        .trim()
        .to_string();
    let _ = fs::remove_file(txt_path);
    if text.is_empty() {
        return Err("Whisper no detectó voz suficiente para transcribir.".into());
    }
    Ok(text)
}

fn with_txt_extension(base: &Path) -> PathBuf {
    PathBuf::from(format!("{}.txt", base.display()))
}

fn unique_suffix() -> u128 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default()
}

#[cfg(windows)]
fn executable_name() -> &'static str { "whisper-cli.exe" }
#[cfg(not(windows))]
fn executable_name() -> &'static str { "whisper-cli" }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transcript_output_path_is_sidecar_txt() {
        assert_eq!(with_txt_extension(Path::new("C:/tmp/demo")).to_string_lossy(), "C:/tmp/demo.txt");
    }

    #[test]
    fn missing_audio_fails_before_sidecar_launch() {
        let error = transcribe(
            Path::new("definitely-missing.wav"),
            Path::new("missing-resources"),
            Path::new("missing-work"),
        ).unwrap_err();
        assert!(error.contains("audio original"));
    }
}
