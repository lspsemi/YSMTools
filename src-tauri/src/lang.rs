//! External interface languages (第 47 节). Chinese is built into the page;
//! other languages are `*.lang` files (JSON) in the `lang` folder next to the
//! executable. The installer puts the bundled ones there (tauri.conf.json →
//! bundle.resources) and users may add their own.

use serde::Serialize;
use std::path::PathBuf;

#[derive(Serialize)]
pub struct LanguageFile {
  file: String,
  text: String,
}

fn dir() -> Result<PathBuf, String> {
  let exe = std::env::current_exe().map_err(|error| error.to_string())?;
  let dir = exe.parent().ok_or("找不到程序目录")?.join("lang");
  // `npm run desktop:dev` runs from target/debug: use the repository's lang/.
  #[cfg(debug_assertions)]
  if !dir.is_dir() {
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("lang");
    if dev.is_dir() {
      return Ok(dev);
    }
  }
  Ok(dir)
}

/// Every readable `*.lang` file in the language folder, sorted by name.
#[tauri::command]
pub fn language_files() -> Vec<LanguageFile> {
  let Ok(entries) = dir().and_then(|dir| std::fs::read_dir(dir).map_err(|error| error.to_string())) else {
    return Vec::new();
  };
  let mut files: Vec<LanguageFile> = entries
    .filter_map(Result::ok)
    .filter(|entry| entry.path().extension().is_some_and(|ext| ext.eq_ignore_ascii_case("lang")))
    .filter_map(|entry| {
      Some(LanguageFile {
        file: entry.file_name().to_string_lossy().into_owned(),
        text: std::fs::read_to_string(entry.path()).ok()?,
      })
    })
    .collect();
  files.sort_by(|a, b| a.file.cmp(&b.file));
  files
}

/// The language folder (created when missing), for "打开语言文件夹".
#[tauri::command]
pub fn language_dir() -> Result<String, String> {
  let dir = dir()?;
  std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
  Ok(dir.to_string_lossy().into_owned())
}
