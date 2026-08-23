use crate::discovery::{self, DiscoveredApplication};
use std::collections::{HashMap, HashSet};

const INTERNAL_COMPONENT_MARKERS: &[&str] = &[
    "textinputhost",
    "screenclippinghost",
    "shellexperiencehost",
    "searchhost",
    "startmenuexperiencehost",
    "runtimebroker",
    "applicationframehost",
    "backgroundtaskhost",
    "wwahost",
    "lockapp",
    "webexperience",
    "windowspackagemanager",
    "systemsettingsadminflows",
    "systemsettingsbroker",
    "securityhealthhost",
    "widgetsplatformruntime",
    "widgetservice",
    "crossdevice",
    "peopleexperiencehost",
    "gamebarpresencewriter",
    "moappcrashhandler",
    "accountscontrolhost",
    "oobe",
    "cloudexperiencehost",
    "credentialui",
];

fn unresolved_resource_name(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return true;
    }
    let lower = trimmed.to_ascii_lowercase();
    lower.starts_with("##")
        || lower.starts_with("ms-resource:")
        || lower.starts_with("@{")
        || lower.starts_with("resource:")
        || lower.contains("##id_str")
        || lower.contains("ms-resource://")
}

fn contains_internal_marker(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    INTERNAL_COMPONENT_MARKERS.iter().any(|marker| lower.contains(marker))
}

fn candidate_fingerprint(candidate: &DiscoveredApplication) -> String {
    [
        candidate.application_name.as_str(),
        candidate.executable_name.as_deref().unwrap_or(""),
        candidate.executable_path.as_deref().unwrap_or(""),
        candidate.package_family_name.as_deref().unwrap_or(""),
        candidate.app_user_model_id.as_deref().unwrap_or(""),
    ]
    .join(" ")
}

fn known_windows_display_name(candidate: &DiscoveredApplication) -> Option<&'static str> {
    let lower = candidate_fingerprint(candidate).to_ascii_lowercase();
    if lower.contains("windowsnotepad") || lower.ends_with(" notepad.exe") || lower.contains("\\notepad.exe") {
        return Some("Notepad");
    }
    if lower.contains("windowscalculator") || lower.contains("calculatorapp") {
        return Some("Calculator");
    }
    if lower.contains("mspaint") || lower.contains("microsoft.paint") {
        return Some("Paint");
    }
    if lower.contains("microsoft.windowsphotos") || lower.contains("microsoft.photos") {
        return Some("Microsoft Photos");
    }
    None
}

fn humanize_package(candidate: &DiscoveredApplication) -> Option<String> {
    let raw = candidate
        .package_family_name
        .as_deref()
        .or(candidate.app_user_model_id.as_deref())?;
    let package = raw.split('!').next().unwrap_or(raw);
    let identity = package.split('_').next().unwrap_or(package);
    if identity.trim().is_empty() || contains_internal_marker(identity) {
        return None;
    }
    let tail = identity.rsplit('.').next().unwrap_or(identity).trim();
    if tail.len() < 3 || unresolved_resource_name(tail) {
        return None;
    }
    let mut result = String::with_capacity(tail.len() + 8);
    let mut previous_lower = false;
    for character in tail.chars() {
        if matches!(character, '_' | '-' | '.') {
            if !result.ends_with(' ') {
                result.push(' ');
            }
            previous_lower = false;
            continue;
        }
        if character.is_ascii_uppercase() && previous_lower && !result.ends_with(' ') {
            result.push(' ');
        }
        previous_lower = character.is_ascii_lowercase();
        result.push(character);
    }
    let result = result.split_whitespace().collect::<Vec<_>>().join(" ");
    (!result.is_empty()).then_some(result)
}

fn useful_display_name(candidate: &DiscoveredApplication) -> Option<String> {
    if contains_internal_marker(&candidate_fingerprint(candidate)) {
        return None;
    }
    if let Some(known) = known_windows_display_name(candidate) {
        return Some(known.to_string());
    }
    if !unresolved_resource_name(&candidate.application_name) {
        let value = candidate.application_name.trim();
        if !contains_internal_marker(value) {
            return Some(value.to_string());
        }
    }
    if let Some(executable) = candidate.executable_name.as_deref() {
        if !unresolved_resource_name(executable) && !contains_internal_marker(executable) {
            let name = discovery::friendly_name(executable);
            if !name.trim().is_empty() && !unresolved_resource_name(&name) {
                return Some(name);
            }
        }
    }
    humanize_package(candidate)
}

fn normalized_path(value: &str) -> String {
    value.trim().trim_matches('"').replace('/', "\\").to_ascii_lowercase()
}

fn canonical_key(candidate: &DiscoveredApplication) -> String {
    if let Some(package) = candidate.package_family_name.as_deref().filter(|value| !value.trim().is_empty()) {
        return format!("package:{}", package.to_ascii_lowercase());
    }
    if let Some(path) = candidate.executable_path.as_deref().filter(|value| !value.trim().is_empty()) {
        return format!("path:{}", normalized_path(path));
    }
    if let Some(aumid) = candidate.app_user_model_id.as_deref().filter(|value| !value.trim().is_empty()) {
        return format!("aumid:{}", aumid.split('!').next().unwrap_or(aumid).to_ascii_lowercase());
    }
    candidate.application_id.to_ascii_lowercase()
}

