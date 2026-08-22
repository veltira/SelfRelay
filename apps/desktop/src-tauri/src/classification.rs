use crate::model::WindowMetadata;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IgnoreReason {
    NotTopLevel,
    NotVisible,
    UtilityWindow,
    MissingIdentity,
    SelfRelay,
    Browser,
}

pub fn classify_window(metadata: &WindowMetadata) -> Result<(), IgnoreReason> {
    if !metadata.is_top_level {
        return Err(IgnoreReason::NotTopLevel);
    }
    if !metadata.visible {
        return Err(IgnoreReason::NotVisible);
    }

    let class_name = metadata.class_name.to_lowercase();
    if matches!(class_name.as_str(), "#32768" | "tooltips_class32" | "menu") {
        return Err(IgnoreReason::UtilityWindow);
    }

    let exe = metadata.executable_name.to_lowercase();
    let title = metadata.raw_title.trim();
    if exe.is_empty() || title.is_empty() {
        return Err(IgnoreReason::MissingIdentity);
    }
    if exe == "selfrelay.exe" || exe == "selfrelay-desktop-core.exe" {
        return Err(IgnoreReason::SelfRelay);
    }
    if exe == "chrome.exe" || exe == "msedge.exe" {
        return Err(IgnoreReason::Browser);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(exe: &str) -> WindowMetadata {
        WindowMetadata {
            hwnd: 1,
            pid: 2,
            executable_path: Some(format!("C:/{exe}")),
            executable_name: exe.into(),
            raw_title: "Work".into(),
            visible: true,
            is_top_level: true,
            class_name: "AppWindow".into(),
            foreground: false,
            observed_at_ms: 0,
        }
    }

    #[test]
    fn excludes_child_windows() {
        let mut metadata = sample("Code.exe");
        metadata.is_top_level = false;
        assert_eq!(classify_window(&metadata), Err(IgnoreReason::NotTopLevel));
    }

    #[test]
    fn excludes_invisible_windows() {
        let mut metadata = sample("Code.exe");
        metadata.visible = false;
        assert_eq!(classify_window(&metadata), Err(IgnoreReason::NotVisible));
    }

    #[test]
    fn excludes_browsers() {
        assert_eq!(classify_window(&sample("chrome.exe")), Err(IgnoreReason::Browser));
        assert_eq!(classify_window(&sample("msedge.exe")), Err(IgnoreReason::Browser));
    }

    #[test]
    fn excludes_selfrelay() {
        assert_eq!(classify_window(&sample("SelfRelay.exe")), Err(IgnoreReason::SelfRelay));
    }

    #[test]
    fn accepts_work_top_level_window() {
        assert_eq!(classify_window(&sample("Code.exe")), Ok(()));
    }
}
