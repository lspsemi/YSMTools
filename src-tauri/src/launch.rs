//! Options that must be known before the main window exists (设置 → 性能 →
//! 解除帧率上限). They live in `launch.json` next to the executable, like the
//! library folder, and take effect on the next start: WebView2 reads its
//! browser arguments only when the webview environment is created.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

/// The arguments wry passes by default (removes the "mini menu" and SmartScreen);
/// a custom argument string replaces them, so they are repeated here.
const DEFAULT_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";
/// Chromium: the GPU process presents without waiting for vsync, so the
/// viewer's uncapped loop is not held back by it (measured ≈ 345 → 500 FPS).
/// Not `--disable-frame-rate-limit`: in WebView2 it stops requestAnimationFrame
/// entirely, which freezes the page.
const UNCAPPED_ARGS: &str = "--disable-gpu-vsync";

#[derive(Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LaunchOptions {
  pub uncapped_frame_rate: bool,
}

/// The options this process was started with (the saved ones may differ until a restart).
pub struct ActiveLaunchOptions(pub LaunchOptions);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchState {
  saved: LaunchOptions,
  active: LaunchOptions,
}

fn path() -> Result<PathBuf, String> {
  let exe = std::env::current_exe().map_err(|error| error.to_string())?;
  Ok(exe.parent().ok_or("找不到程序目录")?.join("launch.json"))
}

pub fn load() -> LaunchOptions {
  path()
    .ok()
    .and_then(|file| std::fs::read(file).ok())
    .and_then(|data| serde_json::from_slice(&data).ok())
    .unwrap_or_default()
}

/// Creates the main window from tauri.conf.json (`"create": false` there) with
/// the browser arguments for `options`.
pub fn create_main_window(app: &tauri::App, options: LaunchOptions) -> tauri::Result<()> {
  let config = app
    .config()
    .app
    .windows
    .iter()
    .find(|window| window.label == "main")
    .cloned()
    .expect("tauri.conf.json has no main window");
  let mut builder = tauri::WebviewWindowBuilder::from_config(app.handle(), &config)?;
  if let Some(args) = browser_args(options) {
    builder = builder.additional_browser_args(&args);
  }
  // 独立窗口 (第 62 节): `window.open('./popout.html')` gets a real window
  // that keeps the opener relationship, so the page can move elements into it.
  let handle = app.handle().clone();
  builder = builder.on_new_window(move |url, features| crate::popout::new_window(&handle, url, features));
  // A reload of the main page orphans its pop-outs (their page can no longer
  // be scripted and may unload without the window closing): close them, the
  // reloaded page reopens the ones that are switched on (第 63.4 节).
  builder = builder.on_page_load(|window, payload| {
    if payload.event() == tauri::webview::PageLoadEvent::Started {
      crate::popout::close_all(window.app_handle());
    }
  });
  builder.build()?;
  Ok(())
}

/// WebView2 browser arguments for `options` (None = wry's defaults). Every
/// window of the process shares one WebView2 environment, so later windows
/// (Molang 监视器, 第 61 节) must pass exactly the same arguments.
pub fn browser_args(options: LaunchOptions) -> Option<String> {
  options.uncapped_frame_rate.then(|| format!("{DEFAULT_ARGS} {UNCAPPED_ARGS}"))
}

#[tauri::command]
pub fn launch_options_state(active: State<'_, ActiveLaunchOptions>) -> LaunchState {
  LaunchState { saved: load(), active: active.0 }
}

#[tauri::command]
pub fn launch_options_set(options: LaunchOptions, active: State<'_, ActiveLaunchOptions>) -> Result<LaunchState, String> {
  let file = path()?;
  let data = serde_json::to_vec_pretty(&options).map_err(|error| error.to_string())?;
  std::fs::write(&file, data).map_err(|error| format!("无法保存启动设置：{error}"))?;
  Ok(LaunchState { saved: options, active: active.0 })
}

#[tauri::command]
pub fn restart_app(app: AppHandle) {
  app.restart();
}

pub fn manage(app: &tauri::App, options: LaunchOptions) {
  app.manage(ActiveLaunchOptions(options));
}
