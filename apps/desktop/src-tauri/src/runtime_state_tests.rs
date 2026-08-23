use crate::{capture_runtime::CaptureCoordinator, capture_store, lifecycle::{LifecycleState, EXIT_GRACE_MS}, model::{ContextStability, NormalizedContext, WindowMetadata, WindowRecord}, storage::{self, TrackedApplication}};
use std::{collections::HashSet, fs, path::PathBuf, time::{SystemTime, UNIX_EPOCH}};

fn temp_db() -> PathBuf {
    let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    std::env::temp_dir().join(format!("selfrelay-runtime-matrix-{nonce}.db"))
}

fn record(hwnd: isize, app_id: &str, app_name: &str) -> WindowRecord {
    let exe = app_id.split(':').next_back().unwrap_or("app.exe");
    WindowRecord {
        metadata: WindowMetadata {
            hwnd, pid: hwnd as u32, executable_path: Some(format!("C:/Apps/{app_name}/{exe}")),
            executable_name: exe.into(), package_family_name: None, app_user_model_id: None,
            raw_title: app_name.into(), visible: true, is_top_level: true, class_name: "RuntimeMatrix".into(), foreground: true, observed_at_ms: 0,
        },
        context: NormalizedContext {
            application_id: app_id.into(), application_name: app_name.into(), adapter_id: "generic".into(),
            context_id: app_id.into(), context_label: app_name.into(), stability: ContextStability::Fallback,
        },
    }
}

fn track(id: &str, name: &str) -> TrackedApplication {
    TrackedApplication { application_id: id.into(), application_name: name.into(), executable_path: Some(format!("C:/Apps/{name}/{}.exe", name.to_lowercase())) }
}

