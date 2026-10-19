//! Stored uploads (product images, logos, avatars...). Files live under
//! `<data>/uploads/<folder>/<random>.<ext>` and are served at /storage/...;
//! the database keeps the relative path, as before.

use crate::{
    error::{AppError, AppResult},
    input::UploadedFile,
    state::AppState,
};
use std::path::{Component, Path, PathBuf};

pub const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;

/// Detect an image type from its first bytes (never trust the name or the
/// browser-sent type). SVG is refused: it can carry scripts.
pub fn image_ext(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some("png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("gif")
    } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else if bytes.starts_with(b"BM") {
        Some("bmp")
    } else if bytes.starts_with(&[0, 0, 1, 0]) {
        Some("ico")
    } else {
        None
    }
}

/// Keep an uploaded image in `folder`; returns the relative path to store.
pub async fn store_image(state: &AppState, file: &UploadedFile, folder: &str, field: &str) -> AppResult<String> {
    if file.size > MAX_IMAGE_BYTES {
        return Err(AppError::field(field, state.t("The image must not be larger than 5 MB.").await));
    }
    let bytes = file.bytes().await.map_err(anyhow::Error::from)?;
    let ext = image_ext(&bytes).ok_or_else(|| AppError::field(field, "The file must be an image (PNG, JPG, GIF, WEBP, BMP or ICO)."))?;
    let rel = format!("{}/{}.{}", folder.trim_matches('/'), crate::util::random_string(40), ext);
    let dest = state.cfg.uploads_dir().join(&rel);
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(anyhow::Error::from)?;
    }
    tokio::fs::write(&dest, &bytes).await.map_err(anyhow::Error::from)?;
    Ok(rel)
}

/// Remove a stored upload (ignores missing files and unsafe paths).
pub async fn delete(state: &AppState, rel: Option<&str>) {
    let Some(rel) = rel.filter(|r| !r.is_empty()) else { return };
    if let Some(p) = safe_join(&state.cfg.uploads_dir(), rel) {
        let _ = tokio::fs::remove_file(p).await;
    }
}

/// Join a relative path under `root`, refusing absolute paths and "..".
pub fn safe_join(root: &Path, rel: &str) -> Option<PathBuf> {
    let rel = Path::new(rel.trim_start_matches('/'));
    if rel.components().any(|c| !matches!(c, Component::Normal(_))) {
        return None;
    }
    Some(root.join(rel))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_traversal() {
        let root = Path::new("/data/uploads");
        assert!(safe_join(root, "../etc/passwd").is_none());
        assert!(safe_join(root, "a/../../b").is_none());
        assert_eq!(safe_join(root, "avatar/x.png").unwrap(), Path::new("/data/uploads/avatar/x.png"));
    }

    #[test]
    fn sniffs_images() {
        assert_eq!(image_ext(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("jpg"));
        assert_eq!(image_ext(b"<svg xmlns"), None);
    }
}