fn display_key(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn merge_candidate(current: &mut DiscoveredApplication, candidate: DiscoveredApplication) {
    current.running |= candidate.running;
    current.foreground |= candidate.foreground;
    if current.executable_path.is_none() {
        current.executable_path = candidate.executable_path.clone();
    }
    if current.executable_name.is_none() {
        current.executable_name = candidate.executable_name.clone();
    }
    if current.package_family_name.is_none() {
        current.package_family_name = candidate.package_family_name.clone();
    }
    if current.app_user_model_id.is_none() {
        current.app_user_model_id = candidate.app_user_model_id.clone();
    }
    current.aliases.extend(candidate.aliases);
    current.aliases.sort_by_key(|value| value.to_ascii_lowercase());
    current.aliases.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
}

pub fn filter(candidates: Vec<DiscoveredApplication>) -> Vec<DiscoveredApplication> {
    let mut canonical = HashMap::<String, DiscoveredApplication>::new();
    for mut candidate in candidates {
        let Some(display_name) = useful_display_name(&candidate) else { continue; };
        candidate.application_name = display_name;
        candidate.aliases.retain(|value| !value.trim().is_empty() && !unresolved_resource_name(value));
        let key = canonical_key(&candidate);
        canonical
            .entry(key)
            .and_modify(|current| merge_candidate(current, candidate.clone()))
            .or_insert(candidate);
    }

    // Windows can expose the same user-facing app once through an executable and
    // once through AppsFolder. Collapse exact visible-name duplicates, preferring
    // a running/executable-backed candidate because it is directly observable.
    let mut by_name = HashMap::<String, DiscoveredApplication>::new();
    for candidate in canonical.into_values() {
        let key = display_key(&candidate.application_name);
        by_name
            .entry(key)
            .and_modify(|current| {
                let current_score = (current.running as u8) * 4 + (current.executable_path.is_some() as u8) * 2 + (current.app_user_model_id.is_some() as u8);
                let candidate_score = (candidate.running as u8) * 4 + (candidate.executable_path.is_some() as u8) * 2 + (candidate.app_user_model_id.is_some() as u8);
                if candidate_score > current_score {
                    let mut replacement = candidate.clone();
                    replacement.aliases.extend(current.aliases.clone());
                    *current = replacement;
                } else {
                    merge_candidate(current, candidate.clone());
                }
            })
            .or_insert(candidate);
    }

    let mut result = by_name.into_values().collect::<Vec<_>>();
    result.sort_by(|a, b| {
        b.running
            .cmp(&a.running)
            .then_with(|| b.foreground.cmp(&a.foreground))
            .then_with(|| a.application_name.to_lowercase().cmp(&b.application_name.to_lowercase()))
    });
    result
}

pub fn assert_quality(candidates: &[DiscoveredApplication]) -> Result<(), String> {
    let mut canonical = HashSet::new();
    let mut names = HashSet::new();
    for candidate in candidates {
        if candidate.application_name.trim().is_empty() {
            return Err("discovery candidate had an empty display name".into());
        }
        if unresolved_resource_name(&candidate.application_name) {
            return Err(format!("unresolved resource display name escaped discovery filter: {}", candidate.application_name));
        }
        if contains_internal_marker(&candidate_fingerprint(candidate)) {
            return Err(format!("internal Windows host escaped discovery filter: {}", candidate.application_name));
        }
        let key = canonical_key(candidate);
        if !canonical.insert(key.clone()) {
            return Err(format!("duplicate canonical application escaped discovery filter: {key}"));
        }
        let name = display_key(&candidate.application_name);
        if !names.insert(name.clone()) {
            return Err(format!("duplicate user-facing application name escaped discovery filter: {name}"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app(id: &str, name: &str, exe: Option<&str>, package: Option<&str>) -> DiscoveredApplication {
        DiscoveredApplication {
            application_id: id.into(),
            application_name: name.into(),
            executable_path: exe.map(|value| format!(r"C:\\Fixture\\{value}")),
            executable_name: exe.map(str::to_string),
            aliases: vec![name.into()],
            package_family_name: package.map(str::to_string),
            app_user_model_id: package.map(|value| format!("{value}!App")),
            running: false,
            foreground: false,
        }
    }

    #[test]
    fn removes_internal_hosts_and_unresolved_resources_without_losing_real_windows_apps() {
        let filtered = filter(vec![
            app("internal:text", "TextInputHost", Some("TextInputHost.exe"), None),
            app("internal:resource", "##ID_STR_MSAPPNAME", None, Some("Microsoft.Windows.Search_8wekyb3d8bbwe")),
            app("notepad", "Notepad", Some("notepad.exe"), None),
            app("paint", "Paint", Some("mspaint.exe"), None),
            app("calc", "ms-resource:AppName", None, Some("Microsoft.WindowsCalculator_8wekyb3d8bbwe")),
        ]);
        let names = filtered.iter().map(|item| item.application_name.as_str()).collect::<Vec<_>>();
        assert!(names.contains(&"Notepad"));
        assert!(names.contains(&"Paint"));
        assert!(names.contains(&"Calculator"));
        assert!(!names.iter().any(|name| name.contains("TextInput")));
        assert_quality(&filtered).unwrap();
    }

    #[test]
    fn deduplicates_executable_and_appsfolder_views_of_same_visible_app() {
        let mut executable = app("path:notepad", "Notepad", Some("notepad.exe"), None);
        executable.running = true;
        let packaged = app("aumid:notepad", "Notepad", None, Some("Microsoft.WindowsNotepad_8wekyb3d8bbwe"));
        let filtered = filter(vec![executable, packaged]);
        assert_eq!(filtered.iter().filter(|item| item.application_name == "Notepad").count(), 1);
        assert_quality(&filtered).unwrap();
    }
}
