use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const SCHEMA_VERSION: i64 = 2;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct JournalEntry {
    pub context_id: String,
    pub application_id: String,
    pub state: String,
    pub payload_json: String,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackedApplication {
    pub application_id: String,
    pub application_name: String,
    pub executable_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointRecord {
    pub id: i64,
    pub application_id: String,
    pub application_name: String,
    pub context_id: String,
    pub context_label: String,
    pub text: String,
    pub created_at_ms: u64,
    pub resolved_at_ms: Option<u64>,
}

pub fn initialize(path: &Path) -> rusqlite::Result<()> {
    let mut connection = Connection::open(path)?;
    apply_migrations(&mut connection)
}

pub fn apply_migrations(connection: &mut Connection) -> rusqlite::Result<()> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at_ms INTEGER NOT NULL
        );"
    )?;

    let current: i64 = connection.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get(0),
    )?;

    if current < 1 {
        let tx = connection.transaction()?;
        tx.execute_batch(
            "CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tracking_rules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scope TEXT NOT NULL CHECK(scope IN ('application', 'context')),
                application_id TEXT NOT NULL,
                context_id TEXT,
                enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
                created_at_ms INTEGER NOT NULL,
                UNIQUE(scope, application_id, context_id)
            );
            CREATE TABLE IF NOT EXISTS active_context_journal (
                context_id TEXT PRIMARY KEY,
                application_id TEXT NOT NULL,
                state TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                updated_at_ms INTEGER NOT NULL
            );
            INSERT OR IGNORE INTO settings(key, value) VALUES ('tracking_paused', '0');"
        )?;
        tx.execute(
            "INSERT OR IGNORE INTO schema_migrations(version, applied_at_ms) VALUES (1, 0)",
            [],
        )?;
        tx.commit()?;
    }

    let current: i64 = connection.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get(0),
    )?;

    if current < 2 {
        let tx = connection.transaction()?;
        tx.execute_batch(
            "ALTER TABLE tracking_rules ADD COLUMN application_name TEXT;
             ALTER TABLE tracking_rules ADD COLUMN executable_path TEXT;
             CREATE TABLE IF NOT EXISTS checkpoints (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                application_id TEXT NOT NULL,
                application_name TEXT NOT NULL,
                context_id TEXT NOT NULL,
                context_label TEXT NOT NULL,
                text TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                resolved_at_ms INTEGER
             );
             CREATE INDEX IF NOT EXISTS idx_checkpoints_context_pending
                ON checkpoints(context_id, resolved_at_ms, created_at_ms);
             INSERT OR IGNORE INTO settings(key, value) VALUES ('desktop_onboarding_completed', '0');"
        )?;
        tx.execute(
            "INSERT OR IGNORE INTO schema_migrations(version, applied_at_ms) VALUES (2, 0)",
            [],
        )?;
        tx.commit()?;
    }

    // Older D1 builds may already report schema v2 while missing this setting.
    // Repair the key without changing a user's existing completed value.
    connection.execute(
        "INSERT OR IGNORE INTO settings(key, value) VALUES ('desktop_onboarding_completed', '0')",
        [],
    )?;

    Ok(())
}

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    Connection::open(path)
}

pub fn onboarding_completed(connection: &Connection) -> rusqlite::Result<bool> {
    let value: Option<String> = connection.query_row(
        "SELECT value FROM settings WHERE key = 'desktop_onboarding_completed'",
        [],
        |row| row.get(0),
    ).optional()?;
    Ok(value.as_deref() == Some("1"))
}

pub fn set_onboarding_completed(connection: &Connection, completed: bool) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO settings(key, value) VALUES ('desktop_onboarding_completed', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [if completed { "1" } else { "0" }],
    )?;
    Ok(())
}

pub fn load_tracked_applications(connection: &Connection) -> rusqlite::Result<Vec<TrackedApplication>> {
    let mut statement = connection.prepare(
        "SELECT application_id, COALESCE(application_name, application_id), executable_path
         FROM tracking_rules
         WHERE scope = 'application' AND enabled = 1
         ORDER BY COALESCE(application_name, application_id) COLLATE NOCASE"
    )?;
    let rows = statement.query_map([], |row| {
        Ok(TrackedApplication {
            application_id: row.get(0)?,
            application_name: row.get(1)?,
            executable_path: row.get(2)?,
        })
    })?;
    rows.collect()
}

pub fn is_application_enabled(connection: &Connection, application_id: &str) -> rusqlite::Result<bool> {
    let enabled: Option<i64> = connection.query_row(
        "SELECT enabled FROM tracking_rules
         WHERE scope = 'application' AND application_id = ?1
         ORDER BY id DESC LIMIT 1",
        [application_id],
        |row| row.get(0),
    ).optional()?;
    Ok(enabled == Some(1))
}

