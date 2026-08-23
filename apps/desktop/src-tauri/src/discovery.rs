use crate::{model::WindowRecord, storage::TrackedApplication};
use serde::Serialize;
use std::{collections::HashMap, path::Path};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredApplication {
    pub application_id: String,
    pub application_name: String,
    pub executable_path: Option<String>,
    pub running: bool,
    pub foreground: bool,
}

pub fn discover(records: &[WindowRecord]) -> Vec<DiscoveredApplication> {
    let mut applications = HashMap::<String, DiscoveredApplication>::new();

    for record in records {
        if !eligible_executable(&record.metadata.executable_name) {
            continue;
        }
        let candidate = DiscoveredApplication {
            application_id: record.context.application_id.clone(),
            application_name: record.context.application_name.clone(),
            executable_path: record.metadata.executable_path.clone(),
            running: true,
            foreground: record.metadata.foreground,
        };
        merge(&mut applications, candidate);
    }

    #[cfg(windows)]
    for candidate in windows_installed_applications() {
        merge(&mut applications, candidate);
    }

    let mut values = applications.into_values().collect::<Vec<_>>();
    values.sort_by(|a, b| {
        b.running
            .cmp(&a.running)
            .then_with(|| b.foreground.cmp(&a.foreground))
            .then_with(|| a.application_name.to_lowercase().cmp(&b.application_name.to_lowercase()))
    });
    values
}

pub fn tracked_from_path(path: &str, preferred_name: Option<&str>) -> Option<TrackedApplication> {
    let executable_name = Path::new(path).file_name()?.to_str()?.to_string();
    if !eligible_executable(&executable_name) {
        return None;
    }
    Some(TrackedApplication {
        application_id: application_id(&executable_name),
        application_name: preferred_name
            .filter(|value| !value.trim().is_empty())
            .map(str::trim)
            .map(str::to_string)
            .unwrap_or_else(|| friendly_name(&executable_name)),
        executable_path: Some(path.to_string()),
    })
}

pub fn friendly_name(executable_name: &str) -> String {
    match executable_name.to_ascii_lowercase().as_str() {
        "notepad.exe" => "Notepad".into(),
        "mspaint.exe" => "Paint".into(),
        "winword.exe" => "Microsoft Word".into(),
        "excel.exe" => "Microsoft Excel".into(),
        "powerpnt.exe" => "Microsoft PowerPoint".into(),
        "code.exe" => "Visual Studio Code".into(),
        "spotify.exe" => "Spotify".into(),
        "discord.exe" => "Discord".into(),
        name => name.trim_end_matches(".exe").replace(['_', '-'], " "),
    }
}

fn application_id(executable_name: &str) -> String {
    format!("app:{}", executable_name.to_ascii_lowercase())
}

fn merge(
    applications: &mut HashMap<String, DiscoveredApplication>,
    candidate: DiscoveredApplication,
) {
    applications
        .entry(candidate.application_id.clone())
        .and_modify(|current| {
            current.running |= candidate.running;
            current.foreground |= candidate.foreground;
            if current.executable_path.is_none() {
                current.executable_path = candidate.executable_path.clone();
            }
            if candidate.application_name.len() > current.application_name.len()
                && !candidate.application_name.to_ascii_lowercase().ends_with(".exe")
            {
                current.application_name = candidate.application_name.clone();
            }
        })
        .or_insert(candidate);
}

fn eligible_executable(executable_name: &str) -> bool {
    let lower = executable_name.to_ascii_lowercase();
    if !lower.ends_with(".exe") || lower.trim() == ".exe" {
        return false;
    }
    if matches!(
        lower.as_str(),
        "selfrelay.exe"
            | "selfrelay-desktop-core.exe"
            | "chrome.exe"
            | "msedge.exe"
            | "explorer.exe"
            | "dwm.exe"
            | "taskhostw.exe"
            | "sihost.exe"
            | "startmenuexperiencehost.exe"
            | "searchhost.exe"
            | "applicationframehost.exe"
    ) {
        return false;
    }
    ![
        "unins", "uninstall", "update", "updater", "crashpad", "helper", "service",
        "broker", "runtime", "installer", "setup", "elevate",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

#[cfg(windows)]
fn windows_installed_applications() -> Vec<DiscoveredApplication> {
    use ::windows::Win32::System::Registry::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};

    let mut result = Vec::new();
    for root in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        result.extend(app_paths(root));
        result.extend(uninstall_entries(root));
    }
    result
}

#[cfg(windows)]
fn app_paths(root: ::windows::Win32::System::Registry::HKEY) -> Vec<DiscoveredApplication> {
    use ::windows::Win32::System::Registry::{KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY};
    let path = r"Software\Microsoft\Windows\CurrentVersion\App Paths";
    let mut result = Vec::new();
    for view in [KEY_WOW64_64KEY, KEY_WOW64_32KEY] {
        let Some(key) = open_key(root, path, KEY_READ | view) else { continue; };
        for subkey in enum_subkeys(key) {
            if !eligible_executable(&subkey) {
                continue;
            }
            let full = format!(r"{}\{}", path, subkey);
            let Some(executable_path) = read_registry_string(root, &full, None, KEY_READ | view) else {
                continue;
            };
            if !Path::new(&executable_path).is_file() {
                continue;
            }
            result.push(DiscoveredApplication {
                application_id: application_id(&subkey),
                application_name: friendly_name(&subkey),
                executable_path: Some(executable_path),
                running: false,
                foreground: false,
            });
        }
        unsafe { let _ = ::windows::Win32::System::Registry::RegCloseKey(key); }
    }
    result
}

