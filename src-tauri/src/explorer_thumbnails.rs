//! Covers for Windows Explorer thumbnails of `.ysm` files (docs/maintenance
//! section 70).
//!
//! The thumbnail provider is a separate DLL (`thumbnail-provider/`); it only
//! reads `%LOCALAPPDATA%\com.ysm.preview\explorer-thumbnails\<sha256>.png`.
//! This module writes those covers (rendered by the page), scans a folder for
//! `.ysm` files that still need one, and makes Explorer drop the thumbnails it
//! cached before (they are keyed on the file, which does not change).
//! tools/explorer-thumbnails-dev.js mirrors it for the dev server.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Must match CACHE_DIR in thumbnail-provider/src/lib.rs.
const CACHE_DIR: [&str; 2] = ["com.ysm.preview", "explorer-thumbnails"];
/// Must match CLSID_YSM_THUMBNAIL in thumbnail-provider/src/lib.rs.
const CLSID: &str = "{F6A5A6A3-58D9-4762-82C8-B325D784819C}";
/// Folder levels searched below the picked folder (like importing).
const SCAN_DEPTH: u32 = 3;

/// Files found by the last scans; only these may be read or given a cover.
static GRANTED: Mutex<Option<HashSet<PathBuf>>> = Mutex::new(None);

pub fn cache_dir() -> Result<PathBuf, String> {
  let base = std::env::var_os("LOCALAPPDATA").ok_or("找不到 LOCALAPPDATA 文件夹")?;
  Ok(CACHE_DIR.iter().fold(PathBuf::from(base), |path, part| path.join(part)))
}

/// SHA-256 of a file, lower-case hex (the provider hashes the same bytes).
pub fn hash_file(path: &Path) -> Result<String, String> {
  let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
  let mut hasher = Sha256::new();
  let mut buffer = vec![0u8; 1 << 16];
  loop {
    let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
    if read == 0 {
      break;
    }
    hasher.update(&buffer[..read]);
  }
  Ok(hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect())
}

pub fn cover_path(hash: &str) -> Result<PathBuf, String> {
  Ok(cache_dir()?.join(format!("{hash}.png")))
}

pub fn has_cover(hash: &str) -> bool {
  cover_path(hash).map(|path| path.is_file()).unwrap_or(false)
}

/// Stores `png` as the cover of every file with this hash and refreshes the
/// Explorer thumbnails of `paths`.
pub fn store(hash: &str, png: &[u8], paths: Vec<PathBuf>) -> Result<(), String> {
  let file = cover_path(hash)?;
  fs::create_dir_all(file.parent().unwrap()).map_err(|error| error.to_string())?;
  let temp = file.with_extension("png.tmp");
  fs::write(&temp, png).map_err(|error| error.to_string())?;
  fs::rename(&temp, &file).map_err(|error| error.to_string())?;
  refresh(paths);
  Ok(())
}

pub fn is_ysm(path: &Path) -> bool {
  path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("ysm"))
}

/// Explorer keeps thumbnails keyed on the file (path, size, time), so a new
/// cover for an unchanged file would never show. Re-extracting into the
/// shell's thumbnail cache (WTS_FORCEEXTRACTION) replaces every size, and
/// SHCNE_UPDATEITEM repaints open windows. Runs on its own COM thread.
#[cfg(windows)]
pub fn refresh(paths: Vec<PathBuf>) {
  if paths.is_empty() {
    return;
  }
  std::thread::spawn(move || unsafe {
    use windows::core::HSTRING;
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{IShellItem, IThumbnailCache, LocalThumbnailCache, SHChangeNotify, SHCreateItemFromParsingName, SHCNE_UPDATEITEM, SHCNF_PATHW, WTS_FORCEEXTRACTION};
    let initialized = CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok();
    // Only worth it when the provider is installed; otherwise just notify.
    let cache: Option<IThumbnailCache> = if provider_registered() { CoCreateInstance(&LocalThumbnailCache, None, CLSCTX_INPROC_SERVER).ok() } else { None };
    for path in &paths {
      let wide = HSTRING::from(path.as_os_str());
      if let Some(cache) = &cache {
        if let Ok(item) = SHCreateItemFromParsingName::<_, _, IShellItem>(&wide, None) {
          let _ = cache.GetThumbnail(&item, 256, WTS_FORCEEXTRACTION, None, None, None);
        }
      }
      SHChangeNotify(SHCNE_UPDATEITEM, SHCNF_PATHW, Some(wide.as_ptr().cast()), None);
    }
    if initialized {
      CoUninitialize();
    }
  });
}

