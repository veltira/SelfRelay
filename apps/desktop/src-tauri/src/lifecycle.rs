use crate::model::WindowRecord;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

pub const EXIT_GRACE_MS: u64 = 300;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextSnapshot {
    pub application_id: String,
    pub application_name: String,
    pub context_id: String,
    pub context_label: String,
}

impl From<&WindowRecord> for ContextSnapshot {
    fn from(record: &WindowRecord) -> Self {
        Self {
            application_id: record.context.application_id.clone(),
            application_name: record.context.application_name.clone(),
            context_id: record.context.context_id.clone(),
            context_label: record.context.context_label.clone(),
        }
    }
}

#[derive(Debug, Default)]
pub struct LifecycleDelta {
    pub captures: Vec<ContextSnapshot>,
    pub returns: Vec<ContextSnapshot>,
}

#[derive(Debug, Clone)]
struct PendingExit {
    snapshot: ContextSnapshot,
    due_at_ms: u64,
    sequence: u64,
}

#[derive(Debug, Default)]
pub struct LifecycleState {
    initialized: bool,
    windows: HashMap<isize, ContextSnapshot>,
    pending_exits: HashMap<String, PendingExit>,
    next_exit_sequence: u64,
}

impl LifecycleState {
    pub fn reset(&mut self) {
        self.initialized = false;
        self.windows.clear();
        self.pending_exits.clear();
    }

    pub fn synchronize(&mut self, records: &[WindowRecord], tracked: &HashSet<String>) {
        self.windows = tracked_windows(records, tracked);
        self.pending_exits.clear();
        self.initialized = true;
    }

    pub fn transition_at(
        &mut self,
        records: &[WindowRecord],
        tracked: &HashSet<String>,
        now_ms: u64,
    ) -> LifecycleDelta {
        let next = tracked_windows(records, tracked);
        if !self.initialized {
            self.windows = next.clone();
            self.initialized = true;
            return LifecycleDelta {
                captures: Vec::new(),
                returns: unique_contexts(next.values().cloned()),
            };
        }

        let previous_contexts = self
            .windows
            .values()
            .map(|context| context.context_id.clone())
            .collect::<HashSet<_>>();
        let next_contexts = next
            .values()
            .map(|context| context.context_id.clone())
            .collect::<HashSet<_>>();

        // Native apps can destroy/recreate their top-level HWND during normal use.
        // If the same durable context returns inside the grace period, suppress both
        // the exit and the corresponding return.
        let mut suppressed_returns = HashSet::new();
        for context_id in &next_contexts {
            if self.pending_exits.remove(context_id).is_some() {
                suppressed_returns.insert(context_id.clone());
            }
        }

        let mut seen_vanished = HashSet::new();
        for (hwnd, previous) in &self.windows {
            if let Some(current_same_window) = next.get(hwnd) {
                // A title/document mutation on the same HWND is not a native exit.
                if current_same_window.context_id != previous.context_id {
                    continue;
                }
            } else if !next_contexts.contains(&previous.context_id)
                && seen_vanished.insert(previous.context_id.clone())
            {
                if !self.pending_exits.contains_key(&previous.context_id) {
                    self.next_exit_sequence = self.next_exit_sequence.saturating_add(1);
                    self.pending_exits.insert(
                        previous.context_id.clone(),
                        PendingExit {
                            snapshot: previous.clone(),
                            due_at_ms: now_ms.saturating_add(EXIT_GRACE_MS),
                            sequence: self.next_exit_sequence,
                        },
                    );
                }
            }
        }

        let mut matured = self
            .pending_exits
            .iter()
            .filter(|(context_id, pending)| {
                pending.due_at_ms <= now_ms && !next_contexts.contains(*context_id)
            })
            .map(|(context_id, pending)| {
                (context_id.clone(), pending.due_at_ms, pending.sequence)
            })
            .collect::<Vec<_>>();
        matured.sort_by_key(|(_, due_at_ms, sequence)| (*due_at_ms, *sequence));

        let mut captures = Vec::with_capacity(matured.len());
        for (context_id, _, _) in matured {
            if let Some(pending) = self.pending_exits.remove(&context_id) {
                captures.push(pending.snapshot);
            }
        }

        let mut returns = Vec::new();
        let mut returned_ids = HashSet::new();
        for (hwnd, current) in &next {
            let is_new_window = !self.windows.contains_key(hwnd);
            let context_was_absent = !previous_contexts.contains(&current.context_id);
            if is_new_window
                && context_was_absent
                && !suppressed_returns.contains(&current.context_id)
                && returned_ids.insert(current.context_id.clone())
            {
                returns.push(current.clone());
            }
        }

        self.windows = next;
        LifecycleDelta { captures, returns }
    }
}