pub fn set_application_tracking(
    connection: &Connection,
    application: &TrackedApplication,
    enabled: bool,
    now_ms: u64,
) -> rusqlite::Result<()> {
    connection.execute(
        "DELETE FROM tracking_rules WHERE scope = 'application' AND application_id = ?1",
        [&application.application_id],
    )?;
    if enabled {
        connection.execute(
            "INSERT INTO tracking_rules(
                scope, application_id, context_id, enabled, created_at_ms,
                application_name, executable_path
             ) VALUES ('application', ?1, NULL, 1, ?2, ?3, ?4)",
            params![
                application.application_id,
                now_ms as i64,
                application.application_name,
                application.executable_path,
            ],
        )?;
    }
    Ok(())
}

pub fn replace_application_tracking(
    connection: &mut Connection,
    applications: &[TrackedApplication],
    now_ms: u64,
) -> rusqlite::Result<()> {
    let tx = connection.transaction()?;
    tx.execute("DELETE FROM tracking_rules WHERE scope = 'application'", [])?;
    for application in applications {
        tx.execute(
            "INSERT INTO tracking_rules(
                scope, application_id, context_id, enabled, created_at_ms,
                application_name, executable_path
             ) VALUES ('application', ?1, NULL, 1, ?2, ?3, ?4)",
            params![
                application.application_id,
                now_ms as i64,
                application.application_name,
                application.executable_path,
            ],
        )?;
    }
    tx.commit()
}

pub fn insert_checkpoint(
    connection: &Connection,
    application_id: &str,
    application_name: &str,
    context_id: &str,
    context_label: &str,
    text: &str,
    created_at_ms: u64,
) -> rusqlite::Result<CheckpointRecord> {
    connection.execute(
        "INSERT INTO checkpoints(
            application_id, application_name, context_id, context_label, text, created_at_ms, resolved_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)",
        params![application_id, application_name, context_id, context_label, text, created_at_ms as i64],
    )?;
    let id = connection.last_insert_rowid();
    Ok(CheckpointRecord {
        id,
        application_id: application_id.to_string(),
        application_name: application_name.to_string(),
        context_id: context_id.to_string(),
        context_label: context_label.to_string(),
        text: text.to_string(),
        created_at_ms,
        resolved_at_ms: None,
    })
}

pub fn unresolved_for_context(connection: &Connection, context_id: &str) -> rusqlite::Result<Vec<CheckpointRecord>> {
    query_checkpoints(
        connection,
        "SELECT id, application_id, application_name, context_id, context_label, text, created_at_ms, resolved_at_ms
         FROM checkpoints
         WHERE context_id = ?1 AND resolved_at_ms IS NULL
         ORDER BY created_at_ms ASC, id ASC",
        Some(context_id),
    )
}

pub fn checkpoint_history(connection: &Connection) -> rusqlite::Result<Vec<CheckpointRecord>> {
    query_checkpoints(
        connection,
        "SELECT id, application_id, application_name, context_id, context_label, text, created_at_ms, resolved_at_ms
         FROM checkpoints
         ORDER BY created_at_ms DESC, id DESC",
        None,
    )
}

fn query_checkpoints(
    connection: &Connection,
    sql: &str,
    context_id: Option<&str>,
) -> rusqlite::Result<Vec<CheckpointRecord>> {
    let mut statement = connection.prepare(sql)?;
    let map_row = |row: &rusqlite::Row<'_>| -> rusqlite::Result<CheckpointRecord> {
        Ok(CheckpointRecord {
            id: row.get(0)?,
            application_id: row.get(1)?,
            application_name: row.get(2)?,
            context_id: row.get(3)?,
            context_label: row.get(4)?,
            text: row.get(5)?,
            created_at_ms: row.get::<_, i64>(6)? as u64,
            resolved_at_ms: row.get::<_, Option<i64>>(7)?.map(|value| value as u64),
        })
    };
    let rows = match context_id {
        Some(value) => statement.query_map([value], map_row)?.collect::<rusqlite::Result<Vec<_>>>()?,
        None => statement.query_map([], map_row)?.collect::<rusqlite::Result<Vec<_>>>()?,
    };
    Ok(rows)
}

pub fn resolve_checkpoint(connection: &Connection, id: i64, resolved_at_ms: u64) -> rusqlite::Result<()> {
    connection.execute(
        "UPDATE checkpoints SET resolved_at_ms = COALESCE(resolved_at_ms, ?2) WHERE id = ?1",
        params![id, resolved_at_ms as i64],
    )?;
    Ok(())
}

pub fn upsert_journal(connection: &Connection, entry: &JournalEntry) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO active_context_journal(context_id, application_id, state, payload_json, updated_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(context_id) DO UPDATE SET
            application_id = excluded.application_id,
            state = excluded.state,
            payload_json = excluded.payload_json,
            updated_at_ms = excluded.updated_at_ms",
        params![
            entry.context_id,
            entry.application_id,
            entry.state,
            entry.payload_json,
            entry.updated_at_ms
        ],
    )?;
    Ok(())
}

