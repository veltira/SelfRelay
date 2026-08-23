use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const SCHEMA_VERSION: i64 = 4;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackedApplication {
    pub application_id: String,
    pub application_name: String,
    pub executable_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorksetRecord {
    pub id: String,
    pub name: String,
    pub application_ids: Vec<String>,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointRecord {
    pub id: i64,
    pub application_id: String,
    pub application_name: String,
    pub context_id: String,
    pub context_label: String,
    pub workset_id: Option<String>,
    pub text: String,
    pub audio_path: Option<String>,
    pub transcript: Option<String>,
    pub created_at_ms: u64,
    pub resolved_at_ms: Option<u64>,
}

pub fn initialize(path: &Path) -> rusqlite::Result<()> {
    let mut connection = Connection::open(path)?;
    apply_migrations(&mut connection)
}

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    Connection::open(path)
}

pub fn apply_migrations(connection: &mut Connection) -> rusqlite::Result<()> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at_ms INTEGER NOT NULL
        );",
    )?;

    let current = schema_version(connection)?;
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
            INSERT OR IGNORE INTO settings(key, value) VALUES ('tracking_paused', '0');",
        )?;
        tx.execute(
            "INSERT OR IGNORE INTO schema_migrations(version, applied_at_ms) VALUES (1, 0)",
            [],
        )?;
        tx.commit()?;
    }

    if schema_version(connection)? < 2 {
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
             INSERT OR IGNORE INTO settings(key, value) VALUES ('desktop_onboarding_completed', '0');",
        )?;
        tx.execute(
            "INSERT OR IGNORE INTO schema_migrations(version, applied_at_ms) VALUES (2, 0)",
            [],
        )?;
        tx.commit()?;
    }

    if schema_version(connection)? < 3 {
        let tx = connection.transaction()?;
        tx.execute_batch(
            "ALTER TABLE checkpoints ADD COLUMN workset_id TEXT;
             ALTER TABLE checkpoints ADD COLUMN audio_path TEXT;
             ALTER TABLE checkpoints ADD COLUMN transcript TEXT;
             CREATE TABLE IF NOT EXISTS worksets (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS workset_applications (
                workset_id TEXT NOT NULL,
                application_id TEXT NOT NULL,
                PRIMARY KEY(workset_id, application_id),
                FOREIGN KEY(workset_id) REFERENCES worksets(id) ON DELETE CASCADE
             );
             CREATE INDEX IF NOT EXISTS idx_workset_apps_application
                ON workset_applications(application_id, workset_id);
             CREATE INDEX IF NOT EXISTS idx_checkpoints_workset_pending
                ON checkpoints(workset_id, resolved_at_ms, created_at_ms);
             INSERT OR IGNORE INTO settings(key, value) VALUES ('launch_at_startup', '0');",
        )?;
        tx.execute(
            "INSERT OR IGNORE INTO schema_migrations(version, applied_at_ms) VALUES (3, 0)",
            [],
        )?;
        tx.commit()?;
    }

    if schema_version(connection)? < 4 {
        let tx = connection.transaction()?;
        tx.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_checkpoints_application_history
                ON checkpoints(application_id, created_at_ms, id);
             CREATE INDEX IF NOT EXISTS idx_checkpoints_workset_history
                ON checkpoints(workset_id, created_at_ms, id);
             INSERT OR IGNORE INTO settings(key, value) VALUES ('archive_resolved_checkpoints', '1');",
        )?;
        tx.execute(
            "INSERT OR IGNORE INTO schema_migrations(version, applied_at_ms) VALUES (4, 0)",
            [],
        )?;
        tx.commit()?;
    }

    connection.execute(
        "INSERT OR IGNORE INTO settings(key, value) VALUES ('desktop_onboarding_completed', '0')",
        [],
    )?;
    connection.execute(
        "INSERT OR IGNORE INTO settings(key, value) VALUES ('launch_at_startup', '0')",
        [],
    )?;
    connection.execute(
        "INSERT OR IGNORE INTO settings(key, value) VALUES ('archive_resolved_checkpoints', '1')",
        [],
    )?;
    Ok(())
}

fn schema_version(connection: &Connection) -> rusqlite::Result<i64> {
    connection.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get(0),
    )
}

pub fn bool_setting(connection: &Connection, key: &str) -> rusqlite::Result<bool> {
    let value: Option<String> = connection
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| row.get(0))
        .optional()?;
    Ok(value.as_deref() == Some("1"))
}

pub fn set_bool_setting(connection: &Connection, key: &str, value: bool) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO settings(key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, if value { "1" } else { "0" }],
    )?;
    Ok(())
}

pub fn onboarding_completed(connection: &Connection) -> rusqlite::Result<bool> {
    bool_setting(connection, "desktop_onboarding_completed")
}

