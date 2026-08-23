use crate::{identity, model::WindowRecord, storage::TrackedApplication};
use serde::Serialize;
use std::{collections::HashMap, path::{Path, PathBuf}};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredApplication {
    pub application_id: String,
    pub application_name: String,
    pub executable_path: Option<String>,
    pub executable_name: Option<String>,
    pub aliases: Vec<String>,
    pub package_family_name: Option<String>,
    pub app_user_model_id: Option<String>,
    pub running: bool,
    pub foreground: bool,
}

pub fn discover(records: &[WindowRecord]) -> Vec<DiscoveredApplication> {
    let mut applications = HashMap::<String, DiscoveredApplication>::new();
    for record in records {
        if !record.metadata.executable_name.is_empty() && !eligible_executable(&record.metadata.executable_name) {
            continue;
        }
        let candidate = DiscoveredApplication {
            application_id: record.context.application_id.clone(),
            application_name: record.context.application_name.clone(),
            executable_path: record.metadata.executable_path.clone(),
            executable_name: nonempty(&record.metadata.executable_name),
            aliases: vec![record.metadata.raw_title.clone(), record.metadata.executable_name.clone()],
            package_family_name: record.metadata.package_family_name.clone(),
            app_user_model_id: record.metadata.app_user_model_id.clone(),
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
    for item in &mut values {
        item.aliases.retain(|value| !value.trim().is_empty());
        item.aliases.sort_by_key(|value| value.to_lowercase());
        item.aliases.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    }
    values.sort_by(|a, b| {
        b.running.cmp(&a.running)
            .then_with(|| b.foreground.cmp(&a.foreground))
            .then_with(|| a.application_name.to_lowercase().cmp(&b.application_name.to_lowercase()))
    });
    values
}

pub fn tracked_from_path(path: &str, preferred_name: Option<&str>) -> Option<TrackedApplication> {
    tracked_from_executable(path, preferred_name).ok()
}

pub fn tracked_from_selection(path: &str) -> Result<TrackedApplication, String> {
    let input = Path::new(path);
    match input.extension().and_then(|value| value.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("exe") => tracked_from_executable(path, None),
        Some("lnk") => {
            #[cfg(windows)]
            {
                let target = resolve_shortcut(input).ok_or_else(|| {
                    "No pudimos seguir esta aplicación todavía. El acceso directo no apunta a una aplicación observable.".to_string()
                })?;
                let name = input.file_stem().and_then(|value| value.to_str());
                tracked_from_executable(&target, name)
            }
            #[cfg(not(windows))]
            Err("Los accesos directos de Windows solo se pueden resolver en Windows.".into())
        }
        _ => Err("No pudimos seguir esta aplicación todavía. Elegí un archivo .exe o .lnk válido.".into()),
    }
}

pub fn validate_trackable(application: &TrackedApplication, records: &[WindowRecord]) -> Result<(), String> {
    if application.application_id.starts_with("aumid:") {
        return Ok(());
    }
    if let Some(path) = application.executable_path.as_deref() {
        if Path::new(path).is_file()
            && Path::new(path).extension().and_then(|value| value.to_str()).map(|value| value.eq_ignore_ascii_case("exe")).unwrap_or(false)
        {
            return Ok(());
        }
    }
    if records.iter().any(|record| identity::tracked_matches_metadata(application, &record.metadata)) {
        return Ok(());
    }
    Err("No pudimos seguir esta aplicación todavía. SelfRelay no encontró una identidad de ventana que pueda observar de forma segura.".into())
}

fn tracked_from_executable(path: &str, preferred_name: Option<&str>) -> Result<TrackedApplication, String> {
    let input = Path::new(path);
    if !input.is_file() {
        return Err("No pudimos seguir esta aplicación todavía. El ejecutable seleccionado no existe.".into());
    }
    let executable_name = input.file_name().and_then(|value| value.to_str()).ok_or_else(|| {
        "No pudimos seguir esta aplicación todavía. El ejecutable no tiene un nombre válido.".to_string()
    })?;
    if !eligible_executable(executable_name) {
        return Err("No pudimos seguir esta aplicación todavía. Ese archivo parece ser un helper, updater o componente del sistema.".into());
    }
    Ok(TrackedApplication {
        application_id: identity::application_id(Some(path), executable_name, None),
        application_name: preferred_name.filter(|value| !value.trim().is_empty()).map(str::trim).map(str::to_string)
            .unwrap_or_else(|| friendly_name(executable_name)),
        executable_path: Some(path.to_string()),
    })
}

pub fn friendly_name(executable_name: &str) -> String {
    match executable_name.to_ascii_lowercase().as_str() {
        "notepad.exe" => "Notepad".into(), "mspaint.exe" => "Paint".into(),
        "winword.exe" => "Microsoft Word".into(), "excel.exe" => "Microsoft Excel".into(),
        "powerpnt.exe" => "Microsoft PowerPoint".into(), "code.exe" => "Visual Studio Code".into(),
        "spotify.exe" => "Spotify".into(), "discord.exe" => "Discord".into(),
        name => name.trim_end_matches(".exe").replace(['_', '-'], " "),
    }
}

fn nonempty(value: &str) -> Option<String> { (!value.trim().is_empty()).then(|| value.to_string()) }

fn merge(applications: &mut HashMap<String, DiscoveredApplication>, candidate: DiscoveredApplication) {
    applications.entry(candidate.application_id.clone()).and_modify(|current| {
        current.running |= candidate.running;
        current.foreground |= candidate.foreground;
        if current.executable_path.is_none() { current.executable_path = candidate.executable_path.clone(); }
        if current.executable_name.is_none() { current.executable_name = candidate.executable_name.clone(); }
        if current.package_family_name.is_none() { current.package_family_name = candidate.package_family_name.clone(); }
        if current.app_user_model_id.is_none() { current.app_user_model_id = candidate.app_user_model_id.clone(); }
        current.aliases.extend(candidate.aliases.clone());
        if candidate.application_name.len() > current.application_name.len() && !candidate.application_name.to_ascii_lowercase().ends_with(".exe") {
            current.application_name = candidate.application_name.clone();
        }
    }).or_insert(candidate);
}

fn eligible_executable(executable_name: &str) -> bool {
    let lower = executable_name.to_ascii_lowercase();
    if !lower.ends_with(".exe") || lower.trim() == ".exe" { return false; }
    if matches!(lower.as_str(), "selfrelay.exe" | "selfrelay-desktop-core.exe" | "chrome.exe" | "msedge.exe" | "explorer.exe" | "dwm.exe" | "taskhostw.exe" | "sihost.exe" | "startmenuexperiencehost.exe" | "searchhost.exe" | "applicationframehost.exe") { return false; }
    !["unins", "uninstall", "update", "updater", "crashpad", "helper", "service", "broker", "runtime", "installer", "setup", "elevate"]
        .iter().any(|needle| lower.contains(needle))
}

#[cfg(windows)]
fn windows_installed_applications() -> Vec<DiscoveredApplication> {
    use ::windows::Win32::System::Registry::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    let mut result = Vec::new();
    for root in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        result.extend(app_paths(root));
        result.extend(uninstall_entries(root));
    }
    result.extend(start_menu_applications());
    result.extend(packaged_applications());
    result
}

#[cfg(windows)]
fn candidate_from_executable(path: String, name: String, aliases: Vec<String>) -> Option<DiscoveredApplication> {
    let executable_name = Path::new(&path).file_name()?.to_str()?.to_string();
    if !eligible_executable(&executable_name) || !Path::new(&path).is_file() { return None; }
    Some(DiscoveredApplication {
        application_id: identity::application_id(Some(&path), &executable_name, None), application_name: name,
        executable_path: Some(path), executable_name: Some(executable_name), aliases,
        package_family_name: None, app_user_model_id: None, running: false, foreground: false,
    })
}

#[cfg(windows)]
fn start_menu_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(appdata) = std::env::var("APPDATA") { roots.push(PathBuf::from(appdata).join(r"Microsoft\Windows\Start Menu\Programs")); }
    if let Ok(programdata) = std::env::var("PROGRAMDATA") { roots.push(PathBuf::from(programdata).join(r"Microsoft\Windows\Start Menu\Programs")); }
    roots
}