#[test]
fn runtime_capture_handoff_and_multi_app_matrix() {
    let db = temp_db(); storage::initialize(&db).unwrap(); capture_store::initialize(&db).unwrap();
    let coordinator = CaptureCoordinator::new(&db);
    let notepad = "app:notepad.exe"; let paint = "app:mspaint.exe"; let word = "app:winword.exe";
    let selected = HashSet::from([notepad.to_string(), paint.to_string(), word.to_string()]);
    let mut lifecycle = LifecycleState::default();
    let mut report = Vec::new();

    // Capture surface has nothing to bind before a real lifecycle exit.
    assert!(coordinator.current().unwrap().is_none());
    report.push("capture surface never has a synthetic pending item: PASS");

    // Notepad + Paint: closing Notepad must capture even while Paint remains.
    lifecycle.transition_at(&[record(1, notepad, "Notepad"), record(2, paint, "Paint")], &selected, 0);
    lifecycle.transition_at(&[record(2, paint, "Paint")], &selected, 10);
    let delta = lifecycle.transition_at(&[record(2, paint, "Paint")], &selected, EXIT_GRACE_MS + 20);
    assert_eq!(delta.captures.len(), 1); assert_eq!(delta.captures[0].application_id, notepad);
    let first = coordinator.enqueue(&delta.captures[0], 1000).unwrap();
    assert_eq!(coordinator.current().unwrap().unwrap().id, first.id);
    report.push("independent app exit while another app remains open: PASS");

    // Persist A. Exact ID is consumed, no other pending capture can be consumed accidentally.
    let (a, _) = coordinator.save_exact(&first.id, None, "A", None, 1010).unwrap();
    assert_eq!(a.text, "A"); assert_eq!(coordinator.pending_count(), 0);

    // Close Paint too and persist P.
    lifecycle.transition_at(&[], &selected, 1100);
    let paint_exit = lifecycle.transition_at(&[], &selected, 1100 + EXIT_GRACE_MS + 20);
    assert_eq!(paint_exit.captures.len(), 1); assert_eq!(paint_exit.captures[0].application_id, paint);
    let p_capture = coordinator.enqueue(&paint_exit.captures[0], 2000).unwrap();
    let (p, _) = coordinator.save_exact(&p_capture.id, None, "P", None, 2010).unwrap();
    assert_eq!(p.text, "P");

    // A second Notepad lifecycle creates B, then C. Each save is an independent row.
    for (label, base) in [("B", 3000u64), ("C", 4000u64)] {
        let mut state = LifecycleState::default();
        state.transition_at(&[record(base as isize, notepad, "Notepad")], &selected, base);
        state.transition_at(&[], &selected, base + 1);
        let exit = state.transition_at(&[], &selected, base + EXIT_GRACE_MS + 10);
        let pending = coordinator.enqueue(&exit.captures[0], base + 20).unwrap();
        coordinator.save_exact(&pending.id, None, label, None, base + 30).unwrap();
    }
    let connection = storage::open(&db).unwrap();
    let notes = storage::unresolved_for_context(&connection, notepad).unwrap();
    assert_eq!(notes.iter().map(|item| item.text.as_str()).collect::<Vec<_>>(), vec!["A", "B", "C"]);
    let paints = storage::unresolved_for_context(&connection, paint).unwrap();
    assert_eq!(paints.iter().map(|item| item.text.as_str()).collect::<Vec<_>>(), vec!["P"]);
    report.push("independent recovery by application + A/B/C oldest-to-newest: PASS");

    // Resolving the middle item must leave A and C. Deferring is represented by doing no write at all.
    storage::resolve_checkpoint(&connection, notes[1].id, 5000).unwrap();
    let remaining = storage::unresolved_for_context(&connection, notepad).unwrap();
    assert_eq!(remaining.iter().map(|item| item.text.as_str()).collect::<Vec<_>>(), vec!["A", "C"]);
    let deferred_again = storage::unresolved_for_context(&connection, notepad).unwrap();
    assert_eq!(deferred_again.len(), 2);
    report.push("resolve middle + defer preserves unresolved rows: PASS");
    drop(connection);

    // Two and three exits are persisted without loss and keep lifecycle order.
    let mut simultaneous = LifecycleState::default();
    simultaneous.transition_at(&[record(11, notepad, "Notepad"), record(12, paint, "Paint"), record(13, word, "Word")], &selected, 0);
    simultaneous.transition_at(&[], &selected, 1);
    let exits = simultaneous.transition_at(&[], &selected, EXIT_GRACE_MS + 10);
    assert_eq!(exits.captures.len(), 3);
    let ids = exits.captures.iter().enumerate().map(|(index, snapshot)| coordinator.enqueue(snapshot, 6000 + index as u64).unwrap().id).collect::<Vec<_>>();
    assert_eq!(coordinator.pending_count(), 3);
    assert_eq!(coordinator.current().unwrap().unwrap().id, ids[0]);
    assert!(coordinator.discard_exact(&ids[2]).is_err());
    coordinator.discard_exact(&ids[0]).unwrap(); coordinator.discard_exact(&ids[1]).unwrap(); coordinator.discard_exact(&ids[2]).unwrap();
    assert_eq!(coordinator.pending_count(), 0);
    report.push("three simultaneous exits + exact-ID sequential consumption: PASS");

    // Workset checkpoints remain separate from application checkpoints and do not overwrite either.
    let mut connection = storage::open(&db).unwrap();
    storage::set_application_tracking(&connection, &track(notepad, "Notepad"), true, 1).unwrap();
    storage::set_application_tracking(&connection, &track(paint, "Paint"), true, 1).unwrap();
    storage::create_workset(&mut connection, "ws:coder", "CoderCup", &[notepad.into(), paint.into()], 1).unwrap();
    storage::insert_checkpoint(&connection, notepad, "Notepad", notepad, "Notepad", Some("ws:coder"), "Workset", None, 7000).unwrap();
    assert_eq!(storage::unresolved_for_workset(&connection, "ws:coder").unwrap().len(), 1);
    assert_eq!(storage::unresolved_for_context(&connection, notepad).unwrap().iter().map(|item| item.text.as_str()).collect::<Vec<_>>(), vec!["A", "C"]);
    report.push("workset/application interleaving remains independent: PASS");

    if let Ok(path) = std::env::var("SELFRELAY_RUNTIME_REPORT") {
        let path = PathBuf::from(path); if let Some(parent) = path.parent() { fs::create_dir_all(parent).ok(); }
        fs::write(path, format!("{}\n", report.join("\n"))).unwrap();
    }
    println!("SelfRelay runtime state matrix PASS\n{}", report.join("\n"));
    drop(connection); let _ = fs::remove_file(db);
}
