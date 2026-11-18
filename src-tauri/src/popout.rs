//! 独立窗口 (第 62 节): windows opened by the main page with
//! `window.open('./popout.html', …)`. The page then moves a live element (the
//! toolbar, the cover sidebar) into the window's document, which only works
//! when the new webview is the popup of the main one: `NewWindowResponse::Create`
//! hands it to WebView2 as the request's new window (same environment, opener
//! kept). Other `window.open` calls are denied, as before.

use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::webview::{NewWindowFeatures, NewWindowResponse};
use tauri::{AppHandle, LogicalSize, Manager, Url, WebviewUrl, WebviewWindowBuilder, Wry};

static NEXT_ID: AtomicUsize = AtomicUsize::new(1);

pub fn new_window(app: &AppHandle, url: Url, features: NewWindowFeatures) -> NewWindowResponse<Wry> {
  if !url.path().ends_with("/popout.html") {
    return NewWindowResponse::Deny;
  }
  let label = format!("popout-{}", NEXT_ID.fetch_add(1, Ordering::Relaxed));
  let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::External("about:blank".parse().unwrap()))
    .window_features(features)
    .title("YSM模型工具")
    // The page draws its own title bar (minimize / maximize / close).
    .decorations(false)
    .resizable(true)
    .min_inner_size(48.0, 48.0)
    .disable_drag_drop_handler()
    // The page sets document.title after moving the element in.
    .on_document_title_changed(|window, title| {
      let _ = window.set_title(&title);
    });
  // Not owned by the main window: it stays up when the main window is
  // minimized and has its own taskbar button. Closing the main window exits
  // the app (lib.rs), which closes it too.
  match builder.build() {
    Ok(window) => NewWindowResponse::Create { window },
    Err(_) => NewWindowResponse::Deny,
  }
}

/// Closes every 独立窗口 (`popout-*`); called when the main page starts loading.
pub fn close_all(app: &AppHandle) {
  for (label, window) in app.webview_windows() {
    if label.starts_with("popout-") {
      let _ = window.close();
    }
  }
}

/// Resizes the calling popup's content area (logical pixels): the toolbar
/// window grows while one of its drop-down menus is open.
#[tauri::command]
pub fn popout_fit(window: tauri::Window, width: f64, height: f64) {
  if window.is_maximized().unwrap_or(false) {
    return;
  }
  let _ = window.set_size(LogicalSize::new(width.max(48.0), height.max(48.0)));
}

/// Custom title bars of the undecorated windows (独立窗口, Molang 监视器) act on
/// the calling window. Returns whether the window is maximized afterwards.
#[tauri::command]
pub fn window_control(window: tauri::Window, action: String) -> Result<bool, String> {
  let result = match action.as_str() {
    "minimize" => window.minimize(),
    "toggle_maximize" => {
      if window.is_maximized().unwrap_or(false) {
        window.unmaximize()
      } else {
        window.maximize()
      }
    }
    "close" => window.close(),
    "start_dragging" => window.start_dragging(),
    "is_maximized" => Ok(()),
    _ => return Err(format!("unknown action {action}")),
  };
  result.map_err(|error| error.to_string())?;
  Ok(window.is_maximized().unwrap_or(false))
}

/// 置顶 (图钉) button of the 独立窗口 / Molang 监视器 title bars: `pinned` sets
/// always-on-top on the calling window, `None` only reads it. Returns the state.
#[tauri::command]
pub fn window_pin(window: tauri::Window, pinned: Option<bool>) -> Result<bool, String> {
  if let Some(pinned) = pinned {
    window.set_always_on_top(pinned).map_err(|error| error.to_string())?;
  }
  Ok(window.is_always_on_top().unwrap_or(false))
}
