use crate::{capture_store::{self, PendingCapture}, lifecycle::ContextSnapshot, storage::{self, CheckpointRecord}};
use std::{path::{Path, PathBuf}, sync::Mutex};

/// Binds the single capture surface to one durable pending-capture ID.
/// Rows live in SQLite; `visible_id` only records which durable row the UI is
/// currently presenting. Recreating this coordinator simply binds the oldest row.
pub struct CaptureCoordinator {
    db_path: PathBuf,
    visible_id: Mutex<Option<String>>,
}

impl CaptureCoordinator {
    pub fn new(db_path: &Path) -> Self {
        Self { db_path: db_path.to_path_buf(), visible_id: Mutex::new(None) }
    }

    fn connection(&self) -> Result<rusqlite::Connection, String> {
        storage::open(&self.db_path).map_err(|error| error.to_string())
    }

    pub fn enqueue(&self, snapshot: &ContextSnapshot, created_at_ms: u64) -> Result<PendingCapture, String> {
        let connection = self.connection()?;
        let inserted = capture_store::enqueue(&connection, snapshot, created_at_ms)
            .map_err(|error| error.to_string())?;
        if capture_store::by_id(&connection, &inserted.id)
            .map_err(|error| error.to_string())?
            .is_none()
        {
            return Err("La captura no pudo quedar persistida antes de abrir la ventana.".into());
        }
        drop(connection);
        // Bind the oldest durable item, not necessarily the newly inserted one.
        let _ = self.current()?;
        Ok(inserted)
    }

    pub fn current(&self) -> Result<Option<PendingCapture>, String> {
        let connection = self.connection()?;
        let mut visible = self.visible_id.lock().map_err(|_| "capture binding lock poisoned".to_string())?;
        if let Some(id) = visible.as_deref() {
            if let Some(capture) = capture_store::by_id(&connection, id).map_err(|error| error.to_string())? {
                return Ok(Some(capture));
            }
            *visible = None;
        }
        let oldest = capture_store::oldest(&connection).map_err(|error| error.to_string())?;
        *visible = oldest.as_ref().map(|capture| capture.id.clone());
        Ok(oldest)
    }