#[cfg(windows)]
fn collect_shortcuts(root: &Path, output: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(root) else { return; };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() { collect_shortcuts(&path, output); }
        else if path.extension().and_then(|value| value.to_str()).map(|value| value.eq_ignore_ascii_case("lnk")).unwrap_or(false) { output.push(path); }
    }
}

#[cfg(windows)]
fn start_menu_applications() -> Vec<DiscoveredApplication> {
    let mut shortcuts = Vec::new();
    for root in start_menu_roots() { collect_shortcuts(&root, &mut shortcuts); }
    shortcuts.into_iter().filter_map(|shortcut| {
        let target = resolve_shortcut(&shortcut)?;
        let display = shortcut.file_stem()?.to_str()?.to_string();
        candidate_from_executable(target.clone(), display.clone(), vec![display, target])
    }).collect()
}

#[cfg(windows)]
pub(crate) fn resolve_shortcut(path: &Path) -> Option<String> {
    use ::windows::{core::{Interface, PCWSTR}, Win32::{System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, STGM_READ}, UI::Shell::{IShellLinkW, ShellLink}}};
    unsafe {
        let initialized = CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok();
        let result = (|| {
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;
            let persist: IPersistFile = link.cast().ok()?;
            let file = wide(path.to_string_lossy().as_ref());
            persist.Load(PCWSTR(file.as_ptr()), STGM_READ).ok()?;
            let mut buffer = vec![0u16; 32768];
            link.GetPath(&mut buffer, std::ptr::null_mut(), 0).ok()?;
            let length = buffer.iter().position(|value| *value == 0).unwrap_or(0);
            (length > 0).then(|| expand_environment(&String::from_utf16_lossy(&buffer[..length])))
        })();
        if initialized { CoUninitialize(); }
        result
    }
}

