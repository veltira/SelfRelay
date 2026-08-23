use crate::{identity, model::{ContextStability, NormalizedContext, WindowMetadata}};

pub trait ApplicationAdapter: Send + Sync {
    fn id(&self) -> &'static str;
    fn matches(&self, metadata: &WindowMetadata) -> bool;
    fn derive(&self, metadata: &WindowMetadata) -> NormalizedContext;
}

pub struct VsCodeAdapter;
pub struct WordAdapter;
pub struct ExcelAdapter;
pub struct GenericAdapter;

pub fn normalize_title(input: &str) -> String {
    input
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_matches(|c: char| c == '-' || c == '—' || c.is_whitespace())
        .trim()
        .to_string()
}

fn identity_component(input: &str) -> String {
    normalize_title(input).to_lowercase()
}

fn executable_name(metadata: &WindowMetadata) -> String {
    metadata.executable_name.to_lowercase()
}

fn strip_suffix<'a>(title: &'a str, suffixes: &[&str]) -> &'a str {
    let trimmed = title.trim();
    for suffix in suffixes {
        if trimmed.to_lowercase().ends_with(&suffix.to_lowercase()) {
            let keep = trimmed.len().saturating_sub(suffix.len());
            return trimmed[..keep].trim();
        }
    }
    trimmed
}

fn split_editor_title(title: &str) -> Vec<String> {
    let separator = if title.contains(" — ") { " — " } else { " - " };
    title
        .split(separator)
        .map(normalize_title)
        .filter(|part| !part.is_empty())
        .collect()
}

impl ApplicationAdapter for VsCodeAdapter {
    fn id(&self) -> &'static str { "vscode" }

    fn matches(&self, metadata: &WindowMetadata) -> bool {
        executable_name(metadata) == "code.exe"
            || metadata.raw_title.to_lowercase().ends_with("visual studio code")
    }

    fn derive(&self, metadata: &WindowMetadata) -> NormalizedContext {
        let without_app = strip_suffix(
            &metadata.raw_title,
            &[" — Visual Studio Code", " - Visual Studio Code"],
        );
        let parts = split_editor_title(without_app);
        let workspace = if parts.len() >= 2 {
            parts.last().cloned().unwrap_or_else(|| "Visual Studio Code".into())
        } else {
            parts.first().cloned().unwrap_or_else(|| "Visual Studio Code".into())
        };
        NormalizedContext {
            application_id: identity::from_metadata(metadata),
            application_name: "Visual Studio Code".into(),
            adapter_id: self.id().into(),
            context_id: format!("vscode:{}", identity_component(&workspace)),
            context_label: workspace,
            stability: ContextStability::Stable,
        }
    }
}

impl ApplicationAdapter for WordAdapter {
    fn id(&self) -> &'static str { "word" }

    fn matches(&self, metadata: &WindowMetadata) -> bool {
        executable_name(metadata) == "winword.exe"
            || metadata.raw_title.to_lowercase().ends_with(" - word")
            || metadata.raw_title.to_lowercase().ends_with(" - microsoft word")
    }

    fn derive(&self, metadata: &WindowMetadata) -> NormalizedContext {
        let document = normalize_title(strip_suffix(
            &metadata.raw_title,
            &[" - Microsoft Word", " - Word"],
        ));
        NormalizedContext {
            application_id: identity::from_metadata(metadata),
            application_name: "Microsoft Word".into(),
            adapter_id: self.id().into(),
            context_id: format!("word:{}", identity_component(&document)),
            context_label: document,
            stability: ContextStability::Stable,
        }
    }
}

impl ApplicationAdapter for ExcelAdapter {
    fn id(&self) -> &'static str { "excel" }

    fn matches(&self, metadata: &WindowMetadata) -> bool {
        executable_name(metadata) == "excel.exe"
            || metadata.raw_title.to_lowercase().ends_with(" - excel")
    }

