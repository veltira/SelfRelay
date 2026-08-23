use super::{start, ChangeNotifier, WindowRegistry};
use crate::lifecycle::{LifecycleState, EXIT_GRACE_MS};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{atomic::AtomicBool, Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const FIXTURE_EXE_NAME: &str = "selfrelay-window-fixture.exe";
const FIXTURE_APPLICATION_ID: &str = "app:selfrelay-window-fixture.exe";

fn fixture_records(registry: &WindowRegistry) -> Vec<crate::model::WindowRecord> {
    registry
        .lock()
        .map(|items| {
            items
                .values()
                .filter(|record| record.metadata.executable_name.eq_ignore_ascii_case(FIXTURE_EXE_NAME))
                .cloned()
                .collect()
        })
        .unwrap_or_default()
}

fn wait_phase(control: &Path, expected: &str) {
    let phase = control.join("phase.txt");
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if fs::read_to_string(&phase).map(|value| value == expected).unwrap_or(false) { return; }
        if Instant::now() > deadline { panic!("native fixture did not reach phase {expected}"); }
        thread::sleep(Duration::from_millis(30));
    }
}

fn advance(control: &Path, phase: &str) {
    fs::write(control.join(format!("{phase}.go")), "go").unwrap();
}

fn wait_fixture_count(registry: &WindowRegistry, expected: usize) {
    let deadline = Instant::now() + Duration::from_secs(8);
    loop {
        if fixture_records(registry).len() == expected { return; }
        if Instant::now() > deadline {
            panic!("observer fixture window count did not become {expected}; current={}", fixture_records(registry).len());
        }
        thread::sleep(Duration::from_millis(25));
    }
}

#[test]
#[ignore = "requires a real Windows desktop session and compiled fixture executable"]
fn native_win32_fixture_sequence() {
    let fixture = PathBuf::from(std::env::var("SELFRELAY_FIXTURE_EXE").expect("SELFRELAY_FIXTURE_EXE must point at selfrelay-window-fixture.exe"));
    assert!(fixture.is_file(), "fixture executable missing: {}", fixture.display());
    let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let control = std::env::temp_dir().join(format!("selfrelay-native-observer-{nonce}"));
    fs::create_dir_all(&control).unwrap();

    let shell_icon = crate::icons::load(fixture.to_str(), &control.join("icon-cache"));
    assert!(!shell_icon.fallback, "Windows Shell icon extraction fell back for real fixture executable");
    assert_eq!(shell_icon.rgba.len(), (shell_icon.width * shell_icon.height * 4) as usize);

    let registry: WindowRegistry = Arc::new(Mutex::new(HashMap::new()));
    let paused = Arc::new(AtomicBool::new(false));
    let notify: ChangeNotifier = Arc::new(|| {});
    let observer = start(Arc::clone(&registry), paused, notify);
    let mut child = Command::new(&fixture).arg("--control").arg(&control).spawn().expect("launch native fixture");
    let selected = HashSet::from([FIXTURE_APPLICATION_ID.to_string()]);
    let mut lifecycle = LifecycleState::default();
    let mut report = vec!["Windows Shell executable icon extraction: PASS"];

    wait_phase(&control, "opened");
    wait_fixture_count(&registry, 1);
    let baseline = lifecycle.transition_at(&fixture_records(&registry), &selected, 0);
    assert!(baseline.captures.is_empty());
    report.push("opened: baseline=PASS");
    advance(&control, "opened");

    wait_phase(&control, "title-changed");
    thread::sleep(Duration::from_millis(100));
    let title_delta = lifecycle.transition_at(&fixture_records(&registry), &selected, 100);
    assert!(title_delta.captures.is_empty(), "title change fabricated an exit");
    assert!(fixture_records(&registry).iter().any(|record| record.metadata.raw_title.contains("title changed")));
    report.push("title change != exit: PASS");
    advance(&control, "title-changed");

    wait_phase(&control, "minimized");
    thread::sleep(Duration::from_millis(120));
    assert_eq!(fixture_records(&registry).len(), 1, "minimize removed tracked window");
    assert!(lifecycle.transition_at(&fixture_records(&registry), &selected, 220).captures.is_empty());
    report.push("minimize != exit: PASS");
    advance(&control, "minimized");

    wait_phase(&control, "restored");
    wait_fixture_count(&registry, 1);
    assert!(lifecycle.transition_at(&fixture_records(&registry), &selected, 300).captures.is_empty());
    report.push("restore keeps context: PASS");
    advance(&control, "restored");

    wait_phase(&control, "second-opened");
    wait_fixture_count(&registry, 2);
    assert!(lifecycle.transition_at(&fixture_records(&registry), &selected, 400).captures.is_empty());
    report.push("second top-level window: PASS");
    advance(&control, "second-opened");

    wait_phase(&control, "first-destroyed");
    wait_fixture_count(&registry, 1);
    assert!(lifecycle.transition_at(&fixture_records(&registry), &selected, 500).captures.is_empty());
    report.push("one of two windows destroyed != exit: PASS");
    advance(&control, "first-destroyed");

    wait_phase(&control, "last-destroyed");
    wait_fixture_count(&registry, 0);
    assert!(lifecycle.transition_at(&fixture_records(&registry), &selected, 600).captures.is_empty());
    thread::sleep(Duration::from_millis(EXIT_GRACE_MS + 100));
    let exit_delta = lifecycle.transition_at(&fixture_records(&registry), &selected, 600 + EXIT_GRACE_MS + 100);
    assert_eq!(exit_delta.captures.len(), 1, "last destroyed must create exactly one exit");
    report.push("last top-level window destroyed = exit: PASS");
    advance(&control, "last-destroyed");

    wait_phase(&control, "returned");
    wait_fixture_count(&registry, 1);
    let return_delta = lifecycle.transition_at(&fixture_records(&registry), &selected, 2000);
    assert_eq!(return_delta.returns.len(), 1, "reopened app must create a return");
    report.push("return = recovery trigger: PASS");
    advance(&control, "returned");

    let status = child.wait().expect("wait native fixture");
    assert!(status.success(), "native fixture exited with {status}");
    observer.shutdown();

    let report_path = std::env::var("SELFRELAY_FIXTURE_REPORT").map(PathBuf::from).unwrap_or_else(|_| control.join("native-observer-result.txt"));
    if let Some(parent) = report_path.parent() { fs::create_dir_all(parent).ok(); }
    fs::write(&report_path, format!("{}\n", report.join("\n"))).unwrap();
    println!("SelfRelay native Win32 observer fixture PASS\n{}", report.join("\n"));
    let _ = fs::remove_dir_all(control);
}
