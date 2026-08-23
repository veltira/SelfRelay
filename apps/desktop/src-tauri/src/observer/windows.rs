use super::{ChangeNotifier, ObserverCommand, ObserverHandle, WindowRegistry};
use crate::{
    adapters::derive_context,
    classification::classify_window,
    model::{WindowMetadata, WindowRecord},
};
use crossbeam_channel::{select, tick, unbounded};
use std::{
    collections::HashMap,
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Arc,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use ::windows::{core::{BOOL, PWSTR}, Win32::{
    Foundation::{CloseHandle, HWND, LPARAM, ERROR_INSUFFICIENT_BUFFER},
    Storage::Packaging::Appx::{GetApplicationUserModelId, GetPackageFamilyName},
    System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION},
    UI::WindowsAndMessaging::{
        EnumWindows, GetAncestor, GetClassNameW, GetForegroundWindow,
        GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible, GA_ROOT,
    },
}};

// Polling keeps SelfRelay passive: it never installs a global accessibility hook
// into the Windows event stream. 150 ms is fast enough for a responsive checkpoint
// while leaving lifecycle.rs responsible for deciding whether a disappearance is
// a real exit or a short HWND recreation.
const POLL_INTERVAL_MS: u64 = 150;
const SETTLE_TICKS_AFTER_CHANGE: u8 = 4;

pub(super) fn start(
    registry: WindowRegistry,
    paused: Arc<AtomicBool>,
    notify: ChangeNotifier,
) -> ObserverHandle {
    reconcile_registry(&registry);
    notify();

    let (command_tx, command_rx) = unbounded::<ObserverCommand>();
    // ObserverHandle still carries this field for compatibility with the previous
    // WinEvent implementation. Zero means there is no hook/message-loop thread.
    let hook_thread_id = Arc::new(AtomicU32::new(0));

    let engine_registry = Arc::clone(&registry);
    let engine_paused = Arc::clone(&paused);
    let engine_notify = Arc::clone(&notify);
    thread::Builder::new()
        .name("selfrelay-window-observer".into())
        .spawn(move || {
            let ticker = tick(Duration::from_millis(POLL_INTERVAL_MS));
            let mut settle_ticks = 0u8;
            loop {
                select! {
                    recv(command_rx) -> command => match command {
                        Ok(ObserverCommand::Reconcile) => {
                            if !engine_paused.load(Ordering::Acquire) {
                                let _ = reconcile_registry(&engine_registry);
                                settle_ticks = SETTLE_TICKS_AFTER_CHANGE;
                                engine_notify();
                            }
                        }
                        Ok(ObserverCommand::Shutdown) | Err(_) => break,
                    },
                    recv(ticker) -> _ => {
                        if engine_paused.load(Ordering::Acquire) {
                            continue;
                        }
                        let changed = reconcile_registry(&engine_registry);
                        if changed {
                            settle_ticks = SETTLE_TICKS_AFTER_CHANGE;
                            engine_notify();
                        } else if settle_ticks > 0 {
                            // Lifecycle may have a pending exit whose grace period has
                            // matured even though the visible window set no longer changes.
                            settle_ticks -= 1;
                            engine_notify();
                        }
                    }
                }
            }
        })
        .expect("failed to start SelfRelay polling observer");

    ObserverHandle { command_tx, hook_thread_id }
}

fn reconcile_registry(registry: &WindowRegistry) -> bool {
    let mut next = HashMap::<isize, WindowRecord>::new();
    for metadata in snapshot_windows() {
        if classify_window(&metadata).is_ok() {
            let context = derive_context(&metadata);
            next.insert(metadata.hwnd, WindowRecord { metadata, context });
        }
    }

    let Ok(mut current) = registry.lock() else { return false; };
    let changed = !registry_equivalent(&current, &next);
    if changed {
        *current = next;
    }
    changed
}

fn registry_equivalent(
    current: &HashMap<isize, WindowRecord>,
    next: &HashMap<isize, WindowRecord>,
) -> bool {
    current.len() == next.len()
        && current.iter().all(|(hwnd, left)| {
            next.get(hwnd).map(|right| record_equivalent(left, right)).unwrap_or(false)
        })
}

fn record_equivalent(left: &WindowRecord, right: &WindowRecord) -> bool {
    left.context == right.context
        && left.metadata.hwnd == right.metadata.hwnd
        && left.metadata.pid == right.metadata.pid
        && left.metadata.executable_path == right.metadata.executable_path
        && left.metadata.executable_name == right.metadata.executable_name
        && left.metadata.package_family_name == right.metadata.package_family_name
        && left.metadata.app_user_model_id == right.metadata.app_user_model_id
        && left.metadata.raw_title == right.metadata.raw_title
        && left.metadata.visible == right.metadata.visible
        && left.metadata.is_top_level == right.metadata.is_top_level
        && left.metadata.class_name == right.metadata.class_name
        && left.metadata.foreground == right.metadata.foreground
}

