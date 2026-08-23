use crate::lifecycle::ContextSnapshot;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{path::Path, sync::atomic::{AtomicU64, Ordering}};

static CAPTURE_SEQUENCE: AtomicU64 = AtomicU64::new(1);
const DEDUPE_WINDOW_MS: u64 = 4_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingCapture {
    pub id: String,
    pub application_id: String,
    pub application_name: String,
    pub context_id: String,
    pub context_label: String,
    pub created_at_ms: u64,
}

impl PendingCapture {
    pub fn snapshot(&self) -> ContextSnapshot {
        ContextSnapshot {
            application_id: self.application_id.clone(),
            application_name: self.application_name.clone(),
            context_id: self.context_id.clone(),
            context_label: self.context_label.clone(),
        }
    }
}

pub fn initialize(db_path: &Path) -> rusqlite::Result<()> {
    let connection = Connection::open(db_path)?;
    connection.busy_timeout(std::time::Duration::from_secs(3))?;
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS pending_captures (
            id TEXT PRIMARY KEY,
            application_id TEXT NOT NULL,
            application_name TEXT NOT NULL,
            context_id TEXT NOT NULL,
            context_label TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_pending_captures_order
            ON pending_captures(created_at_ms, id);
         CREATE TABLE IF NOT EXISTS desktop_diagnostics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event TEXT NOT NULL,
            detail TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL
         );
         INSERT OR IGNORE INTO schema_migrations(version, applied_at_ms) VALUES (5, 0);",
    )?;
    Ok(())
}

pub fn enqueue(
    connection: &Connection,
    snapshot: &ContextSnapshot,
    created_at_ms: u64,
) -> rusqlite::Result<PendingCapture> {
    // Lifecycle already suppresses normal destroy/recreate races. This durable
    // guard is intentionally independent: if Windows emits a second equivalent
    // exit through another HWND/event path, do not make the user dismiss the
    // same capture twice. A real later interruption is preserved once the first
    // pending row is consumed, or once this short race window has elapsed.
    let lower_bound = created_at_ms.saturating_sub(DEDUPE_WINDOW_MS) as i64;
    if let Some(existing) = connection
        .query_row(
            "SELECT id, application_id, application_name, context_id, context_label, created_at_ms
             FROM pending_captures
             WHERE application_id = ?1 AND context_id = ?2 AND created_at_ms >= ?3
             ORDER BY created_at_ms DESC, id DESC
             LIMIT 1",
            params![snapshot.application_id, snapshot.context_id, lower_bound],
            map_capture,
        )
        .optional()?
    {
        return Ok(existing);
    }

    let sequence = CAPTURE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let capture = PendingCapture {
        id: format!("capture:{created_at_ms}:{sequence}"),
        application_id: snapshot.application_id.clone(),
        application_name: snapshot.application_name.clone(),
        context_id: snapshot.context_id.clone(),
        context_label: snapshot.context_label.clone(),
        created_at_ms,
    };
    connection.execute(
        "INSERT INTO pending_captures(
            id, application_id, application_name, context_id, context_label, created_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            capture.id,
            capture.application_id,
            capture.application_name,
            capture.context_id,
            capture.context_label,
            capture.created_at_ms as i64,
        ],
    )?;
    Ok(capture)
}

fn map_capture(row: &rusqlite::Row<'_>) -> rusqlite::Result<PendingCapture> {
    Ok(PendingCapture {
        id: row.get(0)?,
        application_id: row.get(1)?,
        application_name: row.get(2)?,
        context_id: row.get(3)?,
        context_label: row.get(4)?,
        created_at_ms: row.get::<_, i64>(5)? as u64,
    })
}

pub fn oldest(connection: &Connection) -> rusqlite::Result<Option<PendingCapture>> {
    connection
        .query_row(
            "SELECT id, application_id, application_name, context_id, context_label, created_at_ms
             FROM pending_captures
             ORDER BY created_at_ms ASC, id ASC
             LIMIT 1",
            [],
            map_capture,
        )
        .optional()
}

