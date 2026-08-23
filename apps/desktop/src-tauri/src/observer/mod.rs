use crate::model::WindowRecord;
use crossbeam_channel::Sender;
use std::{collections::HashMap, sync::{atomic::{AtomicBool, AtomicU32, Ordering}, Arc, Mutex}};

#[cfg(windows)]
mod windows;
#[cfg(all(test, windows))]
mod native_fixture_test;

pub type WindowRegistry = Arc<Mutex<HashMap<isize, WindowRecord>>>;
pub type ChangeNotifier = Arc<dyn Fn() + Send + Sync + 'static>;

#[derive(Debug, Clone, Copy)]
pub enum ObserverCommand {
    Reconcile,
    Shutdown,
}

pub struct ObserverHandle {
    command_tx: Sender<ObserverCommand>,
    hook_thread_id: Arc<AtomicU32>,
}

impl ObserverHandle {
    pub fn request_reconcile(&self) {
        let _ = self.command_tx.send(ObserverCommand::Reconcile);
    }

    pub fn shutdown(&self) {
        let _ = self.command_tx.send(ObserverCommand::Shutdown);
        #[cfg(windows)]
        {
            let thread_id = self.hook_thread_id.load(Ordering::Acquire);
            if thread_id != 0 {
                use ::windows::Win32::{Foundation::{LPARAM, WPARAM}, UI::WindowsAndMessaging::{PostThreadMessageW, WM_QUIT}};
                unsafe {
                    let _ = PostThreadMessageW(thread_id, WM_QUIT, WPARAM(0), LPARAM(0));
                }
            }
        }
    }
}

impl Drop for ObserverHandle {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[cfg(windows)]
pub fn start(
    registry: WindowRegistry,
    paused: Arc<AtomicBool>,
    notify: ChangeNotifier,
) -> ObserverHandle {
    windows::start(registry, paused, notify)
}

#[cfg(not(windows))]
pub fn start(
    _registry: WindowRegistry,
    _paused: Arc<AtomicBool>,
    _notify: ChangeNotifier,
) -> ObserverHandle {
    let (command_tx, _command_rx) = crossbeam_channel::unbounded();
    ObserverHandle {
        command_tx,
        hook_thread_id: Arc::new(AtomicU32::new(0)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn observer_command_channel_is_single_owner_sensitive() {
        let (tx, rx) = crossbeam_channel::unbounded();
        tx.send(ObserverCommand::Reconcile).unwrap();
        assert!(matches!(rx.recv().unwrap(), ObserverCommand::Reconcile));
    }
}
