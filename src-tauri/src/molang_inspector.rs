//! Molang 监视器 (第 61 节): a separate OS window that the viewer page streams
//! Molang values to over Tauri events. Undecorated and transparent, so the
//! page's opacity slider fades the whole window. Not owned by the main window
//! (第 62 节): it stays up when the main window is minimized and has its own
//! taskbar button; closing the main window exits the app.

use crate::launch::{browser_args, ActiveLaunchOptions};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "molang-inspector";

/// Opens the window (or focuses it when it already exists). Position and size
/// are logical pixels; no position = centered. Must be async: creating a
/// window from a synchronous command deadlocks on Windows.
#[tauri::command]
pub async fn molang_inspector_open(
  app: AppHandle,
  active: State<'_, ActiveLaunchOptions>,
  title: String,
  x: Option<f64>,
  y: Option<f64>,
  width: f64,
  height: f64,
) -> Result<(), String> {
  if let Some(window) = app.get_webview_window(LABEL) {
    let _ = window.unminimize();
    window.show().map_err(|error| error.to_string())?;
    let _ = window.set_focus();
    return Ok(());
  }
  let mut builder = WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::App("molang-inspector.html".into()))
    .title(title)
    .inner_size(width.max(280.0), height.max(240.0))
    .min_inner_size(280.0, 240.0)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .resizable(true)
    .disable_drag_drop_handler();
  builder = match (x, y) {
    (Some(x), Some(y)) => builder.position(x, y),
    _ => builder.center(),
  };
  if let Some(args) = browser_args(active.0) {
    builder = builder.additional_browser_args(&args);
  }
  builder.build().map_err(|error| error.to_string())?;
  Ok(())
}

#[tauri::command]
pub fn molang_inspector_close(app: AppHandle) {
  if let Some(window) = app.get_webview_window(LABEL) {
    let _ = window.close();
  }
}