#[cfg(not(windows))]
pub fn refresh(_paths: Vec<PathBuf>) {}

/// Whether the provider DLL is registered for .ysm for this user and exists.
#[cfg(windows)]
pub fn provider_registered() -> bool {
  use windows::core::HSTRING;
  use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_SZ};
  let read = |key: &str| -> Option<String> {
    let mut buffer = vec![0u16; 1024];
    let mut size = (buffer.len() * 2) as u32;
    // SAFETY: buffer and size describe the same allocation.
    let status = unsafe { RegGetValueW(HKEY_CURRENT_USER, &HSTRING::from(key), None, RRF_RT_REG_SZ, None, Some(buffer.as_mut_ptr().cast()), Some(&mut size)) };
    if status.is_err() {
      return None;
    }
    let len = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
    Some(String::from_utf16_lossy(&buffer[..len]))
  };
  let handler = read(r"Software\Classes\.ysm\ShellEx\{e357fccd-a995-4576-b01f-234630154e96}");
  let dll = read(&format!(r"Software\Classes\CLSID\{CLSID}\InprocServer32"));
  handler.is_some_and(|value| value.eq_ignore_ascii_case(CLSID)) && dll.is_some_and(|path| Path::new(&path).is_file())
}

#[cfg(not(windows))]
pub fn provider_registered() -> bool {
  false
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerStatus {
  /// The provider DLL is installed and registered for this user.
  registered: bool,
  cache_dir: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedFile {
  path: String,
  name: String,
  size: u64,
  /// The file already has a cover (from the library or an earlier scan).
  has_cover: bool,
}

fn collect(dir: &Path, depth: u32, found: &mut Vec<PathBuf>) {
  let Ok(entries) = fs::read_dir(dir) else { return };
  let mut entries: Vec<_> = entries.flatten().map(|entry| entry.path()).collect();
  entries.sort();
  for path in entries {
    if path.is_dir() {
      if depth > 0 {
        collect(&path, depth - 1, found);
      }
    } else if is_ysm(&path) && path.is_file() {
      found.push(path);
    }
  }
}

fn granted(path: &Path) -> Result<(), String> {
  match GRANTED.lock().unwrap().as_ref() {
    Some(set) if set.contains(path) => Ok(()),
    _ => Err("这个文件不在扫描结果中".into()),
  }
}

#[tauri::command]
pub async fn library_explorer_status() -> Result<ExplorerStatus, String> {
  Ok(ExplorerStatus { registered: provider_registered(), cache_dir: cache_dir()?.to_string_lossy().into_owned() })
}

/// Lists the `.ysm` files in `dir` (3 levels down) and whether each already
/// has a cover. Hashing reads every file once.
#[tauri::command]
pub async fn library_explorer_scan(dir: String) -> Result<Vec<ScannedFile>, String> {
  let root = PathBuf::from(&dir);
  if !root.is_dir() {
    return Err("找不到这个文件夹".into());
  }
  let mut found = Vec::new();
  collect(&root, SCAN_DEPTH, &mut found);
  let mut result = Vec::with_capacity(found.len());
  let mut set = GRANTED.lock().unwrap().take().unwrap_or_default();
  for path in found {
    let Ok(hash) = hash_file(&path) else { continue };
    let size = fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
    let name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
    set.insert(path.clone());
    result.push(ScannedFile { path: path.to_string_lossy().into_owned(), name, size, has_cover: has_cover(&hash) });
  }
  *GRANTED.lock().unwrap() = Some(set);
  Ok(result)
}

/// Raw bytes of a scanned file, for the page to render its cover.
#[tauri::command]
pub async fn library_explorer_read(path: String) -> Result<tauri::ipc::Response, String> {
  let path = PathBuf::from(path);
  granted(&path)?;
  fs::read(&path).map(tauri::ipc::Response::new).map_err(|error| error.to_string())
}

/// Stores the PNG in the request body as the cover of the scanned file named
/// in the (URI-encoded) `path` header.
#[tauri::command]
pub async fn library_explorer_save(request: tauri::ipc::Request<'_>) -> Result<(), String> {
  let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
    return Err("缺少图片内容".into());
  };
  let header = request.headers().get("path").and_then(|value| value.to_str().ok()).ok_or("缺少文件路径")?;
  let path = PathBuf::from(percent_encoding::percent_decode_str(header).decode_utf8_lossy().into_owned());
  granted(&path)?;
  let hash = hash_file(&path)?;
  store(&hash, data, vec![path])
}
