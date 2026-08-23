use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Checkpoint {
    pub context_id: String,
    pub text: String,
    pub created_at_ms: u64,
    pub resolved_at_ms: Option<u64>,
}

impl Checkpoint {
    pub fn applies_to(&self, context_id: &str) -> bool {
        self.resolved_at_ms.is_none() && self.context_id == context_id
    }

    pub fn defer(&mut self) {
        // "Lo veo después" intentionally preserves the unresolved checkpoint.
    }

    pub fn resolve(&mut self, resolved_at_ms: u64) {
        if self.resolved_at_ms.is_none() {
            self.resolved_at_ms = Some(resolved_at_ms);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn checkpoint() -> Checkpoint {
        Checkpoint {
            context_id: "app:notepad.exe".into(),
            text: "Terminé el borrador. Falta revisar el último párrafo.".into(),
            created_at_ms: 10,
            resolved_at_ms: None,
        }
    }

    #[test]
    fn unresolved_checkpoint_recovers_only_for_same_context() {
        let checkpoint = checkpoint();
        assert!(checkpoint.applies_to("app:notepad.exe"));
        assert!(!checkpoint.applies_to("app:calc.exe"));
    }

    #[test]
    fn resolved_checkpoint_does_not_recover() {
        let mut checkpoint = checkpoint();
        checkpoint.resolve(20);
        assert!(!checkpoint.applies_to("app:notepad.exe"));
    }

    #[test]
    fn defer_keeps_checkpoint_unresolved() {
        let mut checkpoint = checkpoint();
        checkpoint.defer();
        assert!(checkpoint.resolved_at_ms.is_none());
        assert!(checkpoint.applies_to("app:notepad.exe"));
    }

    #[test]
    fn resolve_is_idempotent() {
        let mut checkpoint = checkpoint();
        checkpoint.resolve(20);
        checkpoint.resolve(30);
        assert_eq!(checkpoint.resolved_at_ms, Some(20));
    }
}