fn tracked_windows(
    records: &[WindowRecord],
    tracked: &HashSet<String>,
) -> HashMap<isize, ContextSnapshot> {
    records
        .iter()
        .filter(|record| tracked.contains(&record.context.application_id))
        .map(|record| (record.metadata.hwnd, ContextSnapshot::from(record)))
        .collect()
}

fn unique_contexts(items: impl IntoIterator<Item = ContextSnapshot>) -> Vec<ContextSnapshot> {
    let mut seen = HashSet::new();
    items
        .into_iter()
        .filter(|item| seen.insert(item.context_id.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{ContextStability, NormalizedContext, WindowMetadata};

    fn record(hwnd: isize, app: &str, context: &str, label: &str) -> WindowRecord {
        WindowRecord {
            metadata: WindowMetadata {
                hwnd,
                pid: hwnd as u32,
                executable_path: Some(format!("C:/Windows/{app}.exe")),
                executable_name: format!("{app}.exe"),
                package_family_name: None,
                app_user_model_id: None,
                raw_title: label.into(),
                visible: true,
                is_top_level: true,
                class_name: "TestWindow".into(),
                foreground: true,
                observed_at_ms: 0,
            },
            context: NormalizedContext {
                application_id: format!("app:{app}.exe"),
                application_name: app.into(),
                adapter_id: "generic".into(),
                context_id: context.into(),
                context_label: label.into(),
                stability: ContextStability::Fallback,
            },
        }
    }

    fn tracked(ids: &[&str]) -> HashSet<String> {
        ids.iter().map(|id| id.to_string()).collect()
    }

    #[test]
    fn no_selected_apps_means_no_capture() {
        let mut state = LifecycleState::default();
        state.transition_at(&[record(1, "notepad", "app:notepad.exe", "Notes")], &HashSet::new(), 0);
        assert!(state.transition_at(&[], &HashSet::new(), 2000).captures.is_empty());
    }

    #[test]
    fn selected_app_closes_only_after_grace_and_exactly_once() {
        let mut state = LifecycleState::default();
        let selected = tracked(&["app:notepad.exe"]);
        state.transition_at(&[record(1, "notepad", "app:notepad.exe", "Notes")], &selected, 0);
        assert!(state.transition_at(&[], &selected, 10).captures.is_empty());
        assert!(state.transition_at(&[], &selected, EXIT_GRACE_MS).captures.is_empty());
        let first = state.transition_at(&[], &selected, EXIT_GRACE_MS + 11);
        let second = state.transition_at(&[], &selected, 5000);
        assert_eq!(first.captures.len(), 1);
        assert!(second.captures.is_empty());
    }

    #[test]
    fn destroy_recreate_race_does_not_exit_or_return() {
        let mut state = LifecycleState::default();
        let selected = tracked(&["app:notepad.exe"]);
        state.transition_at(&[record(1, "notepad", "app:notepad.exe", "Notes")], &selected, 0);
        state.transition_at(&[], &selected, 10);
        let delta = state.transition_at(
            &[record(2, "notepad", "app:notepad.exe", "Notes")],
            &selected,
            200,
        );
        assert!(delta.captures.is_empty());
        assert!(delta.returns.is_empty());
    }

    #[test]
    fn one_of_multiple_generic_windows_is_not_exit() {
        let mut state = LifecycleState::default();
        let selected = tracked(&["app:notepad.exe"]);
        state.transition_at(
            &[
                record(1, "notepad", "app:notepad.exe", "A"),
                record(2, "notepad", "app:notepad.exe", "B"),
            ],
            &selected,
            0,
        );
        assert!(state
            .transition_at(&[record(2, "notepad", "app:notepad.exe", "B")], &selected, 1000)
            .captures
            .is_empty());
        assert!(state.transition_at(&[], &selected, 1100).captures.is_empty());
        assert_eq!(state.transition_at(&[], &selected, 1800).captures.len(), 1);
    }

    #[test]
    fn title_or_specialized_context_change_on_same_hwnd_is_not_exit() {
        let mut state = LifecycleState::default();
        let selected = tracked(&["app:word.exe"]);
        state.transition_at(&[record(3, "word", "word:a.docx", "A.docx")], &selected, 0);
        let delta = state.transition_at(&[record(3, "word", "word:b.docx", "B.docx")], &selected, 1000);
        assert!(delta.captures.is_empty());
    }

    #[test]
    fn specialized_context_can_exit_while_same_app_keeps_another_open() {
        let mut state = LifecycleState::default();
        let selected = tracked(&["app:word.exe"]);
        state.transition_at(
            &[
                record(3, "word", "word:a.docx", "A.docx"),
                record(4, "word", "word:b.docx", "B.docx"),
            ],
            &selected,
            0,
        );
        state.transition_at(&[record(4, "word", "word:b.docx", "B.docx")], &selected, 100);
        let delta = state.transition_at(&[record(4, "word", "word:b.docx", "B.docx")], &selected, 900);
        assert_eq!(delta.captures.len(), 1);
        assert_eq!(delta.captures[0].context_id, "word:a.docx");
    }

    #[test]
    fn removing_selection_can_synchronize_without_capture() {
        let mut state = LifecycleState::default();
        let selected = tracked(&["app:notepad.exe"]);
        let open = [record(1, "notepad", "app:notepad.exe", "Notes")];
        state.transition_at(&open, &selected, 0);
        state.synchronize(&open, &HashSet::new());
        assert!(state.transition_at(&[], &HashSet::new(), 5000).captures.is_empty());
    }

    #[test]
    fn return_after_mature_exit_is_reported() {
        let mut state = LifecycleState::default();
        let selected = tracked(&["app:notepad.exe"]);
        state.transition_at(&[record(1, "notepad", "app:notepad.exe", "Notes")], &selected, 0);
        state.transition_at(&[], &selected, 10);
        state.transition_at(&[], &selected, 1000);
        let delta = state.transition_at(&[record(4, "notepad", "app:notepad.exe", "Notes")], &selected, 2000);
        assert_eq!(delta.returns.len(), 1);
    }

    #[test]
    fn two_simultaneous_app_exits_preserve_exit_order() {
        let mut state = LifecycleState::default();
        let selected = tracked(&["app:notepad.exe", "app:paint.exe"]);
        state.transition_at(
            &[
                record(1, "notepad", "app:notepad.exe", "Notepad"),
                record(2, "paint", "app:paint.exe", "Paint"),
            ],
            &selected,
            0,
        );
        state.transition_at(&[record(2, "paint", "app:paint.exe", "Paint")], &selected, 10);
        state.transition_at(&[], &selected, 20);
        let delta = state.transition_at(&[], &selected, 1000);
        assert_eq!(delta.captures.len(), 2);
        assert_eq!(delta.captures[0].application_id, "app:notepad.exe");
        assert_eq!(delta.captures[1].application_id, "app:paint.exe");
    }

    #[test]
    fn three_simultaneous_app_exits_are_all_emitted_once() {
        let mut state = LifecycleState::default();
        let selected = tracked(&["app:notepad.exe", "app:paint.exe", "app:word.exe"]);
        state.transition_at(
            &[
                record(1, "notepad", "app:notepad.exe", "Notepad"),
                record(2, "paint", "app:paint.exe", "Paint"),
                record(3, "word", "app:word.exe", "Word"),
            ],
            &selected,
            0,
        );
        state.transition_at(&[], &selected, 5);
        let delta = state.transition_at(&[], &selected, 1000);
        assert_eq!(delta.captures.len(), 3);
        assert!(state.transition_at(&[], &selected, 2000).captures.is_empty());
    }
}
