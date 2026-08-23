use super::{start, ChangeNotifier, WindowRegistry};
use crate::{capture_runtime::CaptureCoordinator, capture_store, lifecycle::{LifecycleState, EXIT_GRACE_MS}, storage};
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

fn fixture_records(registry: &WindowRegistry) -> Vec<crate::model::WindowRecord> {
    registry.lock().map(|items| items.values()
        .filter(|record| record.metadata.executable_name.eq_ignore_ascii_case(FIXTURE_EXE_NAME))
        .cloned().collect()).unwrap_or_default()
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
fn advance(control: &Path, phase: &str) { fs::write(control.join(format!("{phase}.go")), "go").unwrap(); }
fn wait_fixture_count(registry: &WindowRegistry, expected: usize) {
    let deadline = Instant::now() + Duration::from_secs(8);
    loop {
        if fixture_records(registry).len() == expected { return; }
        if Instant::now() > deadline { panic!("observer fixture window count did not become {expected}; current={}", fixture_records(registry).len()); }
        thread::sleep(Duration::from_millis(25));
    }
}

#[test]
#[ignore = "requires a real Windows desktop session and compiled fixture executable"]
fn native_win32_fixture_sequence() {
    let fixture = PathBuf::from(std::env::var("SELFRELAY_FIXTURE_EXE").expect("SELFRELAY_FIXTURE_EXE must point at fixture"));
    assert!(fixture.is_file(), "fixture executable missing: {}", fixture.display());
    let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let control = std::env::temp_dir().join(format!("selfrelay-native-observer-{nonce}"));
    fs::create_dir_all(&control).unwrap();
    let db = control.join("runtime-state.db");
    storage::initialize(&db).unwrap();
    capture_store::initialize(&db).unwrap();
    let coordinator = CaptureCoordinator::new(&db);

    let shell_icon = crate::icons::load(fixture.to_str(), &control.join("icon-cache"));
    assert!(!shell_icon.fallback, "Windows Shell icon extraction fell back for real fixture executable");

    let registry: WindowRegistry = Arc::new(Mutex::new(HashMap::new()));
    let paused = Arc::new(AtomicBool::new(false));
    let notify: ChangeNotifier = Arc::new(|| {});
    let observer = start(Arc::clone(&registry), paused, notify);
    let mut child = Command::new(&fixture).arg("--control").arg(&control).spawn().expect("launch native fixture");
    let mut lifecycle = LifecycleState::default();
    let mut report = vec!["Windows Shell executable icon extraction: PASS"];

    wait_phase(&control, "opened");
    wait_fixture_count(&registry, 1);
    let opened = fixture_records(&registry);
    let application_id = opened[0].context.application_id.clone();
    let selected = HashSet::from([application_id.clone()]);
    assert!(lifecycle.transition_at(&opened, &selected, 0).captures.is_empty());
    report.push("opened: tracked identity baseline=PASS");
    advance(&control, "opened");

    wait_phase(&control, "title-changed"); thread::sleep(Duration::from_millis(100));
    assert!(lifecycle.transition_at(&fixture_records(&registry), &selected, 100).captures.is_empty());
    report.push("title change != exit: PASS"); advance(&control, "title-changed");

    wait_phase(&control, "minimized"); thread::sleep(Duration::from_millis(120));
    assert_eq!(fixture_records(&registry).len(), 1); assert!(lifecycle.transition_at(&fixture_records(&registry), &selected, 220).captures.is_empty());
    report.push("minimize != exit: PASS"); advance(&control, "minimized");

    wait_phase(&control, "restored"); wait_fixture_count(&registry, 1);
    assert!(lifecycle.transition_at(&fixture_records(&registry), &selected, 300).captures.is_empty());
    report.push("restore keeps context: PASS"); advance(&control, "restored");

    wait_phase(&control, "second-opened"); wait_fixture_count(&registry, 2);
    assert!(lifecycle.transition_at(&fixture_records(&registry), &selected, 400).captures.is_empty());
    report.push("second top-level window: PASS"); advance(&control, "second-opened");

    wait_phase(&control, "first-destroyed"); wait_fixture_count(&registry, 1);
    assert!(lifecycle.transition_at(&fixture_records(&registry), &selected, 500).captures.is_empty());
    report.push("one of two windows destroyed != exit: PASS"); advance(&control, "first-destroyed");

    wait_phase(&control, "last-destroyed"); wait_fixture_count(&registry, 0);
    assert!(lifecycle.transition_at(&[], &selected, 600).captures.is_empty());
    thread::sleep(Duration::from_millis(EXIT_GRACE_MS + 100));
    let exit_delta = lifecycle.transition_at(&[], &selected, 600 + EXIT_GRACE_MS + 100);
    assert_eq!(exit_delta.captures.len(), 1, "last destroyed must create exactly one exit");

    // This is the real 0.2.1 handoff: lifecycle output is persisted first,
    // then the same coordinator used by Tauri resolves a stable capture ID.
    let persisted = coordinator.enqueue(&exit_delta.captures[0], 1400).unwrap();
    let pending = coordinator.current().unwrap().expect("durable capture must exist before surface can open");
    assert_eq!(pending.id, persisted.id);
    assert_eq!(pending.application_id, application_id);
    assert_eq!(pending.context_id, exit_delta.captures[0].context_id);
    report.push("last window -> durable pending capture ID: PASS");

    let (saved, next) = coordinator.save_exact(&pending.id, None, "fixture checkpoint", None, 1500).unwrap();
    assert!(next.is_none());
    assert_eq!(coordinator.pending_count(), 0);
    let stored = storage::checkpoint_by_id(&storage::open(&db).unwrap(), saved.id).unwrap().unwrap();
    assert_eq!(stored.text, "fixture checkpoint");
    report.push("capture ID -> atomic save/consume -> SQLite: PASS");
    advance(&control, "last-destroyed");

    wait_phase(&control, "returned"); wait_fixture_count(&registry, 1);
    let return_delta = lifecycle.transition_at(&fixture_records(&registry), &selected, 2000);
    assert_eq!(return_delta.returns.len(), 1, "reopened app must create a return");
    let recovered = storage::unresolved_for_context(&storage::open(&db).unwrap(), &return_delta.returns[0].context_id).unwrap();
    assert_eq!(recovered.len(), 1); assert_eq!(recovered[0].id, saved.id);
    report.push("reopen -> unresolved checkpoint recovery: PASS");
    advance(&control, "returned");

    let status = child.wait().expect("wait native fixture"); assert!(status.success()); observer.shutdown();
    let report_path = std::env::var("SELFRELAY_FIXTURE_REPORT").map(PathBuf::from).unwrap_or_else(|_| control.join("native-observer-result.txt"));
    if let Some(parent) = report_path.parent() { fs::create_dir_all(parent).ok(); }
    fs::write(&report_path, format!("application_id={application_id}\n{}\n", report.join("\n"))).unwrap();
    println!("SelfRelay native Win32 runtime capture integration PASS\n{}", report.join("\n"));
    let _ = fs::remove_dir_all(control);
}