pub fn set_onboarding_completed(connection: &Connection, completed: bool) -> rusqlite::Result<()> {
    set_bool_setting(connection, "desktop_onboarding_completed", completed)
}

pub fn load_tracked_applications(connection: &Connection) -> rusqlite::Result<Vec<TrackedApplication>> {
    let mut statement = connection.prepare(
        "SELECT application_id, COALESCE(application_name, application_id), executable_path
         FROM tracking_rules
         WHERE scope = 'application' AND enabled = 1
         ORDER BY COALESCE(application_name, application_id) COLLATE NOCASE",
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
    let enabled: Option<i64> = connection
        .query_row(
            "SELECT enabled FROM tracking_rules
             WHERE scope = 'application' AND application_id = ?1
             ORDER BY id DESC LIMIT 1",
            [application_id],
            |row| row.get(0),
        )
        .optional()?;
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

pub fn load_worksets(connection: &Connection) -> rusqlite::Result<Vec<WorksetRecord>> {
    let mut statement = connection.prepare(
        "SELECT id, name, created_at_ms, updated_at_ms FROM worksets
         ORDER BY updated_at_ms DESC, name COLLATE NOCASE",
    )?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)? as u64,
                row.get::<_, i64>(3)? as u64,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    rows.into_iter()
        .map(|(id, name, created_at_ms, updated_at_ms)| {
            let mut members = connection.prepare(
                "SELECT application_id FROM workset_applications
                 WHERE workset_id = ?1 ORDER BY application_id COLLATE NOCASE",
            )?;
            let application_ids = members
                .query_map([&id], |row| row.get(0))?
                .collect::<rusqlite::Result<Vec<String>>>()?;
            Ok(WorksetRecord { id, name, application_ids, created_at_ms, updated_at_ms })
        })
        .collect()
}

pub fn create_workset(
    connection: &mut Connection,
    id: &str,
    name: &str,
    application_ids: &[String],
    now_ms: u64,
) -> rusqlite::Result<WorksetRecord> {
    let tx = connection.transaction()?;
    tx.execute(
        "INSERT INTO worksets(id, name, created_at_ms, updated_at_ms) VALUES (?1, ?2, ?3, ?3)",
        params![id, name, now_ms as i64],
    )?;
    replace_workset_members_tx(&tx, id, application_ids)?;
    tx.commit()?;
    Ok(WorksetRecord {
        id: id.to_string(),
        name: name.to_string(),
        application_ids: application_ids.to_vec(),
        created_at_ms: now_ms,
        updated_at_ms: now_ms,
    })
}

pub fn rename_workset(connection: &Connection, id: &str, name: &str, now_ms: u64) -> rusqlite::Result<()> {
    connection.execute(
        "UPDATE worksets SET name = ?2, updated_at_ms = ?3 WHERE id = ?1",
        params![id, name, now_ms as i64],
    )?;
    Ok(())
}

pub fn set_workset_applications(
    connection: &mut Connection,
    id: &str,
    application_ids: &[String],
    now_ms: u64,
) -> rusqlite::Result<()> {
    let tx = connection.transaction()?;
    replace_workset_members_tx(&tx, id, application_ids)?;
    tx.execute(
        "UPDATE worksets SET updated_at_ms = ?2 WHERE id = ?1",
        params![id, now_ms as i64],
    )?;
    tx.commit()
}

fn replace_workset_members_tx(
    tx: &rusqlite::Transaction<'_>,
    id: &str,
    application_ids: &[String],
) -> rusqlite::Result<()> {
    tx.execute("DELETE FROM workset_applications WHERE workset_id = ?1", [id])?;
    for application_id in application_ids {
        tx.execute(
            "INSERT OR IGNORE INTO workset_applications(workset_id, application_id) VALUES (?1, ?2)",
            params![id, application_id],
        )?;
    }
    Ok(())
}

pub fn delete_workset(connection: &Connection, id: &str) -> rusqlite::Result<()> {
    connection.execute("DELETE FROM workset_applications WHERE workset_id = ?1", [id])?;
    connection.execute("DELETE FROM worksets WHERE id = ?1", [id])?;
    Ok(())
}

pub fn worksets_for_application(connection: &Connection, application_id: &str) -> rusqlite::Result<Vec<WorksetRecord>> {
    let all = load_worksets(connection)?;
    Ok(all
        .into_iter()
        .filter(|workset| workset.application_ids.iter().any(|item| item == application_id))
        .collect())
}

pub fn insert_checkpoint(
    connection: &Connection,
    application_id: &str,
    application_name: &str,
    context_id: &str,
    context_label: &str,
    workset_id: Option<&str>,
    text: &str,
    audio_path: Option<&str>,
    created_at_ms: u64,
) -> rusqlite::Result<CheckpointRecord> {
    connection.execute(
        "INSERT INTO checkpoints(
            application_id, application_name, context_id, context_label,
            workset_id, text, audio_path, transcript, created_at_ms, resolved_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8, NULL)",
        params![
            application_id,
            application_name,
            context_id,
            context_label,
            workset_id,
            text,
            audio_path,
            created_at_ms as i64,
        ],
    )?;
    Ok(CheckpointRecord {
        id: connection.last_insert_rowid(),
        application_id: application_id.to_string(),
        application_name: application_name.to_string(),
        context_id: context_id.to_string(),
        context_label: context_label.to_string(),
        workset_id: workset_id.map(str::to_string),
        text: text.to_string(),
        audio_path: audio_path.map(str::to_string),
        transcript: None,
        created_at_ms,
        resolved_at_ms: None,
    })
}