#[cfg(windows)]
fn uninstall_entries(root: ::windows::Win32::System::Registry::HKEY) -> Vec<DiscoveredApplication> {
    use ::windows::Win32::System::Registry::{KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY};
    let base = r"Software\Microsoft\Windows\CurrentVersion\Uninstall";
    let mut result = Vec::new();
    for view in [KEY_WOW64_64KEY, KEY_WOW64_32KEY] {
        let Some(key) = open_key(root, base, KEY_READ | view) else { continue; };
        for subkey in enum_subkeys(key) {
            let full = format!(r"{}\{}", base, subkey);
            let Some(display_name) = read_registry_string(root, &full, Some("DisplayName"), KEY_READ | view) else {
                continue;
            };
            let Some(display_icon) = read_registry_string(root, &full, Some("DisplayIcon"), KEY_READ | view) else {
                continue;
            };
            let path = normalize_display_icon(&display_icon);
            let Some(executable_name) = Path::new(&path).file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            if !eligible_executable(executable_name) || !Path::new(&path).is_file() {
                continue;
            }
            result.push(DiscoveredApplication {
                application_id: application_id(executable_name),
                application_name: display_name,
                executable_path: Some(path),
                running: false,
                foreground: false,
            });
        }
        unsafe { let _ = ::windows::Win32::System::Registry::RegCloseKey(key); }
    }
    result
}

#[cfg(windows)]
fn normalize_display_icon(value: &str) -> String {
    let trimmed = value.trim();
    let without_index = trimmed.rsplit_once(',').map(|(left, right)| {
        if right.trim().parse::<i32>().is_ok() { left } else { trimmed }
    }).unwrap_or(trimmed);
    without_index.trim().trim_matches('"').to_string()
}

#[cfg(windows)]
fn open_key(
    root: ::windows::Win32::System::Registry::HKEY,
    subkey: &str,
    access: ::windows::Win32::System::Registry::REG_SAM_FLAGS,
) -> Option<::windows::Win32::System::Registry::HKEY> {
    use ::windows::{core::PCWSTR, Win32::System::Registry::{RegOpenKeyExW, HKEY}};
    let wide = wide(subkey);
    let mut key = HKEY::default();
    let status = unsafe { RegOpenKeyExW(root, PCWSTR(wide.as_ptr()), None, access, &mut key) };
    status.is_ok().then_some(key)
}

#[cfg(windows)]
fn enum_subkeys(key: ::windows::Win32::System::Registry::HKEY) -> Vec<String> {
    use ::windows::{core::PWSTR, Win32::{Foundation::ERROR_NO_MORE_ITEMS, System::Registry::RegEnumKeyExW}};
    let mut result = Vec::new();
    for index in 0..4096u32 {
        let mut buffer = vec![0u16; 512];
        let mut length = buffer.len() as u32;
        let status = unsafe {
            RegEnumKeyExW(
                key,
                index,
                Some(PWSTR(buffer.as_mut_ptr())),
                &mut length,
                None,
                None,
                None,
                None,
            )
        };
        if status == ERROR_NO_MORE_ITEMS {
            break;
        }
        if status.is_ok() && length > 0 {
            result.push(String::from_utf16_lossy(&buffer[..length as usize]));
        }
    }
    result
}

#[cfg(windows)]
fn read_registry_string(
    root: ::windows::Win32::System::Registry::HKEY,
    subkey: &str,
    value_name: Option<&str>,
    access: ::windows::Win32::System::Registry::REG_SAM_FLAGS,
) -> Option<String> {
    use ::windows::{
        core::PCWSTR,
        Win32::System::Registry::{RegCloseKey, RegQueryValueExW, REG_EXPAND_SZ, REG_SZ, REG_VALUE_TYPE},
    };
    let key = open_key(root, subkey, access)?;
    let value_wide = value_name.map(wide);
    let value = value_wide
        .as_ref()
        .map(|item| PCWSTR(item.as_ptr()))
        .unwrap_or(PCWSTR::null());
    let mut kind = REG_VALUE_TYPE::default();
    let mut bytes = 0u32;
    let first = unsafe { RegQueryValueExW(key, value, None, Some(&mut kind), None, Some(&mut bytes)) };
    if first.is_err() || bytes == 0 || (kind != REG_SZ && kind != REG_EXPAND_SZ) {
        unsafe { let _ = RegCloseKey(key); }
        return None;
    }
    let mut buffer = vec![0u8; bytes as usize + 2];
    let second = unsafe {
        RegQueryValueExW(
            key,
            value,
            None,
            Some(&mut kind),
            Some(buffer.as_mut_ptr()),
            Some(&mut bytes),
        )
    };
    unsafe { let _ = RegCloseKey(key); }
    if second.is_err() {
        return None;
    }
    let units = unsafe {
        std::slice::from_raw_parts(buffer.as_ptr() as *const u16, bytes as usize / 2)
    };
    let length = units.iter().position(|unit| *unit == 0).unwrap_or(units.len());
    let mut value = String::from_utf16_lossy(&units[..length]);
    if kind == REG_EXPAND_SZ {
        value = expand_environment(&value);
    }
    Some(value)
}

#[cfg(windows)]
fn expand_environment(value: &str) -> String {
    let mut result = value.to_string();
    for (key, current) in std::env::vars() {
        result = result.replace(&format!("%{key}%"), &current);
    }
    result
}

#[cfg(windows)]
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_helpers_and_selfrelay() {
        assert!(!eligible_executable("SelfRelay.exe"));
        assert!(!eligible_executable("AcmeUpdater.exe"));
        assert!(!eligible_executable("service-helper.exe"));
        assert!(eligible_executable("notepad.exe"));
    }

    #[test]
    fn display_icon_normalization_keeps_executable() {
        #[cfg(windows)]
        assert_eq!(normalize_display_icon("\"C:\\Apps\\Demo.exe\",0"), "C:\\Apps\\Demo.exe");
    }
}