    fn derive(&self, metadata: &WindowMetadata) -> NormalizedContext {
        let workbook = normalize_title(strip_suffix(&metadata.raw_title, &[" - Excel"]));
        NormalizedContext {
            application_id: identity::from_metadata(metadata),
            application_name: "Microsoft Excel".into(),
            adapter_id: self.id().into(),
            context_id: format!("excel:{}", identity_component(&workbook)),
            context_label: workbook,
            stability: ContextStability::Stable,
        }
    }
}

impl ApplicationAdapter for GenericAdapter {
    fn id(&self) -> &'static str { "generic" }

    fn matches(&self, _metadata: &WindowMetadata) -> bool { true }

    fn derive(&self, metadata: &WindowMetadata) -> NormalizedContext {
        let title = normalize_title(&metadata.raw_title);
        let app_label = metadata.executable_name.trim_end_matches(".exe").to_string();
        let application_id = identity::from_metadata(metadata);
        NormalizedContext {
            application_id: application_id.clone(),
            application_name: if app_label.is_empty() { "Application".into() } else { app_label },
            adapter_id: self.id().into(),
            // Generic applications expose no reliable document/workspace identity. Keep the
            // selected application identity as the durable context instead of mutable titles.
            context_id: application_id,
            context_label: if title.is_empty() { metadata.executable_name.clone() } else { title },
            stability: ContextStability::Fallback,
        }
    }
}

pub fn derive_context(metadata: &WindowMetadata) -> NormalizedContext {
    let adapters: [&dyn ApplicationAdapter; 3] = [&VsCodeAdapter, &WordAdapter, &ExcelAdapter];
    for adapter in adapters {
        if adapter.matches(metadata) {
            return adapter.derive(metadata);
        }
    }
    GenericAdapter.derive(metadata)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn metadata(exe: &str, title: &str) -> WindowMetadata {
        WindowMetadata {
            hwnd: 1,
            pid: 22,
            executable_path: Some(format!("C:/Program Files/{exe}")),
            executable_name: exe.into(),
            package_family_name: None,
            app_user_model_id: None,
            raw_title: title.into(),
            visible: true,
            is_top_level: true,
            class_name: "TestWindow".into(),
            foreground: false,
            observed_at_ms: 0,
        }
    }

    #[test]
    fn normalizes_title_whitespace() {
        assert_eq!(normalize_title("  Proposal.docx   -   Word  "), "Proposal.docx - Word");
    }

    #[test]
    fn vscode_adapter_extracts_workspace() {
        let context = derive_context(&metadata("Code.exe", "main.ts — SelfRelay — Visual Studio Code"));
        assert_eq!(context.application_name, "Visual Studio Code");
        assert_eq!(context.context_label, "SelfRelay");
        assert_eq!(context.context_id, "vscode:selfrelay");
        assert!(context.application_id.starts_with("path:"));
    }

    #[test]
    fn vscode_identity_is_stable_when_active_file_changes() {
        let a = derive_context(&metadata("Code.exe", "main.ts — SelfRelay — Visual Studio Code"));
        let b = derive_context(&metadata("Code.exe", "README.md — SelfRelay — Visual Studio Code"));
        assert_eq!(a.context_id, b.context_id);
        assert_eq!(a.application_id, b.application_id);
    }

    #[test]
    fn word_adapter_extracts_document() {
        let context = derive_context(&metadata("WINWORD.EXE", "Proposal.docx - Word"));
        assert_eq!(context.context_label, "Proposal.docx");
        assert_eq!(context.context_id, "word:proposal.docx");
    }

    #[test]
    fn excel_adapter_extracts_workbook() {
        let context = derive_context(&metadata("EXCEL.EXE", "Metrics.xlsx - Excel"));
        assert_eq!(context.context_label, "Metrics.xlsx");
        assert_eq!(context.context_id, "excel:metrics.xlsx");
    }

    #[test]
    fn generic_adapter_uses_application_identity_not_window_title() {
        let a = derive_context(&metadata("notepad.exe", "notes.txt - Notepad"));
        let b = derive_context(&metadata("notepad.exe", "another.txt - Notepad"));
        assert_eq!(a.adapter_id, "generic");
        assert!(a.context_id.starts_with("path:"));
        assert_eq!(a.context_id, b.context_id);
        assert_eq!(a.stability, ContextStability::Fallback);
    }
}