pub fn unresolved_for_context(connection: &Connection, context_id: &str) -> rusqlite::Result<Vec<CheckpointRecord>> {
    query_checkpoints(
        connection,
        "SELECT id, application_id, application_name, context_id, context_label,
                workset_id, text, audio_path, transcript, created_at_ms, resolved_at_ms
         FROM checkpoints
         WHERE workset_id IS NULL AND context_id = ?1 AND resolved_at_ms IS NULL
         ORDER BY created_at_ms ASC, id ASC",
        Some(context_id),
    )
}

pub fn unresolved_for_workset(connection: &Connection, workset_id: &str) -> rusqlite::Result<Vec<CheckpointRecord>> {
    query_checkpoints(
        connection,
        "SELECT id, application_id, application_name, context_id, context_label,
                workset_id, text, audio_path, transcript, created_at_ms, resolved_at_ms
         FROM checkpoints
         WHERE workset_id = ?1 AND resolved_at_ms IS NULL
         ORDER BY created_at_ms ASC, id ASC",
        Some(workset_id),
    )
}

pub fn checkpoint_history(connection: &Connection) -> rusqlite::Result<Vec<CheckpointRecord>> {
    query_checkpoints(
        connection,
        "SELECT id, application_id, application_name, context_id, context_label,
                workset_id, text, audio_path, transcript, created_at_ms, resolved_at_ms
         FROM checkpoints
         ORDER BY created_at_ms DESC, id DESC",
        None,
    )
}

pub fn checkpoint_by_id(connection: &Connection, id: i64) -> rusqlite::Result<Option<CheckpointRecord>> {
    let mut statement = connection.prepare(
        "SELECT id, application_id, application_name, context_id, context_label,
                workset_id, text, audio_path, transcript, created_at_ms, resolved_at_ms
         FROM checkpoints WHERE id = ?1",
    )?;
    statement.query_row([id], map_checkpoint).optional()
}

fn query_checkpoints(
    connection: &Connection,
    sql: &str,
    value: Option<&str>,
) -> rusqlite::Result<Vec<CheckpointRecord>> {
    let mut statement = connection.prepare(sql)?;
    match value {
        Some(value) => statement
            .query_map([value], map_checkpoint)?
            .collect::<rusqlite::Result<Vec<_>>>(),
        None => statement
            .query_map([], map_checkpoint)?
            .collect::<rusqlite::Result<Vec<_>>>(),
    }
}

fn map_checkpoint(row: &rusqlite::Row<'_>) -> rusqlite::Result<CheckpointRecord> {
    Ok(CheckpointRecord {
        id: row.get(0)?,
        application_id: row.get(1)?,
        application_name: row.get(2)?,
        context_id: row.get(3)?,
        context_label: row.get(4)?,
        workset_id: row.get(5)?,
        text: row.get(6)?,
        audio_path: row.get(7)?,
        transcript: row.get(8)?,
        created_at_ms: row.get::<_, i64>(9)? as u64,
        resolved_at_ms: row.get::<_, Option<i64>>(10)?.map(|value| value as u64),
    })
}

pub fn set_checkpoint_transcript(connection: &Connection, id: i64, transcript: &str) -> rusqlite::Result<()> {
    connection.execute(
        "UPDATE checkpoints SET transcript = ?2 WHERE id = ?1",
        params![id, transcript],
    )?;
    Ok(())
}

pub fn resolve_checkpoint(connection: &Connection, id: i64, resolved_at_ms: u64) -> rusqlite::Result<()> {
    connection.execute(
        "UPDATE checkpoints SET resolved_at_ms = COALESCE(resolved_at_ms, ?2) WHERE id = ?1",
        params![id, resolved_at_ms as i64],
    )?;
    Ok(())
}

