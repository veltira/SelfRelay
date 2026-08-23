use serde::Serialize;
use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
};

const ICON_SIZE: u32 = 48;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationIcon {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
    pub fallback: bool,
}

pub fn load(executable_path: Option<&str>, cache_dir: &Path) -> ApplicationIcon {
    let Some(path) = executable_path.filter(|value| Path::new(value).is_file()) else {
        return fallback_icon();
    };
    let _ = fs::create_dir_all(cache_dir);
    let cache_path = cache_path(path, cache_dir);
    if let Some(icon) = read_cache(&cache_path) {
        return icon;
    }

    #[cfg(windows)]
    let icon = extract_windows_icon(path).unwrap_or_else(fallback_icon);
    #[cfg(not(windows))]
    let icon = fallback_icon();

    if !icon.fallback {
        let _ = write_cache(&cache_path, &icon);
    }
    icon
}

fn cache_path(executable_path: &str, cache_dir: &Path) -> PathBuf {
    let mut hasher = DefaultHasher::new();
    executable_path.to_ascii_lowercase().hash(&mut hasher);
    if let Ok(metadata) = fs::metadata(executable_path) {
        metadata.len().hash(&mut hasher);
        if let Ok(modified) = metadata.modified() {
            modified.hash(&mut hasher);
        }
    }
    cache_dir.join(format!("{:016x}.rgba", hasher.finish()))
}

fn read_cache(path: &Path) -> Option<ApplicationIcon> {
    let bytes = fs::read(path).ok()?;
    if bytes.len() != 8 + (ICON_SIZE * ICON_SIZE * 4) as usize {
        return None;
    }
    let width = u32::from_le_bytes(bytes[0..4].try_into().ok()?);
    let height = u32::from_le_bytes(bytes[4..8].try_into().ok()?);
    if width != ICON_SIZE || height != ICON_SIZE {
        return None;
    }
    Some(ApplicationIcon {
        width,
        height,
        rgba: bytes[8..].to_vec(),
        fallback: false,
    })
}

fn write_cache(path: &Path, icon: &ApplicationIcon) -> std::io::Result<()> {
    let mut bytes = Vec::with_capacity(8 + icon.rgba.len());
    bytes.extend_from_slice(&icon.width.to_le_bytes());
    bytes.extend_from_slice(&icon.height.to_le_bytes());
    bytes.extend_from_slice(&icon.rgba);
    fs::write(path, bytes)
}

fn fallback_icon() -> ApplicationIcon {
    let size = ICON_SIZE as usize;
    let mut rgba = vec![0u8; size * size * 4];
    for y in 0..size {
        for x in 0..size {
            let offset = (y * size + x) * 4;
            let inside = x >= 7 && y >= 6 && x < size - 7 && y < size - 6;
            if inside {
                let header = y < 15;
                rgba[offset] = if header { 33 } else { 244 };
                rgba[offset + 1] = if header { 112 } else { 247 };
                rgba[offset + 2] = if header { 188 } else { 250 };
                rgba[offset + 3] = 255;
            }
        }
    }
    ApplicationIcon {
        width: ICON_SIZE,
        height: ICON_SIZE,
        rgba,
        fallback: true,
    }
}

#[cfg(windows)]
fn extract_windows_icon(path: &str) -> Option<ApplicationIcon> {
    use ::windows::{
        core::PCWSTR,
        Win32::{
            Graphics::Gdi::{
                CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, SelectObject,
                BITMAPINFO, BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
            },
            System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED},
            UI::{
                Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON},
                WindowsAndMessaging::{DestroyIcon, DrawIconEx, DI_NORMAL},
            },
        },
    };
    use std::ffi::c_void;

    let _ = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
    let wide = path.encode_utf16().chain(std::iter::once(0)).collect::<Vec<_>>();
    let mut file_info = SHFILEINFOW::default();
    let result = unsafe {
        SHGetFileInfoW(
            PCWSTR(wide.as_ptr()),
            Default::default(),
            Some(&mut file_info),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        )
    };
    if result == 0 || file_info.hIcon.is_invalid() {
        unsafe { CoUninitialize(); }
        return None;
    }

    let dc = unsafe { CreateCompatibleDC(None) };
    if dc.is_invalid() {
        unsafe {
            let _ = DestroyIcon(file_info.hIcon);
            CoUninitialize();
        }
        return None;
    }

    let mut info = BITMAPINFO::default();
    info.bmiHeader.biSize = std::mem::size_of_val(&info.bmiHeader) as u32;
    info.bmiHeader.biWidth = ICON_SIZE as i32;
    info.bmiHeader.biHeight = -(ICON_SIZE as i32);
    info.bmiHeader.biPlanes = 1;
    info.bmiHeader.biBitCount = 32;
    info.bmiHeader.biCompression = BI_RGB.0;
    info.bmiHeader.biSizeImage = ICON_SIZE * ICON_SIZE * 4;

    let mut bits: *mut c_void = std::ptr::null_mut();
    let bitmap = unsafe {
        CreateDIBSection(None, &info, DIB_RGB_COLORS, &mut bits, None, 0).ok()?
    };
    if bits.is_null() {
        unsafe {
            let _ = DestroyIcon(file_info.hIcon);
            let _ = DeleteDC(dc);
            CoUninitialize();
        }
        return None;
    }

    let old = unsafe { SelectObject(dc, HGDIOBJ::from(bitmap)) };
    let pixel_bytes = (ICON_SIZE * ICON_SIZE * 4) as usize;
    unsafe { std::ptr::write_bytes(bits, 0, pixel_bytes); }
    let draw_result = unsafe {
        DrawIconEx(
            dc,
            0,
            0,
            file_info.hIcon,
            ICON_SIZE as i32,
            ICON_SIZE as i32,
            0,
            None,
            DI_NORMAL,
        )
    };

    let mut rgba = if draw_result.is_ok() {
        unsafe { std::slice::from_raw_parts(bits as *const u8, pixel_bytes) }.to_vec()
    } else {
        Vec::new()
    };

    unsafe {
        let _ = SelectObject(dc, old);
        let _ = DeleteObject(HGDIOBJ::from(bitmap));
        let _ = DeleteDC(dc);
        let _ = DestroyIcon(file_info.hIcon);
        CoUninitialize();
    }

    if rgba.len() != pixel_bytes {
        return None;
    }
    // DIB pixels are BGRA. Convert to RGBA for Canvas ImageData.
    for pixel in rgba.chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }
    if rgba.chunks_exact(4).all(|pixel| pixel[3] == 0) {
        // Some legacy shell icons render RGB with a zero alpha channel. Preserve
        // their visible pixels instead of turning the entire icon transparent.
        for pixel in rgba.chunks_exact_mut(4) {
            if pixel[0] != 0 || pixel[1] != 0 || pixel[2] != 0 {
                pixel[3] = 255;
            }
        }
    }

    Some(ApplicationIcon {
        width: ICON_SIZE,
        height: ICON_SIZE,
        rgba,
        fallback: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fallback_has_stable_rgba_shape() {
        let icon = fallback_icon();
        assert_eq!(icon.rgba.len(), (ICON_SIZE * ICON_SIZE * 4) as usize);
        assert!(icon.fallback);
        assert!(icon.rgba.chunks_exact(4).any(|pixel| pixel[3] > 0));
    }
}
