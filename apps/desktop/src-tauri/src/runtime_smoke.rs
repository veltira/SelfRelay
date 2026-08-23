use std::{
    fs,
    path::PathBuf,
    sync::{Mutex, OnceLock},
};

#[derive(Debug, Clone)]
struct SmokeState {
    report_dir: PathBuf,
    expected_capture_id: String,
    expected_recovery_token: String,
    expected_checkpoint_ids: Vec<i64>,
    capture_ready: bool,
    recovery_ready: bool,
}

static STATE: OnceLock<Mutex<Option<SmokeState>>> = OnceLock::new();

fn state() -> &'static Mutex<Option<SmokeState>> {
    STATE.get_or_init(|| Mutex::new(None))
}

pub fn dir_from_args() -> Option<PathBuf> {
    let arguments = std::env::args().collect::<Vec<_>>();
    arguments
        .windows(2)
        .find(|pair| pair[0] == "--selfrelay-webview-smoke-dir")
        .map(|pair| PathBuf::from(&pair[1]))
}

pub fn configure(
    report_dir: PathBuf,
    expected_capture_id: String,
    expected_recovery_token: String,
    expected_checkpoint_ids: Vec<i64>,
) -> Result<(), String> {
    fs::create_dir_all(&report_dir).map_err(|error| error.to_string())?;
    let expected = format!(
        "expected_capture_id={expected_capture_id}\nexpected_recovery_token={expected_recovery_token}\nexpected_checkpoint_ids={}\n",
        expected_checkpoint_ids.iter().map(ToString::to_string).collect::<Vec<_>>().join(",")
    );
    fs::write(report_dir.join("expected.txt"), expected).map_err(|error| error.to_string())?;
    *state().lock().map_err(|_| "runtime smoke lock poisoned".to_string())? = Some(SmokeState {
        report_dir,
        expected_capture_id,
        expected_recovery_token,
        expected_checkpoint_ids,
        capture_ready: false,
        recovery_ready: false,
    });
    Ok(())
}

pub fn active() -> bool {
    state().lock().ok().and_then(|guard| guard.as_ref().map(|_| ())).is_some()
}

fn maybe_finish(current: &SmokeState) -> Result<bool, String> {
    if !current.capture_ready || !current.recovery_ready {
        return Ok(false);
    }
    let report = format!(
        "capture_webview_runtime_ready=PASS\nrecovery_webview_runtime_ready=PASS\ncapture_id={}\nrecovery_token={}\ncheckpoint_ids={}\n",
        current.expected_capture_id,
        current.expected_recovery_token,
        current.expected_checkpoint_ids.iter().map(ToString::to_string).collect::<Vec<_>>().join(",")
    );
    fs::write(current.report_dir.join("runtime-smoke.txt"), report).map_err(|error| error.to_string())?;
    Ok(true)
}

pub fn mark_capture_ready(capture_id: &str) -> Result<bool, String> {
    let mut guard = state().lock().map_err(|_| "runtime smoke lock poisoned".to_string())?;
    let Some(current) = guard.as_mut() else { return Ok(false); };
    if capture_id != current.expected_capture_id {
        return Err(format!(
            "installed WebView capture smoke expected {} but frontend reported {capture_id}",
            current.expected_capture_id
        ));
    }
    current.capture_ready = true;
    fs::write(current.report_dir.join("capture-ready.txt"), capture_id).map_err(|error| error.to_string())?;
    maybe_finish(current)
}

pub fn mark_recovery_ready(ready_token: &str, checkpoint_ids: &[i64]) -> Result<bool, String> {
    let mut guard = state().lock().map_err(|_| "runtime smoke lock poisoned".to_string())?;
    let Some(current) = guard.as_mut() else { return Ok(false); };
    if ready_token != current.expected_recovery_token {
        return Err(format!(
            "installed WebView recovery smoke expected {} but frontend reported {ready_token}",
            current.expected_recovery_token
        ));
    }
    if checkpoint_ids != current.expected_checkpoint_ids.as_slice() {
        return Err(format!(
            "installed WebView recovery smoke checkpoint mismatch: expected {:?}, got {:?}",
            current.expected_checkpoint_ids, checkpoint_ids
        ));
    }
    current.recovery_ready = true;
    fs::write(
        current.report_dir.join("recovery-ready.txt"),
        format!("{ready_token}|{}", checkpoint_ids.iter().map(ToString::to_string).collect::<Vec<_>>().join(",")),
    )
    .map_err(|error| error.to_string())?;
    maybe_finish(current)
}
