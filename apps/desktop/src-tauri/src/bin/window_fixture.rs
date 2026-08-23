#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

#[cfg(windows)]
mod windows_fixture {
    use std::{fs, path::{Path, PathBuf}, thread, time::{Duration, Instant}};
    use windows::{
        core::PCWSTR,
        Win32::{
            Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM},
            System::LibraryLoader::GetModuleHandleW,
            UI::WindowsAndMessaging::{
                CreateWindowExW, DefWindowProcW, DestroyWindow, GetMessageW, PostQuitMessage,
                RegisterClassW, SetWindowTextW, ShowWindow, UpdateWindow, CW_USEDEFAULT, MSG,
                SW_MINIMIZE, SW_RESTORE, SW_SHOW, WINDOW_EX_STYLE, WNDCLASSW, WM_CLOSE,
                WM_DESTROY, WS_OVERLAPPEDWINDOW,
            },
        },
    };

    unsafe extern "system" fn wnd_proc(hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        match message {
            WM_CLOSE => {
                let _ = DestroyWindow(hwnd);
                LRESULT(0)
            }
            WM_DESTROY => {
                PostQuitMessage(0);
                LRESULT(0)
            }
            _ => DefWindowProcW(hwnd, message, wparam, lparam),
        }
    }

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn control_dir() -> PathBuf {
        let args = std::env::args().collect::<Vec<_>>();
        args.windows(2)
            .find(|pair| pair[0] == "--control")
            .map(|pair| PathBuf::from(&pair[1]))
            .unwrap_or_else(|| std::env::temp_dir().join("selfrelay-window-fixture"))
    }

    fn phase(control: &Path, name: &str) {
        fs::create_dir_all(control).expect("fixture control directory");
        fs::write(control.join("phase.txt"), name).expect("fixture phase write");
        let continue_path = control.join(format!("{name}.go"));
        let deadline = Instant::now() + Duration::from_secs(25);
        while !continue_path.exists() {
            if Instant::now() > deadline {
                fs::write(control.join("fixture-error.txt"), format!("timeout waiting for {name}.go")).ok();
                std::process::exit(42);
            }
            thread::sleep(Duration::from_millis(30));
        }
    }

    unsafe fn create_window(class: &[u16], title: &str, instance: HINSTANCE, x: i32) -> HWND {
        let title = wide(title);
        let hwnd = CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            PCWSTR(class.as_ptr()),
            PCWSTR(title.as_ptr()),
            WS_OVERLAPPEDWINDOW,
            x,
            120,
            420,
            260,
            None,
            None,
            Some(instance),
            None,
        ).expect("fixture CreateWindowExW");
        ShowWindow(hwnd, SW_SHOW);
        let _ = UpdateWindow(hwnd);
        hwnd
    }

    unsafe fn register_class(instance: HINSTANCE, class: &[u16]) {
        let window_class = WNDCLASSW {
            hInstance: instance,
            lpfnWndProc: Some(wnd_proc),
            lpszClassName: PCWSTR(class.as_ptr()),
            ..Default::default()
        };
        if RegisterClassW(&window_class) == 0 {
            panic!("fixture RegisterClassW failed");
        }
    }

    unsafe fn run_legacy_upgrade(control: &Path, instance: HINSTANCE, class: &[u16]) {
        let _window = create_window(class, "SelfRelay — v0.1.1", instance, CW_USEDEFAULT);
        fs::create_dir_all(control).expect("legacy control directory");
        fs::write(control.join("legacy-ready.txt"), "ready").expect("legacy ready write");
        let mut message = MSG::default();
        while GetMessageW(&mut message, None, 0, 0).as_bool() {}
        fs::write(control.join("legacy-closed.txt"), "closed").expect("legacy closed write");
    }

    pub fn run() {
        let control = control_dir();
        let class = wide("SelfRelayNativeObserverFixtureWindow");
        unsafe {
            let module = GetModuleHandleW(None).expect("fixture module handle");
            let instance = HINSTANCE(module.0);
            register_class(instance, &class);

            if std::env::args().any(|argument| argument == "--legacy-upgrade") {
                run_legacy_upgrade(&control, instance, &class);
                return;
            }

            let first = create_window(&class, "SelfRelay fixture — one", instance, CW_USEDEFAULT);
            phase(&control, "opened");

            let title = wide("SelfRelay fixture — title changed");
            SetWindowTextW(first, PCWSTR(title.as_ptr())).expect("fixture title change");
            phase(&control, "title-changed");

            ShowWindow(first, SW_MINIMIZE);
            phase(&control, "minimized");

            ShowWindow(first, SW_RESTORE);
            let _ = UpdateWindow(first);
            phase(&control, "restored");

            let second = create_window(&class, "SelfRelay fixture — two", instance, 560);
            phase(&control, "second-opened");

            DestroyWindow(first).expect("fixture destroy first");
            phase(&control, "first-destroyed");

            DestroyWindow(second).expect("fixture destroy last");
            phase(&control, "last-destroyed");

            let returned = create_window(&class, "SelfRelay fixture — returned", instance, CW_USEDEFAULT);
            phase(&control, "returned");
            DestroyWindow(returned).expect("fixture destroy returned");
            fs::write(control.join("complete.txt"), "ok").expect("fixture completion write");
        }
    }
}

fn main() {
    #[cfg(windows)]
    windows_fixture::run();
    #[cfg(not(windows))]
    eprintln!("SelfRelay native observer fixture is Windows-only");
}