pub fn delete_checkpoint(connection: &Connection, id: i64) -> rusqlite::Result<Option<String>> {
    let audio_path: Option<String> = connection
        .query_row("SELECT audio_path FROM checkpoints WHERE id = ?1", [id], |row| row.get(0))
        .optional()?
        .flatten();
    connection.execute("DELETE FROM checkpoints WHERE id = ?1", [id])?;
    Ok(audio_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, time::{SystemTime, UNIX_EPOCH}};

    fn app(id: &str, name: &str) -> TrackedApplication {
        TrackedApplication {
            application_id: id.into(),
            application_name: name.into(),
            executable_path: Some(format!("C:/Apps/{name}.exe")),
        }
    }

    #[test]
    fn migrations_are_idempotent_through_current_schema() {
        let mut connection = Connection::open_in_memory().unwrap();
        apply_migrations(&mut connection).unwrap();
        apply_migrations(&mut connection).unwrap();
        assert_eq!(schema_version(&connection).unwrap(), SCHEMA_VERSION);
        assert!(bool_setting(&connection, "archive_resolved_checkpoints").unwrap());
    }

    #[test]
    fn fresh_install_starts_with_zero_tracking() {
        let mut connection = Connection::open_in_memory().unwrap();
        apply_migrations(&mut connection).unwrap();
        assert!(!onboarding_completed(&connection).unwrap());
        assert!(load_tracked_applications(&connection).unwrap().is_empty());
    }

    #[test]
    fn application_selection_persists_across_restart() {
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let path = std::env::temp_dir().join(format!("selfrelay-selection-{nonce}.db"));
        initialize(&path).unwrap();
        {
            let connection = open(&path).unwrap();
            set_application_tracking(&connection, &app("app:notepad.exe", "Notepad"), true, 1).unwrap();
            set_onboarding_completed(&connection, true).unwrap();
        }
        {
            let connection = open(&path).unwrap();
            assert!(is_application_enabled(&connection, "app:notepad.exe").unwrap());
            assert!(onboarding_completed(&connection).unwrap());
        }
        let _ = fs::remove_file(path);
    }

    #[test]
    fn worksets_create_rename_membership_and_delete() {
        let mut connection = Connection::open_in_memory().unwrap();
        apply_migrations(&mut connection).unwrap();
        let members = vec!["app:notepad.exe".to_string(), "app:mspaint.exe".to_string()];
        create_workset(&mut connection, "ws:1", "Proyecto CoderCup", &members, 10).unwrap();
        let loaded = load_worksets(&connection).unwrap();
        assert_eq!(loaded[0].application_ids.len(), 2);
        rename_workset(&connection, "ws:1", "CoderCup", 20).unwrap();
        set_workset_applications(&mut connection, "ws:1", &["app:notepad.exe".into()], 30).unwrap();
        assert_eq!(worksets_for_application(&connection, "app:notepad.exe").unwrap().len(), 1);
        delete_workset(&connection, "ws:1").unwrap();
        assert!(load_worksets(&connection).unwrap().is_empty());
    }

    #[test]
    fn checkpoints_keep_order_audio_transcript_and_individual_resolution() {
        let mut connection = Connection::open_in_memory().unwrap();
        apply_migrations(&mut connection).unwrap();
        let a = insert_checkpoint(
            &connection,
            "app:notepad.exe",
            "Notepad",
            "app:notepad.exe",
            "Notepad",
            None,
            "A",
            Some("audio/a.wav"),
            10,
        ).unwrap();
        let b = insert_checkpoint(
            &connection,
            "app:notepad.exe",
            "Notepad",
            "app:notepad.exe",
            "Notepad",
            None,
            "B",
            None,
            20,
        ).unwrap();
        let pending = unresolved_for_context(&connection, "app:notepad.exe").unwrap();
        assert_eq!(pending.iter().map(|item| item.text.as_str()).collect::<Vec<_>>(), vec!["A", "B"]);
        set_checkpoint_transcript(&connection, a.id, "transcripción local").unwrap();
        resolve_checkpoint(&connection, a.id, 30).unwrap();
        resolve_checkpoint(&connection, a.id, 40).unwrap();
        let pending = unresolved_for_context(&connection, "app:notepad.exe").unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].id, b.id);
        let loaded = checkpoint_by_id(&connection, a.id).unwrap().unwrap();
        assert_eq!(loaded.transcript.as_deref(), Some("transcripción local"));
        assert_eq!(loaded.resolved_at_ms, Some(30));
    }

    #[test]
    fn workset_checkpoints_are_recovered_separately_from_context() {
        let mut connection = Connection::open_in_memory().unwrap();
        apply_migrations(&mut connection).unwrap();
        insert_checkpoint(
            &connection,
            "app:notepad.exe",
            "Notepad",
            "app:notepad.exe",
            "Notepad",
            Some("ws:coder"),
            "Workset",
            None,
            1,
        ).unwrap();
        assert!(unresolved_for_context(&connection, "app:notepad.exe").unwrap().is_empty());
        assert_eq!(unresolved_for_workset(&connection, "ws:coder").unwrap().len(), 1);
    }
}