#[cfg(windows)]
fn packaged_applications() -> Vec<DiscoveredApplication> {
    use ::windows::{core::Interface, Win32::{Foundation::S_OK, Storage::EnhancedStorage::PKEY_AppUserModel_ID, System::Com::{CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT_APARTMENTTHREADED}, UI::Shell::{BHID_EnumItems, FOLDERID_AppsFolder, IEnumShellItems, IShellItem, IShellItem2, KNOWN_FOLDER_FLAG, SHGetKnownFolderItem, SIGDN_NORMALDISPLAY}}};
    unsafe {
        let initialized = CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok();
        let result = (|| -> ::windows::core::Result<Vec<DiscoveredApplication>> {
            let folder: IShellItem = SHGetKnownFolderItem(&FOLDERID_AppsFolder, KNOWN_FOLDER_FLAG(0), None)?;
            let enumerator: IEnumShellItems = folder.BindToHandler(None, &BHID_EnumItems)?;
            let mut result = Vec::new();
            loop {
                let mut slot: [Option<IShellItem>; 1] = [None];
                let mut fetched = 0u32;
                let hr = enumerator.Next(&mut slot, Some(&mut fetched));
                if hr != S_OK || fetched == 0 { break; }
                let Some(item) = slot[0].take() else { continue; };
                let item2: IShellItem2 = match item.cast() { Ok(value) => value, Err(_) => continue };
                let aumid_raw = match item2.GetString(&PKEY_AppUserModel_ID) { Ok(value) => value, Err(_) => continue };
                let aumid = aumid_raw.to_string().unwrap_or_default();
                CoTaskMemFree(Some(aumid_raw.0 as *const _));
                if aumid.trim().is_empty() || aumid.to_ascii_lowercase().contains("selfrelay") { continue; }
                let display_raw = match item.GetDisplayName(SIGDN_NORMALDISPLAY) { Ok(value) => value, Err(_) => continue };
                let display = display_raw.to_string().unwrap_or_else(|_| aumid.clone());
                CoTaskMemFree(Some(display_raw.0 as *const _));
                let package_family_name = aumid.split('!').next().filter(|part| part.contains('_')).map(str::to_string);
                result.push(DiscoveredApplication {
                    application_id: identity::application_id(None, "", Some(&aumid)),
                    application_name: display.clone(), executable_path: None, executable_name: None,
                    aliases: vec![display, aumid.clone(), package_family_name.clone().unwrap_or_default()],
                    package_family_name, app_user_model_id: Some(aumid), running: false, foreground: false,
                });
            }
            Ok(result)
        })().unwrap_or_default();
        if initialized { CoUninitialize(); }
        result
    }
}

