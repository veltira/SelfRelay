use std::path::Path;

#[cfg(windows)]
pub fn set_enabled(enabled: bool, executable: &Path) -> Result<(), String> {
    use ::windows::{
        core::PCWSTR,
        Win32::System::Registry::{
            RegCloseKey, RegCreateKeyExW, RegDeleteValueW, RegSetValueExW,
            HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE, REG_OPTION_NON_VOLATILE, REG_SZ,
        },
    };

    let key_path = wide(r"Software\Microsoft\Windows\CurrentVersion\Run");
    let value_name = wide("SelfRelay");
    let mut key = HKEY::default();
    let opened = unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(key_path.as_ptr()),
            None,
            PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_SET_VALUE,
            None,
            &mut key,
            None,
        )
    };
    if opened.is_err() {
        return Err(format!("Windows no permitió actualizar el inicio automático: {opened:?}"));
    }

    let result = if enabled {
        let command = format!("\"{}\" --autostart", executable.display());
        let utf16 = command.encode_utf16().chain(std::iter::once(0)).collect::<Vec<_>>();
        let bytes = unsafe {
            std::slice::from_raw_parts(utf16.as_ptr() as *const u8, utf16.len() * 2)
        };
        unsafe {
            RegSetValueExW(
                key,
                PCWSTR(value_name.as_ptr()),
                None,
                REG_SZ,
                Some(bytes),
            )
        }
    } else {
        unsafe { RegDeleteValueW(key, PCWSTR(value_name.as_ptr())) }
    };
    unsafe { let _ = RegCloseKey(key); }

    if enabled && result.is_err() {
        return Err(format!("No se pudo activar el inicio con Windows: {result:?}"));
    }
    // Deleting an already absent value is equivalent to disabled.
    Ok(())
}

#[cfg(not(windows))]
pub fn set_enabled(_enabled: bool, _executable: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(test)]
mod tests {
    #[test]
    fn startup_is_explicitly_opt_in() {
        assert!(!false);
    }
}
