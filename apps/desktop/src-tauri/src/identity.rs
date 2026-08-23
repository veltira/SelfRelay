use crate::{model::WindowMetadata, storage::TrackedApplication};
use std::path::{Path, PathBuf};

pub fn normalized_path(value: &str) -> String {
    let source = PathBuf::from(value);
    let resolved = std::fs::canonicalize(&source).unwrap_or(source);
    resolved
        .to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}

pub fn legacy_application_id(executable_name: &str) -> String {
    format!("app:{}", executable_name.to_ascii_lowercase())
}

pub fn application_id(
    executable_path: Option<&str>,
    executable_name: &str,
    app_user_model_id: Option<&str>,
) -> String {
    if let Some(aumid) = app_user_model_id.map(str::trim).filter(|value| !value.is_empty()) {
        return format!("aumid:{}", aumid.to_lowercase());
    }
    if let Some(path) = executable_path.map(str::trim).filter(|value| !value.is_empty()) {
        return format!("path:{}", normalized_path(path));
    }
    legacy_application_id(executable_name)
}

pub fn from_metadata(metadata: &WindowMetadata) -> String {
    application_id(
        metadata.executable_path.as_deref(),
        &metadata.executable_name,
        metadata.app_user_model_id.as_deref(),
    )
}

pub fn tracked_matches_metadata(application: &TrackedApplication, metadata: &WindowMetadata) -> bool {
    if application.application_id == from_metadata(metadata) {
        return true;
    }

    if let (Some(expected), Some(actual)) = (
        application.executable_path.as_deref(),
        metadata.executable_path.as_deref(),
    ) {
        if normalized_path(expected) == normalized_path(actual) {
            return true;
        }
    }

    // Compatibility with 0.2.0 rules. Basename matching is intentionally
    // limited to legacy app:<exe> identities so two modern path identities do
    // not collapse merely because their binaries share a filename.
    application.application_id.starts_with("app:")
        && application.application_id == legacy_application_id(&metadata.executable_name)
}

pub fn migrate_020_identities(db_path: &Path) -> rusqlite::Result<()> {
    use rusqlite::params;

    let mut connection = rusqlite::Connection::open(db_path)?;
    let legacy = {
        let mut statement = connection.prepare(
            "SELECT DISTINCT application_id, executable_path
             FROM tracking_rules
             WHERE scope = 'application'
               AND enabled = 1
               AND application_id LIKE 'app:%'
               AND executable_path IS NOT NULL
               AND TRIM(executable_path) <> ''",
        )?;
        statement
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };

    if legacy.is_empty() {
        return Ok(());
    }

    let tx = connection.transaction()?;
    for (old_id, executable_path) in legacy {
        let executable_name = Path::new(&executable_path)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if executable_name.is_empty() {
            continue;
        }
        let new_id = application_id(Some(&executable_path), executable_name, None);
        if new_id == old_id {
            continue;
        }

        tx.execute(
            "UPDATE tracking_rules SET application_id = ?1
             WHERE scope = 'application' AND application_id = ?2",
            params![new_id, old_id],
        )?;
        tx.execute(
            "UPDATE checkpoints SET application_id = ?1 WHERE application_id = ?2",
            params![new_id, old_id],
        )?;
        tx.execute(
            "UPDATE checkpoints SET context_id = ?1 WHERE context_id = ?2",
            params![new_id, old_id],
        )?;
        tx.execute(
            "INSERT OR IGNORE INTO workset_applications(workset_id, application_id)
             SELECT workset_id, ?1 FROM workset_applications WHERE application_id = ?2",
            params![new_id, old_id],
        )?;
        tx.execute(
            "DELETE FROM workset_applications WHERE application_id = ?1",
            [&old_id],
        )?;
        tx.execute(
            "UPDATE active_context_journal SET application_id = ?1
             WHERE application_id = ?2",
            params![new_id, old_id],
        )?;
        tx.execute(
            "UPDATE active_context_journal SET context_id = ?1
             WHERE context_id = ?2",
            params![new_id, old_id],
        )?;
    }
    tx.execute(
        "INSERT OR IGNORE INTO schema_migrations(version, applied_at_ms) VALUES (4, 0)",
        [],
    )?;
    tx.commit()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duplicate_executable_names_keep_distinct_path_identity() {
        let a = application_id(Some(r"C:\\Apps\\One\\worker.exe"), "worker.exe", None);
        let b = application_id(Some(r"D:\\Apps\\Two\\worker.exe"), "worker.exe", None);
        assert_ne!(a, b);
        assert!(a.starts_with("path:"));
        assert!(b.starts_with("path:"));
    }

    #[test]
    fn aumid_has_priority_over_path() {
        let id = application_id(
            Some(r"C:\\Program Files\\WindowsApps\\Demo\\demo.exe"),
            "demo.exe",
            Some("Demo.Package_123!App"),
        );
        assert_eq!(id, "aumid:demo.package_123!app");
    }
}
