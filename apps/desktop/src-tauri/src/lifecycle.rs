use crate::model::WindowRecord;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};

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

#[derive(Debug, Default)]
pub struct LifecycleState {
    initialized: bool,
    windows: HashMap<isize, ContextSnapshot>,
    capture_queue: VecDeque<ContextSnapshot>,
}

impl LifecycleState {
    pub fn reset(&mut self) {
        self.initialized = false;
        self.windows.clear();
        self.capture_queue.clear();
    }

    pub fn synchronize(&mut self, records: &[WindowRecord], tracked: &HashSet<String>) {
        self.windows = tracked_windows(records, tracked);
        self.initialized = true;
    }

    pub fn transition(&mut self, records: &[WindowRecord], tracked: &HashSet<String>) -> LifecycleDelta {
        let next = tracked_windows(records, tracked);
        if !self.initialized {
            self.windows = next.clone();
            self.initialized = true;
            return LifecycleDelta {
                captures: Vec::new(),
                returns: unique_contexts(next.values().cloned()),
            };
        }

        let previous_contexts = self.windows.values().map(|context| context.context_id.clone()).collect::<HashSet<_>>();
        let next_contexts = next.values().map(|context| context.context_id.clone()).collect::<HashSet<_>>();

        let mut captures = Vec::new();
        let mut captured_ids = HashSet::new();
        for (hwnd, previous) in &self.windows {
            if let Some(current_same_window) = next.get(hwnd) {
                // A mutable title/document inside the same top-level window is not a real exit.
                if current_same_window.context_id != previous.context_id {
                    continue;
                }
            } else if !next_contexts.contains(&previous.context_id)
                && captured_ids.insert(previous.context_id.clone())
            {
                captures.push(previous.clone());
            }
        }

        let mut returns = Vec::new();
        let mut returned_ids = HashSet::new();
        for (hwnd, current) in &next {
            let is_new_window = !self.windows.contains_key(hwnd);
            let context_was_absent = !previous_contexts.contains(&current.context_id);
            if is_new_window && context_was_absent && returned_ids.insert(current.context_id.clone()) {
                returns.push(current.clone());
            }
        }

        self.windows = next;
        for capture in &captures {
            self.capture_queue.push_back(capture.clone());
        }
        LifecycleDelta { captures, returns }
    }

    pub fn pending_capture(&self) -> Option<ContextSnapshot> {
        self.capture_queue.front().cloned()
    }

    pub fn consume_capture(&mut self) -> Option<ContextSnapshot> {
        self.capture_queue.pop_front()
    }
}

fn tracked_windows(records: &[WindowRecord], tracked: &HashSet<String>) -> HashMap<isize, ContextSnapshot> {
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
        state.transition(&[record(1, "notepad", "app:notepad.exe", "Notes")], &HashSet::new());
        let delta = state.transition(&[], &HashSet::new());
        assert!(delta.captures.is_empty());
    }

    #[test]
    fn selected_app_closes_into_exactly_one_capture() {
        let mut state = LifecycleState::default();
        let selected = tracked(&["app:notepad.exe"]);
        state.transition(&[record(1, "notepad", "app:notepad.exe", "Notes")], &selected);
        let first = state.transition(&[], &selected);
        let second = state.transition(&[], &selected);
        assert_eq!(first.captures.len(), 1);
        assert!(second.captures.is_empty());
        assert_eq!(state.pending_capture().unwrap().application_id, "app:notepad.exe");
    }

    #[test]
    fn unselected_app_never_captures() {
        let mut state = LifecycleState::default();
        let selected = tracked(&["app:notepad.exe"]);
        state.transition(&[record(2, "discord", "app:discord.exe", "Discord")], &selected);
        assert!(state.transition(&[], &selected).captures.is_empty());
    }

    #[test]
    fn changing_title_or_context_on_same_window_is_not_exit() {
        let mut state = LifecycleState::default();
        let selected = tracked(&["app:word.exe"]);
        state.transition(&[record(3, "word", "word:a.docx", "A.docx")], &selected);
        let delta = state.transition(&[record(3, "word", "word:b.docx", "B.docx")], &selected);
        assert!(delta.captures.is_empty());
    }

    #[test]
    fn one_specialized_context_can_exit_while_same_app_keeps_another_open() {
        let mut state = LifecycleState::default();
        let selected = tracked(&["app:word.exe"]);
        state.transition(&[
            record(3, "word", "word:a.docx", "A.docx"),
            record(4, "word", "word:b.docx", "B.docx"),
        ], &selected);
        let delta = state.transition(&[record(4, "word", "word:b.docx", "B.docx")], &selected);
        assert_eq!(delta.captures.len(), 1);
        assert_eq!(delta.captures[0].context_id, "word:a.docx");
    }

    #[test]
    fn removing_selection_can_be_synchronized_without_capture() {
        let mut state = LifecycleState::default();
        let selected = tracked(&["app:notepad.exe"]);
        let open = [record(1, "notepad", "app:notepad.exe", "Notes")];
        state.transition(&open, &selected);
        state.synchronize(&open, &HashSet::new());
        assert!(state.transition(&[], &HashSet::new()).captures.is_empty());
    }

    #[test]
    fn returning_after_close_is_reported() {
        let mut state = LifecycleState::default();
        let selected = tracked(&["app:notepad.exe"]);
        state.transition(&[record(1, "notepad", "app:notepad.exe", "Notes")], &selected);
        state.transition(&[], &selected);
        let delta = state.transition(&[record(4, "notepad", "app:notepad.exe", "Notes")], &selected);
        assert_eq!(delta.returns.len(), 1);
    }
}
