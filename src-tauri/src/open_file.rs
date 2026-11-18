//! Opening model files from the command line (第 54 节): double-clicking a
//! `.ysm` file starts `ysm-preview.exe "<path>"`. Only one instance runs
//! (tauri-plugin-single-instance): a second start hands its arguments to the
//! running one and exits.
//!
//! Paths wait in a queue until the page takes them (`open_file_take`), so a
//! file passed before the page has loaded is not lost. The page then reads the
//! bytes with `open_file_read`, which only serves paths that came through the
//! queue. The dev-server stand-in is tools/open-file-dev-api.js.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

/// The page calls `open_file_take` when it sees this event.
const OPEN_EVENT: &str = "open-files";
/// A second start without a file: the page shows "already running".
const RUNNING_EVENT: &str = "already-running";

#[derive(Default)]
pub struct OpenFiles {
  pending: Mutex<Vec<String>>,
  granted: Mutex<HashSet<String>>,
}

/// Model files among `args` (the first one is the executable), resolved
/// against `cwd`. Options and anything that is not an existing .ysm/.zip file
/// are ignored.
fn model_paths(args: impl IntoIterator<Item = String>, cwd: &Path) -> Vec<String> {
  args
    .into_iter()
    .skip(1)
    .filter(|arg| !arg.starts_with('-'))
    .map(|arg| cwd.join(arg))
    .filter(|path| {
      path.is_file()
        && path
          .extension()
          .and_then(|ext| ext.to_str())
          .is_some_and(|ext| ext.eq_ignore_ascii_case("ysm") || ext.eq_ignore_ascii_case("zip"))
    })
    .map(|path| path.to_string_lossy().into_owned())
    .collect()
}

/// Queues the files this (first) instance was started with.
pub fn manage(app: &tauri::App) {
  let cwd = std::env::current_dir().unwrap_or_default();
  let state = OpenFiles::default();
  state.pending.lock().unwrap().extend(model_paths(std::env::args(), &cwd));
  app.manage(state);
}

/// tauri-plugin-single-instance callback: runs in the first instance when the
/// app is started again.
pub fn second_instance(app: &AppHandle, args: Vec<String>, cwd: String) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
  }
  let paths = model_paths(args, &PathBuf::from(cwd));
  if paths.is_empty() {
    let _ = app.emit(RUNNING_EVENT, ());
    return;
  }
  if let Some(state) = app.try_state::<OpenFiles>() {
    state.pending.lock().unwrap().extend(paths);
  }
  let _ = app.emit(OPEN_EVENT, ());
}

/// The queued paths (oldest first); they may then be read once each.
#[tauri::command]
pub fn open_file_take(state: State<'_, OpenFiles>) -> Vec<String> {
  let paths: Vec<String> = std::mem::take(&mut *state.pending.lock().unwrap());
  state.granted.lock().unwrap().extend(paths.iter().cloned());
  paths
}

#[tauri::command]
pub async fn open_file_read(path: String, state: State<'_, OpenFiles>) -> Result<tauri::ipc::Response, String> {
  if !state.granted.lock().unwrap().remove(&path) {
    return Err("无法读取该文件".into());
  }
  std::fs::read(&path).map(tauri::ipc::Response::new).map_err(|error| format!("无法读取文件：{error}"))
}
