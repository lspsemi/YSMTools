//! Remembered software options (第 51 节): `Config/settings.json` in the
//! program directory, next to the executable like `library/` and `launch.json`.
//! The page (src/app-config.js) owns the format; this side only reads and
//! writes the text.

use std::path::PathBuf;

fn file() -> Result<PathBuf, String> {
  let exe = std::env::current_exe().map_err(|error| error.to_string())?;
  Ok(exe.parent().ok_or("找不到程序目录")?.join("Config").join("settings.json"))
}

/// The saved options, or `None` when there is no file yet.
#[tauri::command]
pub fn config_read() -> Option<String> {
  file().ok().and_then(|path| std::fs::read_to_string(path).ok())
}

#[tauri::command]
pub fn config_write(text: String) -> Result<(), String> {
  serde_json::from_str::<serde_json::Value>(&text).map_err(|error| error.to_string())?;
  let path = file()?;
  std::fs::create_dir_all(path.parent().ok_or("找不到 Config 目录")?).map_err(|error| format!("无法创建 Config 目录：{error}"))?;
  let temp = path.with_extension("json.tmp");
  std::fs::write(&temp, text).map_err(|error| format!("无法保存设置：{error}"))?;
  std::fs::rename(&temp, &path).map_err(|error| format!("无法保存设置：{error}"))
}