#[cfg(windows)]
fn app_paths(root: ::windows::Win32::System::Registry::HKEY) -> Vec<DiscoveredApplication> {
    use ::windows::Win32::System::Registry::{KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY};
    let base = r"Software\Microsoft\Windows\CurrentVersion\App Paths";
    let mut result = Vec::new();
    for view in [KEY_WOW64_64KEY, KEY_WOW64_32KEY] {
        let Some(key) = open_key(root, base, KEY_READ | view) else { continue; };
        for subkey in enum_subkeys(key) {
            if !eligible_executable(&subkey) { continue; }
            let full = format!(r"{}\{}", base, subkey);
            if let Some(path) = read_registry_string(root, &full, None, KEY_READ | view) {
                if let Some(candidate) = candidate_from_executable(path.clone(), friendly_name(&subkey), vec![subkey, path]) { result.push(candidate); }
            }
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
            let Some(display_name) = read_registry_string(root, &full, Some("DisplayName"), KEY_READ | view) else { continue; };
            let Some(display_icon) = read_registry_string(root, &full, Some("DisplayIcon"), KEY_READ | view) else { continue; };
            let path = normalize_display_icon(&display_icon);
            if let Some(candidate) = candidate_from_executable(path.clone(), display_name.clone(), vec![display_name, subkey, path]) { result.push(candidate); }
        }
        unsafe { let _ = ::windows::Win32::System::Registry::RegCloseKey(key); }
    }
    result
}

#[cfg(windows)]
fn normalize_display_icon(value: &str) -> String {
    let trimmed = value.trim();
    let without_index = trimmed.rsplit_once(',').map(|(left, right)| if right.trim().parse::<i32>().is_ok() { left } else { trimmed }).unwrap_or(trimmed);
    without_index.trim().trim_matches('"').to_string()
}

#[cfg(windows)]
fn open_key(root: ::windows::Win32::System::Registry::HKEY, subkey: &str, access: ::windows::Win32::System::Registry::REG_SAM_FLAGS) -> Option<::windows::Win32::System::Registry::HKEY> {
    use ::windows::{core::PCWSTR, Win32::System::Registry::{RegOpenKeyExW, HKEY}};
    let name = wide(subkey); let mut key = HKEY::default();
    unsafe { RegOpenKeyExW(root, PCWSTR(name.as_ptr()), None, access, &mut key) }.is_ok().then_some(key)
}

#[cfg(windows)]
fn enum_subkeys(key: ::windows::Win32::System::Registry::HKEY) -> Vec<String> {
    use ::windows::{core::PWSTR, Win32::{Foundation::ERROR_NO_MORE_ITEMS, System::Registry::RegEnumKeyExW}};
    let mut result = Vec::new();
    for index in 0..4096u32 {
        let mut buffer = vec![0u16; 512]; let mut length = buffer.len() as u32;
        let status = unsafe { RegEnumKeyExW(key, index, Some(PWSTR(buffer.as_mut_ptr())), &mut length, None, None, None, None) };
        if status == ERROR_NO_MORE_ITEMS { break; }
        if status.is_ok() && length > 0 { result.push(String::from_utf16_lossy(&buffer[..length as usize])); }
    }
    result
}

