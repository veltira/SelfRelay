use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const SCHEMA_VERSION: i64 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct JournalEntry {
    pub context_id: String,
    pub application_id: String,
    pub state: String,
    pub payload_json: String,
    pub updated_at_ms: i64,
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
            "INSERT OR IGNORE INTO schema_migrations(version, applied_at_ms) VALUES (?1, 0)",
            [SCHEMA_VERSION],
        )?;
        tx.commit()?;
    }

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

    #[test]
    fn migration_v1_is_idempotent() {
        let mut connection = Connection::open_in_memory().unwrap();
        apply_migrations(&mut connection).unwrap();
        apply_migrations(&mut connection).unwrap();
        let count: i64 = connection
            .query_row("SELECT COUNT(*) FROM schema_migrations WHERE version = 1", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn journal_round_trips_without_hwnd_or_pid_identity() {
        let mut connection = Connection::open_in_memory().unwrap();
        apply_migrations(&mut connection).unwrap();
        let entry = JournalEntry {
            context_id: "vscode:selfrelay".into(),
            application_id: "app:code.exe".into(),
            state: "active".into(),
            payload_json: serde_json::json!({"nextStep":"continue observer"}).to_string(),
            updated_at_ms: 42,
        };
        upsert_journal(&connection, &entry).unwrap();
        assert_eq!(load_journal(&connection, &entry.context_id).unwrap(), Some(entry));
    }
}
