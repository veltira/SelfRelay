use super::{ChangeNotifier, ObserverCommand, ObserverHandle, WindowRegistry};
use crate::{adapters::derive_context, classification::classify_window, model::{WindowMetadata, WindowRecord}};
use crossbeam_channel::{bounded, select, unbounded, Sender};
use std::{ffi::c_void, path::Path, sync::{atomic::{AtomicBool, AtomicU32, Ordering}, Arc, Mutex, OnceLock}, thread, time::{SystemTime, UNIX_EPOCH}};
use windows::{core::PWSTR, Win32::{
    Foundation::{BOOL, CloseHandle, HWND, LPARAM},
    System::Threading::{GetCurrentThreadId, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION},
    UI::{
        Accessibility::{
            SetWinEventHook, UnhookWinEvent, EVENT_OBJECT_CREATE, EVENT_OBJECT_DESTROY,
            EVENT_OBJECT_HIDE, EVENT_OBJECT_NAMECHANGE, EVENT_OBJECT_SHOW,
            EVENT_SYSTEM_FOREGROUND, HWINEVENTHOOK, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS,
        },
        WindowsAndMessaging::{
            EnumWindows, GetAncestor, GetClassNameW, GetForegroundWindow, GetMessageW,
            GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible, GA_ROOT, MSG,
        },
    },
}};

#[derive(Debug, Clone, Copy)]
struct RawWinEvent {
    event: u32,
    hwnd: isize,
    id_object: i32,
    id_child: i32,
}

static HOOK_SENDER: OnceLock<Mutex<Option<Sender<RawWinEvent>>>> = OnceLock::new();

unsafe extern "system" fn win_event_callback(
    _hook: HWINEVENTHOOK,
    event: u32,
    hwnd: HWND,
    id_object: i32,
    id_child: i32,
    _event_thread: u32,
    _event_time: u32,
) {
    let Some(cell) = HOOK_SENDER.get() else { return; };
    let Ok(guard) = cell.lock() else { return; };
    let Some(sender) = guard.as_ref() else { return; };
    let _ = sender.try_send(RawWinEvent {
        event,
        hwnd: hwnd.0 as isize,
        id_object,
        id_child,
    });
}

pub(super) fn start(
    registry: WindowRegistry,
    paused: Arc<AtomicBool>,
    notify: ChangeNotifier,
) -> ObserverHandle {
    let (event_tx, event_rx) = bounded::<RawWinEvent>(512);
    let sender_cell = HOOK_SENDER.get_or_init(|| Mutex::new(None));
    if let Ok(mut sender) = sender_cell.lock() {
        *sender = Some(event_tx);
    }

    reconcile_registry(&registry);
    notify();

    let (command_tx, command_rx) = unbounded::<ObserverCommand>();
    let hook_thread_id = Arc::new(AtomicU32::new(0));

    let engine_registry = Arc::clone(&registry);
    let engine_paused = Arc::clone(&paused);
    let engine_notify = Arc::clone(&notify);
    thread::Builder::new()
        .name("selfrelay-window-engine".into())
        .spawn(move || loop {
            select! {
                recv(command_rx) -> command => match command {
                    Ok(ObserverCommand::Reconcile) => {
                        if !engine_paused.load(Ordering::Acquire) {
                            reconcile_registry(&engine_registry);
                            engine_notify();
                        }
                    }
                    Ok(ObserverCommand::Shutdown) | Err(_) => break,
                },
                recv(event_rx) -> event => match event {
                    Ok(event) => {
                        if !engine_paused.load(Ordering::Acquire)
                            && apply_event(&engine_registry, event)
                        {
                            engine_notify();
                        }
                    }
                    Err(_) => break,
                }
            }
        })
        .expect("failed to start SelfRelay lifecycle engine");

    let hook_id_target = Arc::clone(&hook_thread_id);
    thread::Builder::new()
        .name("selfrelay-winevent-hook".into())
        .spawn(move || unsafe {
            hook_id_target.store(GetCurrentThreadId(), Ordering::Release);
            run_hook_message_loop();
        })
        .expect("failed to start SelfRelay WinEvent hook thread");

    ObserverHandle { command_tx, hook_thread_id }
}

unsafe fn run_hook_message_loop() {
    let flags = WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS;
    let hooks = [
        SetWinEventHook(EVENT_OBJECT_CREATE, EVENT_OBJECT_DESTROY, None, Some(win_event_callback), 0, 0, flags),
        SetWinEventHook(EVENT_OBJECT_SHOW, EVENT_OBJECT_HIDE, None, Some(win_event_callback), 0, 0, flags),
        SetWinEventHook(EVENT_OBJECT_NAMECHANGE, EVENT_OBJECT_NAMECHANGE, None, Some(win_event_callback), 0, 0, flags),
        SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, None, Some(win_event_callback), 0, 0, flags),
    ];

    let mut message = MSG::default();
    while GetMessageW(&mut message, None, 0, 0).as_bool() {}

    for hook in hooks {
        if !hook.is_invalid() {
            let _ = UnhookWinEvent(hook);
        }
    }
}