pub(crate) fn snapshot_windows() -> Vec<WindowMetadata> {
    let mut windows = Vec::<WindowMetadata>::new();
    unsafe extern "system" fn callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let windows = &mut *(lparam.0 as *mut Vec<WindowMetadata>);
        if let Some(metadata) = inspect_window(hwnd) {
            windows.push(metadata);
        }
        BOOL(1)
    }
    unsafe {
        let _ = EnumWindows(
            Some(callback),
            LPARAM((&mut windows as *mut Vec<WindowMetadata>) as isize),
        );
    }
    windows
}

unsafe fn inspect_window(hwnd: HWND) -> Option<WindowMetadata> {
    if hwnd.0.is_null() {
        return None;
    }

    // Reject non-user-facing windows before opening any process handle. Besides
    // reducing work, this minimizes interaction with unrelated applications.
    let visible = IsWindowVisible(hwnd).as_bool();
    if !visible {
        return None;
    }
    let root = GetAncestor(hwnd, GA_ROOT);
    let is_top_level = root == hwnd;
    if !is_top_level {
        return None;
    }

    let mut title_buffer = [0u16; 1024];
    let title_len = GetWindowTextW(hwnd, &mut title_buffer);
    if title_len <= 0 {
        return None;
    }
    let raw_title = String::from_utf16_lossy(&title_buffer[..title_len as usize]);

    let mut class_buffer = [0u16; 256];
    let class_len = GetClassNameW(hwnd, &mut class_buffer);
    let class_name = if class_len > 0 {
        String::from_utf16_lossy(&class_buffer[..class_len as usize])
    } else {
        String::new()
    };

    let mut pid = 0u32;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    let (executable_path, package_family_name, app_user_model_id) = process_details(pid);
    let executable_name = executable_path
        .as_deref()
        .and_then(|value| Path::new(value).file_name())
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_string();

    Some(WindowMetadata {
        hwnd: hwnd.0 as isize,
        pid,
        executable_path,
        executable_name,
        package_family_name,
        app_user_model_id,
        raw_title,
        visible,
        is_top_level,
        class_name,
        foreground: GetForegroundWindow() == hwnd,
        observed_at_ms: now_ms(),
    })
}

unsafe fn process_details(pid: u32) -> (Option<String>, Option<String>, Option<String>) {
    if pid == 0 {
        return (None, None, None);
    }
    let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
        return (None, None, None);
    };

    let mut path_buffer = vec![0u16; 32768];
    let mut path_size = path_buffer.len() as u32;
    let path = QueryFullProcessImageNameW(
        process,
        PROCESS_NAME_WIN32,
        PWSTR(path_buffer.as_mut_ptr()),
        &mut path_size,
    )
    .ok()
    .map(|_| String::from_utf16_lossy(&path_buffer[..path_size as usize]));

    // Browsers are intentionally outside Desktop tracking (the Chrome extension
    // owns that surface). Avoid additional package/AUMID queries against them.
    let executable_name = path
        .as_deref()
        .and_then(|value| Path::new(value).file_name())
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if matches!(executable_name.as_str(), "chrome.exe" | "msedge.exe") {
        let _ = CloseHandle(process);
        return (path, None, None);
    }

    let package_family_name = package_family_name(process);
    let app_user_model_id = app_user_model_id(process);
    let _ = CloseHandle(process);
    (path, package_family_name, app_user_model_id)
}

unsafe fn package_family_name(process: ::windows::Win32::Foundation::HANDLE) -> Option<String> {
    let mut length = 0u32;
    if GetPackageFamilyName(process, &mut length, None) != ERROR_INSUFFICIENT_BUFFER || length == 0 {
        return None;
    }
    let mut buffer = vec![0u16; length as usize];
    let status = GetPackageFamilyName(process, &mut length, Some(PWSTR(buffer.as_mut_ptr())));
    if status.0 != 0 {
        return None;
    }
    let end = buffer.iter().position(|value| *value == 0).unwrap_or(buffer.len());
    Some(String::from_utf16_lossy(&buffer[..end]))
}

unsafe fn app_user_model_id(process: ::windows::Win32::Foundation::HANDLE) -> Option<String> {
    let mut length = 0u32;
    if GetApplicationUserModelId(process, &mut length, None) != ERROR_INSUFFICIENT_BUFFER || length == 0 {
        return None;
    }
    let mut buffer = vec![0u16; length as usize];
    let status = GetApplicationUserModelId(process, &mut length, Some(PWSTR(buffer.as_mut_ptr())));
    if status.0 != 0 {
        return None;
    }
    let end = buffer.iter().position(|value| *value == 0).unwrap_or(buffer.len());
    Some(String::from_utf16_lossy(&buffer[..end]))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}