pub fn load_journal(connection: &Connection, context_id: &str) -> rusqlite::Result<Option<JournalEntry>> {
    connection
        .query_row(
            "SELECT context_id, application_id, state, payload_json, updated_at_ms
             FROM active_context_journal WHERE context_id = ?1",
            [context_id],
            |row| {
                Ok(JournalEntry {
                    context_id: row.get(0)?,
                    application_id: row.get(1)?,
                    state: row.get(2)?,
                    payload_json: row.get(3)?,
                    updated_at_ms: row.get(4)?,
                })
            },
        )
        .optional()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, time::{SystemTime, UNIX_EPOCH}};

    fn app(id: &str, name: &str) -> TrackedApplication {
        TrackedApplication {
            application_id: id.into(),
            application_name: name.into(),
            executable_path: Some(format!("C:/Windows/{name}.exe")),
        }
    }

    #[test]
    fn migrations_are_idempotent_through_v2() {
        let mut connection = Connection::open_in_memory().unwrap();
        apply_migrations(&mut connection).unwrap();
        apply_migrations(&mut connection).unwrap();
        let max_version: i64 = connection
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| row.get(0))
            .unwrap();
        assert_eq!(max_version, SCHEMA_VERSION);
    }

    #[test]
    fn fresh_install_starts_with_onboarding_incomplete_and_zero_tracked_apps() {
        let mut connection = Connection::open_in_memory().unwrap();
        apply_migrations(&mut connection).unwrap();
        assert!(!onboarding_completed(&connection).unwrap());
        assert!(load_tracked_applications(&connection).unwrap().is_empty());
    }

    #[test]
    fn missing_onboarding_setting_is_repaired_without_resetting_schema() {
        let mut connection = Connection::open_in_memory().unwrap();
        apply_migrations(&mut connection).unwrap();
        connection.execute("DELETE FROM settings WHERE key = 'desktop_onboarding_completed'", []).unwrap();
        apply_migrations(&mut connection).unwrap();
        assert!(!onboarding_completed(&connection).unwrap());
        let value: String = connection.query_row(
            "SELECT value FROM settings WHERE key = 'desktop_onboarding_completed'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(value, "0");
    }

    #[test]
    fn application_selection_add_remove_and_readd_is_authoritative() {
        let mut connection = Connection::open_in_memory().unwrap();
        apply_migrations(&mut connection).unwrap();
        let a = app("app:notepad.exe", "Notepad");
        let b = app("app:discord.exe", "Discord");
        assert!(!is_application_enabled(&connection, &a.application_id).unwrap());
        set_application_tracking(&connection, &a, true, 1).unwrap();
        assert!(is_application_enabled(&connection, &a.application_id).unwrap());
        assert!(!is_application_enabled(&connection, &b.application_id).unwrap());
        set_application_tracking(&connection, &a, false, 2).unwrap();
        assert!(!is_application_enabled(&connection, &a.application_id).unwrap());
        set_application_tracking(&connection, &a, true, 3).unwrap();
        assert!(is_application_enabled(&connection, &a.application_id).unwrap());
    }

    #[test]
    fn application_selection_persists_across_restart() {
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let path = std::env::temp_dir().join(format!("selfrelay-selection-{nonce}.db"));
        initialize(&path).unwrap();
        {
            let connection = Connection::open(&path).unwrap();
            set_application_tracking(&connection, &app("app:notepad.exe", "Notepad"), true, 1).unwrap();
            set_onboarding_completed(&connection, true).unwrap();
        }
        {
            let connection = Connection::open(&path).unwrap();
            assert!(is_application_enabled(&connection, "app:notepad.exe").unwrap());
            assert!(onboarding_completed(&connection).unwrap());
        }
        let _ = fs::remove_file(path);
    }

    #[test]
    fn unresolved_checkpoints_accumulate_and_resolve_individually() {
        let mut connection = Connection::open_in_memory().unwrap();
        apply_migrations(&mut connection).unwrap();
        let a = insert_checkpoint(&connection, "app:notepad.exe", "Notepad", "app:notepad.exe", "Notepad", "A", 10).unwrap();
        let b = insert_checkpoint(&connection, "app:notepad.exe", "Notepad", "app:notepad.exe", "Notepad", "B", 20).unwrap();
        let pending = unresolved_for_context(&connection, "app:notepad.exe").unwrap();
        assert_eq!(pending.iter().map(|item| item.text.as_str()).collect::<Vec<_>>(), vec!["A", "B"]);
        resolve_checkpoint(&connection, a.id, 30).unwrap();
        let remaining = unresolved_for_context(&connection, "app:notepad.exe").unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, b.id);
    }

    #[test]
    fn journal_round_trips_without_hwnd_or_pid_identity() {
        let mut connection = Connection::open_in_memory().unwrap();
        apply_migrations(&mut connection).unwrap();
        let entry = JournalEntry {
            context_id: "app:notepad.exe".into(),
            application_id: "app:notepad.exe".into(),
            state: "active".into(),
            payload_json: serde_json::json!({"nextStep":"continue"}).to_string(),
            updated_at_ms: 42,
        };
        upsert_journal(&connection, &entry).unwrap();
        assert_eq!(load_journal(&connection, &entry.context_id).unwrap(), Some(entry));
    }
}