fn apply_event(registry: &WindowRegistry, event: RawWinEvent) -> bool {
    if event.hwnd == 0 {
        return false;
    }

    if event.event == EVENT_SYSTEM_FOREGROUND {
        let mut changed = false;
        if let Ok(mut map) = registry.lock() {
            for record in map.values_mut() {
                let is_foreground = record.metadata.hwnd == event.hwnd;
                if record.metadata.foreground != is_foreground {
                    record.metadata.foreground = is_foreground;
                    changed = true;
                }
            }
        }
        return upsert_window(registry, event.hwnd) || changed;
    }

    if event.id_object != 0 || event.id_child != 0 {
        return false;
    }

    if event.event == EVENT_OBJECT_DESTROY || event.event == EVENT_OBJECT_HIDE {
        return registry.lock().map(|mut map| map.remove(&event.hwnd).is_some()).unwrap_or(false);
    }

    if event.event == EVENT_OBJECT_CREATE
        || event.event == EVENT_OBJECT_SHOW
        || event.event == EVENT_OBJECT_NAMECHANGE
    {
        return upsert_window(registry, event.hwnd);
    }

    false
}

fn reconcile_registry(registry: &WindowRegistry) {
    let snapshot = snapshot_windows();
    if let Ok(mut map) = registry.lock() {
        map.clear();
        for metadata in snapshot {
            if classify_window(&metadata).is_ok() {
                let context = derive_context(&metadata);
                map.insert(metadata.hwnd, WindowRecord { metadata, context });
            }
        }
    }
}

fn upsert_window(registry: &WindowRegistry, hwnd_value: isize) -> bool {
    let hwnd = HWND(hwnd_value as *mut c_void);
    let Some(metadata) = inspect_window(hwnd) else {
        return registry.lock().map(|mut map| map.remove(&hwnd_value).is_some()).unwrap_or(false);
    };
    if classify_window(&metadata).is_err() {
        return registry.lock().map(|mut map| map.remove(&hwnd_value).is_some()).unwrap_or(false);
    }
    let context = derive_context(&metadata);
    let record = WindowRecord { metadata, context };
    registry.lock().map(|mut map| {
        let changed = map.get(&hwnd_value) != Some(&record);
        map.insert(hwnd_value, record);
        changed
    }).unwrap_or(false)
}

fn snapshot_windows() -> Vec<WindowMetadata> {
    let mut windows = Vec::<WindowMetadata>::new();
    unsafe extern "system" fn callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let windows = &mut *(lparam.0 as *mut Vec<WindowMetadata>);
        if let Some(metadata) = inspect_window(hwnd) {
            windows.push(metadata);
        }
        BOOL(1)
    }
    unsafe {
        let _ = EnumWindows(Some(callback), LPARAM((&mut windows as *mut Vec<WindowMetadata>) as isize));
    }
    windows
}

unsafe fn inspect_window(hwnd: HWND) -> Option<WindowMetadata> {
    if hwnd.0.is_null() {
        return None;
    }

    let visible = IsWindowVisible(hwnd).as_bool();
    let root = GetAncestor(hwnd, GA_ROOT);
    let is_top_level = root == hwnd;

    let mut title_buffer = [0u16; 1024];
    let title_len = GetWindowTextW(hwnd, &mut title_buffer);
    let raw_title = if title_len > 0 {
        String::from_utf16_lossy(&title_buffer[..title_len as usize])
    } else {
        String::new()
    };

    let mut class_buffer = [0u16; 256];
    let class_len = GetClassNameW(hwnd, &mut class_buffer);
    let class_name = if class_len > 0 {
        String::from_utf16_lossy(&class_buffer[..class_len as usize])
    } else {
        String::new()
    };

    let mut pid = 0u32;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    let executable_path = process_path(pid);
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
        raw_title,
        visible,
        is_top_level,
        class_name,
        foreground: GetForegroundWindow() == hwnd,
        observed_at_ms: now_ms(),
    })
}

unsafe fn process_path(pid: u32) -> Option<String> {
    if pid == 0 {
        return None;
    }
    let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
    let mut buffer = vec![0u16; 32768];
    let mut size = buffer.len() as u32;
    let result = QueryFullProcessImageNameW(
        process,
        PROCESS_NAME_WIN32,
        PWSTR(buffer.as_mut_ptr()),
        &mut size,
    );
    let _ = CloseHandle(process);
    result.ok()?;
    Some(String::from_utf16_lossy(&buffer[..size as usize]))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}