    fn require_bound(&self, connection: &rusqlite::Connection, capture_id: &str) -> Result<PendingCapture, String> {
        let mut visible = self.visible_id.lock().map_err(|_| "capture binding lock poisoned".to_string())?;
        if visible.is_none() {
            *visible = capture_store::oldest(connection)
                .map_err(|error| error.to_string())?
                .map(|capture| capture.id);
        }
        if visible.as_deref() != Some(capture_id) {
            return Err("Ese checkpoint ya no es la captura que está mostrando SelfRelay.".into());
        }
        capture_store::by_id(connection, capture_id)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "La captura pendiente ya no existe.".to_string())
    }

    fn advance_after(&self, consumed_id: &str) -> Result<Option<PendingCapture>, String> {
        let connection = self.connection()?;
        let next = capture_store::oldest(&connection).map_err(|error| error.to_string())?;
        let mut visible = self.visible_id.lock().map_err(|_| "capture binding lock poisoned".to_string())?;
        if visible.as_deref() == Some(consumed_id) || visible.is_none() {
            *visible = next.as_ref().map(|capture| capture.id.clone());
        }
        Ok(next)
    }

    pub fn discard_exact(&self, capture_id: &str) -> Result<Option<PendingCapture>, String> {
        let mut connection = self.connection()?;
        let tx = connection.transaction().map_err(|error| error.to_string())?;
        let _capture = self.require_bound(&tx, capture_id)?;
        if !capture_store::consume(&tx, capture_id).map_err(|error| error.to_string())? {
            return Err("La captura pendiente ya no existe.".into());
        }
        tx.commit().map_err(|error| error.to_string())?;
        self.advance_after(capture_id)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn save_exact(
        &self,
        capture_id: &str,
        workset_id: Option<&str>,
        text: &str,
        audio_path: Option<&str>,
        created_at_ms: u64,
    ) -> Result<(CheckpointRecord, Option<PendingCapture>), String> {
        let mut connection = self.connection()?;
        let tx = connection.transaction().map_err(|error| error.to_string())?;
        let capture = self.require_bound(&tx, capture_id)?;
        let checkpoint = storage::insert_checkpoint(
            &tx,
            &capture.application_id,
            &capture.application_name,
            &capture.context_id,
            &capture.context_label,
            workset_id,
            text,
            audio_path,
            created_at_ms,
        ).map_err(|error| error.to_string())?;
        if !capture_store::consume(&tx, capture_id).map_err(|error| error.to_string())? {
            return Err("La captura pendiente no pudo consumirse de forma atómica.".into());
        }
        tx.commit().map_err(|error| error.to_string())?;
        let next = self.advance_after(capture_id)?;
        Ok((checkpoint, next))
    }

    pub fn diagnostic(&self, event: &str, detail: &str, created_at_ms: u64) {
        if let Ok(connection) = self.connection() {
            let _ = capture_store::diagnostic(&connection, event, detail, created_at_ms);
        }
    }

    #[cfg(test)]
    pub fn pending_count(&self) -> usize {
        self.connection().ok().and_then(|connection| capture_store::count(&connection).ok()).unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_db(label: &str) -> PathBuf {
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        std::env::temp_dir().join(format!("selfrelay-{label}-{nonce}.db"))
    }

    fn snapshot(app: &str, context: &str) -> ContextSnapshot {
        ContextSnapshot {
            application_id: app.into(),
            application_name: app.into(),
            context_id: context.into(),
            context_label: context.into(),
        }
    }

    #[test]
    fn pending_capture_survives_coordinator_recreation_and_exact_ids_do_not_mix() {
        let db = temp_db("capture-durable");
        storage::initialize(&db).unwrap();
        capture_store::initialize(&db).unwrap();
        let first_id;
        let second_id;
        {
            let coordinator = CaptureCoordinator::new(&db);
            first_id = coordinator.enqueue(&snapshot("notepad", "note"), 10).unwrap().id;
            second_id = coordinator.enqueue(&snapshot("paint", "paint"), 11).unwrap().id;
            assert_eq!(coordinator.current().unwrap().unwrap().id, first_id);
            assert!(coordinator.discard_exact(&second_id).is_err());
            assert_eq!(coordinator.pending_count(), 2);
        }
        let coordinator = CaptureCoordinator::new(&db);
        assert_eq!(coordinator.current().unwrap().unwrap().id, first_id);
        coordinator.discard_exact(&first_id).unwrap();
        assert_eq!(coordinator.current().unwrap().unwrap().id, second_id);
        let _ = std::fs::remove_file(db);
    }

    #[test]
    fn save_exact_atomically_creates_checkpoint_and_consumes_only_bound_capture() {
        let db = temp_db("capture-save");
        storage::initialize(&db).unwrap();
        capture_store::initialize(&db).unwrap();
        let coordinator = CaptureCoordinator::new(&db);
        let first = coordinator.enqueue(&snapshot("app:notepad.exe", "app:notepad.exe"), 10).unwrap();
        let second = coordinator.enqueue(&snapshot("app:mspaint.exe", "app:mspaint.exe"), 11).unwrap();
        assert!(coordinator.save_exact(&second.id, None, "wrong", None, 20).is_err());
        let (checkpoint, next) = coordinator.save_exact(&first.id, None, "A", None, 20).unwrap();
        assert_eq!(checkpoint.text, "A");
        assert_eq!(next.unwrap().id, second.id);
        assert_eq!(storage::unresolved_for_context(&storage::open(&db).unwrap(), "app:notepad.exe").unwrap().len(), 1);
        let _ = std::fs::remove_file(db);
    }
}