pub fn by_id(connection: &Connection, id: &str) -> rusqlite::Result<Option<PendingCapture>> {
    connection
        .query_row(
            "SELECT id, application_id, application_name, context_id, context_label, created_at_ms
             FROM pending_captures WHERE id = ?1",
            [id],
            map_capture,
        )
        .optional()
}

pub fn all(connection: &Connection) -> rusqlite::Result<Vec<PendingCapture>> {
    let mut statement = connection.prepare(
        "SELECT id, application_id, application_name, context_id, context_label, created_at_ms
         FROM pending_captures ORDER BY created_at_ms ASC, id ASC",
    )?;
    let rows = statement
        .query_map([], map_capture)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn consume(connection: &Connection, id: &str) -> rusqlite::Result<bool> {
    Ok(connection.execute("DELETE FROM pending_captures WHERE id = ?1", [id])? == 1)
}

pub fn count(connection: &Connection) -> rusqlite::Result<usize> {
    connection.query_row("SELECT COUNT(*) FROM pending_captures", [], |row| {
        row.get::<_, i64>(0).map(|value| value as usize)
    })
}

pub fn diagnostic(
    connection: &Connection,
    event: &str,
    detail: &str,
    created_at_ms: u64,
) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO desktop_diagnostics(event, detail, created_at_ms) VALUES (?1, ?2, ?3)",
        params![event, detail, created_at_ms as i64],
    )?;
    connection.execute(
        "DELETE FROM desktop_diagnostics
         WHERE id NOT IN (SELECT id FROM desktop_diagnostics ORDER BY id DESC LIMIT 200)",
        [],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(app: &str, context: &str) -> ContextSnapshot {
        ContextSnapshot {
            application_id: app.into(),
            application_name: app.into(),
            context_id: context.into(),
            context_label: context.into(),
        }
    }

    fn initialized_connection() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(
            "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at_ms INTEGER NOT NULL);
             CREATE TABLE pending_captures (
                id TEXT PRIMARY KEY, application_id TEXT NOT NULL, application_name TEXT NOT NULL,
                context_id TEXT NOT NULL, context_label TEXT NOT NULL, created_at_ms INTEGER NOT NULL
             );
             CREATE INDEX idx_pending_captures_order ON pending_captures(created_at_ms, id);",
        ).unwrap();
        connection
    }

    #[test]
    fn durable_queue_consumes_exact_id_only() {
        let connection = initialized_connection();
        let a = enqueue(&connection, &snapshot("notepad", "a"), 10).unwrap();
        let b = enqueue(&connection, &snapshot("paint", "b"), 11).unwrap();
        assert_eq!(oldest(&connection).unwrap().unwrap().id, a.id);
        assert!(consume(&connection, &b.id).unwrap());
        assert_eq!(oldest(&connection).unwrap().unwrap().id, a.id);
        assert_eq!(count(&connection).unwrap(), 1);
    }

    #[test]
    fn rapid_duplicate_exit_reuses_existing_pending_capture() {
        let connection = initialized_connection();
        let first = enqueue(&connection, &snapshot("notepad", "note"), 10_000).unwrap();
        let duplicate = enqueue(&connection, &snapshot("notepad", "note"), 10_300).unwrap();
        assert_eq!(duplicate.id, first.id);
        assert_eq!(count(&connection).unwrap(), 1);
    }

    #[test]
    fn later_real_exit_is_preserved_after_dedupe_window() {
        let connection = initialized_connection();
        let first = enqueue(&connection, &snapshot("notepad", "note"), 10_000).unwrap();
        let later = enqueue(&connection, &snapshot("notepad", "note"), 15_000).unwrap();
        assert_ne!(later.id, first.id);
        assert_eq!(count(&connection).unwrap(), 2);
    }
}