#[cfg(windows)]
fn read_registry_string(root: ::windows::Win32::System::Registry::HKEY, subkey: &str, value_name: Option<&str>, access: ::windows::Win32::System::Registry::REG_SAM_FLAGS) -> Option<String> {
    use ::windows::{core::PCWSTR, Win32::System::Registry::{RegCloseKey, RegQueryValueExW, REG_EXPAND_SZ, REG_SZ, REG_VALUE_TYPE}};
    let key = open_key(root, subkey, access)?; let value_wide = value_name.map(wide);
    let value = value_wide.as_ref().map(|item| PCWSTR(item.as_ptr())).unwrap_or(PCWSTR::null());
    let mut kind = REG_VALUE_TYPE::default(); let mut bytes = 0u32;
    if unsafe { RegQueryValueExW(key, value, None, Some(&mut kind), None, Some(&mut bytes)) }.is_err() || bytes == 0 || (kind != REG_SZ && kind != REG_EXPAND_SZ) { unsafe { let _ = RegCloseKey(key); } return None; }
    let mut buffer = vec![0u8; bytes as usize + 2];
    let status = unsafe { RegQueryValueExW(key, value, None, Some(&mut kind), Some(buffer.as_mut_ptr()), Some(&mut bytes)) };
    unsafe { let _ = RegCloseKey(key); } if status.is_err() { return None; }
    let units = unsafe { std::slice::from_raw_parts(buffer.as_ptr() as *const u16, bytes as usize / 2) };
    let length = units.iter().position(|unit| *unit == 0).unwrap_or(units.len());
    let mut value = String::from_utf16_lossy(&units[..length]); if kind == REG_EXPAND_SZ { value = expand_environment(&value); } Some(value)
}

#[cfg(windows)]
fn expand_environment(value: &str) -> String {
    let mut result = value.to_string(); for (key, current) in std::env::vars() { result = result.replace(&format!("%{key}%"), &current); } result
}

#[cfg(windows)]
fn wide(value: &str) -> Vec<u16> { value.encode_utf16().chain(std::iter::once(0)).collect() }

#[cfg(test)]
mod tests {
    use super::*;

    #[test] fn filters_helpers_and_selfrelay() { assert!(!eligible_executable("SelfRelay.exe")); assert!(!eligible_executable("AcmeUpdater.exe")); assert!(!eligible_executable("service-helper.exe")); assert!(eligible_executable("notepad.exe")); }
    #[test] fn duplicate_executable_names_do_not_collapse() {
        let a = identity::application_id(Some(r"C:\Apps\A\same.exe"), "same.exe", None);
        let b = identity::application_id(Some(r"D:\Apps\B\same.exe"), "same.exe", None); assert_ne!(a, b);
    }
    #[test] fn display_icon_normalization_keeps_executable() { #[cfg(windows)] assert_eq!(normalize_display_icon("\"C:\\Apps\\Demo.exe\",0"), "C:\\Apps\\Demo.exe"); }

    #[cfg(windows)]
    #[test]
    fn manual_lnk_resolution_uses_shell_link() {
        use ::windows::{core::{Interface, PCWSTR}, Win32::{System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED}, UI::Shell::{IShellLinkW, ShellLink}}};
        let temp = std::env::temp_dir().join(format!("selfrelay-link-{}", std::process::id())); let _ = std::fs::create_dir_all(&temp);
        let target = std::env::current_exe().unwrap(); let link_path = temp.join("SelfRelay fixture link.lnk");
        unsafe {
            let initialized = CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok();
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).unwrap();
            let target_wide = wide(target.to_string_lossy().as_ref()); link.SetPath(PCWSTR(target_wide.as_ptr())).unwrap();
            let persist: IPersistFile = link.cast().unwrap(); let link_wide = wide(link_path.to_string_lossy().as_ref()); persist.Save(PCWSTR(link_wide.as_ptr()), true).unwrap();
            if initialized { CoUninitialize(); }
        }
        let resolved = resolve_shortcut(&link_path).unwrap(); assert_eq!(identity::normalized_path(&resolved), identity::normalized_path(target.to_string_lossy().as_ref()));
        let _ = std::fs::remove_dir_all(temp);
    }

    #[cfg(windows)]
    #[test]
    fn packaged_app_discovery_is_safe_when_runner_exposes_appsfolder() {
        for app in packaged_applications() { assert!(app.application_id.starts_with("aumid:")); assert!(app.app_user_model_id.is_some()); }
    }
}
