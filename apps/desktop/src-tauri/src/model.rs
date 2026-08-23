use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WindowMetadata {
    pub hwnd: isize,
    pub pid: u32,
    pub executable_path: Option<String>,
    pub executable_name: String,
    pub package_family_name: Option<String>,
    pub app_user_model_id: Option<String>,
    pub raw_title: String,
    pub visible: bool,
    pub is_top_level: bool,
    pub class_name: String,
    pub foreground: bool,
    pub observed_at_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ContextStability {
    Stable,
    Fallback,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizedContext {
    pub application_id: String,
    pub application_name: String,
    pub adapter_id: String,
    pub context_id: String,
    pub context_label: String,
    pub stability: ContextStability,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WindowRecord {
    pub metadata: WindowMetadata,
    pub context: NormalizedContext,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedContext {
    pub application_id: String,
    pub application_name: String,
    pub executable_name: String,
    pub raw_title: String,
    pub adapter_id: String,
    pub context_id: String,
    pub context_label: String,
    pub stability: ContextStability,
    pub foreground: bool,
}

impl From<&WindowRecord> for DetectedContext {
    fn from(record: &WindowRecord) -> Self {
        Self {
            application_id: record.context.application_id.clone(),
            application_name: record.context.application_name.clone(),
            executable_name: record.metadata.executable_name.clone(),
            raw_title: record.metadata.raw_title.clone(),
            adapter_id: record.context.adapter_id.clone(),
            context_id: record.context.context_id.clone(),
            context_label: record.context.context_label.clone(),
            stability: record.context.stability,
            foreground: record.metadata.foreground,
        }
    }
}
